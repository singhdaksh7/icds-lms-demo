const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const seedPath = path.join(__dirname, '..', 'prisma', 'seed.js');

test('prisma/seed.js refuses to run when NODE_ENV=production', () => {
  // Spawned as a real subprocess (not require()'d in-process) specifically
  // so this proves the guard fires before the script ever constructs a
  // PrismaClient or touches the database — not just that some function
  // returns the right value.
  assert.throws(
    () => {
      execFileSync(process.execPath, [seedPath], {
        env: { ...process.env, NODE_ENV: 'production' },
        stdio: 'pipe',
      });
    },
    (err) => {
      assert.equal(err.status, 1, 'seed.js must exit non-zero under NODE_ENV=production');
      const output = String(err.stderr || err.stdout);
      assert.ok(/production/i.test(output), 'the refusal message should explain why');
      return true;
    }
  );
});
