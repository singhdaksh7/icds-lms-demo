const { prisma } = require('../config/db');
const { hashPassword, verifyPassword } = require('../lib/password');
const { generateRawToken, hashToken } = require('../lib/tokens');
const { sendPasswordResetEmail } = require('../services/email.service');

// Lazily required to avoid a require-cycle at module-load time (session.js
// only depends on config/env, so this is safe, but keeping it lazy keeps
// this service importable in contexts — e.g. the seed script — that never
// touch sessions at all).
function getSessionStore() {
  return require('../config/session').sessionStore;
}

// Best-effort: destroy every session belonging to this user (via the
// Prisma-backed session store's indexed userId column — see
// src/lib/prismaSessionStore.js), so a password reset can't be undone by an
// attacker who still holds an old session cookie.
async function invalidateUserSessions(userId) {
  const sessionStore = getSessionStore();

  try {
    await sessionStore.destroyUserSessions(userId);
  } catch (err) {
    // Best-effort: a failure here shouldn't block the password reset itself.
    console.error('Failed to invalidate existing sessions after password reset:', err.message);
  }
}

const RESET_TOKEN_TTL_MS = 45 * 60 * 1000; // 45 minutes

class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthError';
  }
}

async function registerStudent({ name, email, password }) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new AuthError('An account with that email already exists.');
  }

  const passwordHash = await hashPassword(password);

  // Role is always STUDENT for public signup — never accepted from client input.
  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
      role: 'STUDENT',
      status: 'ACTIVE',
    },
  });

  return user;
}

async function authenticate({ email, password }) {
  const user = await prisma.user.findUnique({ where: { email } });

  // Same generic error whether the email is unknown or the password is
  // wrong — never reveal which one it was.
  if (!user) {
    throw new AuthError('Invalid email or password.');
  }

  const passwordMatches = await verifyPassword(password, user.passwordHash);
  if (!passwordMatches) {
    throw new AuthError('Invalid email or password.');
  }

  if (user.status !== 'ACTIVE') {
    throw new AuthError('This account is not active. Please contact support.');
  }

  return user;
}

async function requestPasswordReset(email) {
  const user = await prisma.user.findUnique({ where: { email } });

  // Anti-enumeration: always behave the same whether or not the user
  // exists. Only do real work (and only email an existing user) below.
  if (!user) {
    return;
  }

  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);

  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      token: tokenHash,
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    },
  });

  return { user, rawToken };
}

async function resetPassword(rawToken, newPassword) {
  const tokenHash = hashToken(rawToken);

  const tokenRow = await prisma.passwordResetToken.findUnique({
    where: { token: tokenHash },
  });

  if (!tokenRow || tokenRow.usedAt || tokenRow.expiresAt < new Date()) {
    throw new AuthError('This password reset link is invalid or has expired.');
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: tokenRow.userId },
      data: { passwordHash },
    }),
    prisma.passwordResetToken.update({
      where: { id: tokenRow.id },
      data: { usedAt: new Date() },
    }),
    // Consume any other outstanding reset tokens for this user too, so an
    // older unused link can't still be replayed after a successful reset.
    prisma.passwordResetToken.updateMany({
      where: { userId: tokenRow.userId, usedAt: null },
      data: { usedAt: new Date() },
    }),
  ]);

  await invalidateUserSessions(tokenRow.userId);

  return tokenRow.userId;
}

async function getSafeUserById(id) {
  return prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, role: true, status: true },
  });
}

module.exports = {
  AuthError,
  registerStudent,
  authenticate,
  requestPasswordReset,
  resetPassword,
  getSafeUserById,
  sendPasswordResetEmail,
};
