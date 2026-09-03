const authService = require('../services/auth.service');
const { AuthError } = authService;
const {
  validateSignup,
  validateLogin,
  validateForgotPassword,
  validateResetPassword,
} = require('../validators/auth.validator');
const { safeRedirectPath } = require('../lib/safeRedirect');
const { hashToken } = require('../lib/tokens');
const { prisma } = require('../config/db');
const { SESSION_COOKIE_NAME, IS_PRODUCTION } = require('../config/env');
const { absoluteUrl } = require('../lib/seo');

// ---------------------------------------------------------------------------
// Page renders (GET)
// ---------------------------------------------------------------------------

function getLoginPage(req, res) {
  res.render('public/login', {
    pageTitle: 'Login | ICDS',
    metaDescription: 'Sign in to your ICDS student account.',
    errors: [],
    values: {},
    returnTo: safeRedirectPath(req.query.returnTo, ''),
  });
}

function getSignupPage(req, res) {
  res.render('public/signup', {
    pageTitle: 'Create Account | ICDS',
    metaDescription: 'Create your ICDS student account.',
    errors: [],
    values: {},
  });
}

function getForgotPasswordPage(req, res) {
  res.render('public/forgot-password', {
    pageTitle: 'Forgot Password | ICDS',
    metaDescription: 'Reset your ICDS account password.',
    errors: [],
    values: {},
  });
}

async function getResetPasswordPage(req, res) {
  const { token } = req.params;
  const tokenHash = hashToken(token);

  const tokenRow = await prisma.passwordResetToken.findUnique({ where: { token: tokenHash } });
  const isValid = Boolean(tokenRow) && !tokenRow.usedAt && tokenRow.expiresAt > new Date();

  res.render('public/reset-password', {
    pageTitle: 'Reset Password | ICDS',
    metaDescription: 'Choose a new password for your ICDS account.',
    errors: [],
    token,
    isValid,
  });
}

// ---------------------------------------------------------------------------
// Actions (POST)
// ---------------------------------------------------------------------------

async function postSignup(req, res, next) {
  const { errors, values } = validateSignup(req.body);

  if (errors.length > 0) {
    return res.status(400).render('public/signup', {
      pageTitle: 'Create Account | ICDS',
      metaDescription: 'Create your ICDS student account.',
      errors,
      values,
    });
  }

  try {
    const user = await authService.registerStudent({
      name: values.name,
      email: values.email,
      password: req.body.password,
    });

    await regenerateSession(req);
    req.session.userId = user.id;
    req.session.role = user.role;

    req.flashSuccess('Account created successfully.');
    res.redirect('/student/dashboard');
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(409).render('public/signup', {
        pageTitle: 'Create Account | ICDS',
        metaDescription: 'Create your ICDS student account.',
        errors: [err.message],
        values,
      });
    }
    next(err);
  }
}

async function postLogin(req, res, next) {
  const { errors, values } = validateLogin(req.body);
  const returnTo = safeRedirectPath(req.body.returnTo, '');

  if (errors.length > 0) {
    return res.status(400).render('public/login', {
      pageTitle: 'Login | ICDS',
      metaDescription: 'Sign in to your ICDS student account.',
      errors,
      values,
      returnTo,
    });
  }

  try {
    const user = await authService.authenticate({
      email: values.email,
      password: req.body.password,
    });

    // Regenerate the session on login to prevent session fixation.
    await regenerateSession(req);
    req.session.userId = user.id;
    req.session.role = user.role;

    req.flashSuccess(`Welcome back, ${user.name}.`);

    if (returnTo) {
      return res.redirect(returnTo);
    }
    res.redirect(user.role === 'ADMIN' ? '/admin' : '/student/dashboard');
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(401).render('public/login', {
        pageTitle: 'Login | ICDS',
        metaDescription: 'Sign in to your ICDS student account.',
        errors: [err.message],
        values,
        returnTo,
      });
    }
    next(err);
  }
}

function postLogout(req, res, next) {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie(SESSION_COOKIE_NAME);
    res.redirect('/');
  });
}

async function postForgotPassword(req, res, next) {
  const { errors, values } = validateForgotPassword(req.body);

  const genericMessage =
    'If an account exists for that email, reset instructions have been generated.';

  if (errors.length > 0) {
    return res.status(400).render('public/forgot-password', {
      pageTitle: 'Forgot Password | ICDS',
      metaDescription: 'Reset your ICDS account password.',
      errors,
      values,
    });
  }

  try {
    const result = await authService.requestPasswordReset(values.email);

    if (result) {
      const resetUrl = absoluteUrl(req, `/reset-password/${result.rawToken}`);

      // Development convenience only: the token/URL must never appear in
      // production logs. Gated on IS_PRODUCTION, not just NODE_ENV !== dev,
      // so any non-production environment (test, staging) also stays safe
      // by default unless explicitly running as production.
      if (!IS_PRODUCTION) {
        console.log(`[dev] Password reset URL for ${result.user.email}: ${resetUrl}`);
      }

      await authService.sendPasswordResetEmail(result.user.email, resetUrl);
    }

    req.flashSuccess(genericMessage);
    res.redirect('/forgot-password');
  } catch (err) {
    next(err);
  }
}

async function postResetPassword(req, res, next) {
  const { token } = req.params;
  const { errors } = validateResetPassword(req.body);

  if (errors.length > 0) {
    return res.status(400).render('public/reset-password', {
      pageTitle: 'Reset Password | ICDS',
      metaDescription: 'Choose a new password for your ICDS account.',
      errors,
      token,
      isValid: true,
    });
  }

  try {
    await authService.resetPassword(token, req.body.password);
    req.flashSuccess('Password updated successfully. Please log in with your new password.');
    res.redirect('/login');
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(400).render('public/reset-password', {
        pageTitle: 'Reset Password | ICDS',
        metaDescription: 'Choose a new password for your ICDS account.',
        errors: [err.message],
        token,
        isValid: false,
      });
    }
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

module.exports = {
  getLoginPage,
  getSignupPage,
  getForgotPasswordPage,
  getResetPasswordPage,
  postSignup,
  postLogin,
  postLogout,
  postForgotPassword,
  postResetPassword,
};
