// bcryptjs is a pure-JS implementation (no native compilation), which is
// what makes it safe on Hostinger Node.js hosting where we don't control
// the build toolchain.
const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 12;

async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

module.exports = { hashPassword, verifyPassword };
