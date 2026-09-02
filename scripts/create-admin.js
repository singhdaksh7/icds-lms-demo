/*
 * One-time production admin provisioning script.
 *
 * Usage:
 *   ADMIN_EMAIL=owner@example.com ADMIN_PASSWORD='...' node scripts/create-admin.js
 *
 * Reads ADMIN_EMAIL / ADMIN_PASSWORD from the environment only — never
 * hardcode credentials here. Requires NODE_ENV=production unless
 * ALLOW_ADMIN_SCRIPT_OUTSIDE_PRODUCTION=1 is explicitly set, so it can't be
 * run by accident against a dev database. Upserts (by email) so it's safe to
 * re-run — e.g. to promote an existing user to ADMIN or reset the admin
 * password. Never logs the password.
 */
const { PrismaClient } = require('@prisma/client');
const { hashPassword } = require('../src/lib/password');

const MIN_PASSWORD_LENGTH = 12;
const PLACEHOLDER_PASSWORDS = new Set([
  'password',
  'admin',
  'admin123',
  'change-me',
  'changeme',
  '12345678',
]);

async function main() {
  const isProduction = process.env.NODE_ENV === 'production';
  const allowOutsideProduction = process.env.ALLOW_ADMIN_SCRIPT_OUTSIDE_PRODUCTION === '1';

  if (!isProduction && !allowOutsideProduction) {
    throw new Error(
      'Refusing to run: NODE_ENV is not "production". Set ALLOW_ADMIN_SCRIPT_OUTSIDE_PRODUCTION=1 to override for a non-production database.'
    );
  }

  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME || 'Administrator';

  if (!email || !password) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must both be set in the environment.');
  }

  if (password.length < MIN_PASSWORD_LENGTH || PLACEHOLDER_PASSWORDS.has(password.toLowerCase())) {
    throw new Error(
      `ADMIN_PASSWORD is too weak or a known placeholder. Use a random password of at least ${MIN_PASSWORD_LENGTH} characters.`
    );
  }

  const prisma = new PrismaClient();
  try {
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.upsert({
      where: { email },
      update: { passwordHash, role: 'ADMIN', status: 'ACTIVE', name },
      create: { email, passwordHash, role: 'ADMIN', status: 'ACTIVE', name },
    });
    console.log(`Admin account ready: ${user.email} (id ${user.id}, role ${user.role}).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Admin provisioning failed:', err.message);
  process.exit(1);
});
