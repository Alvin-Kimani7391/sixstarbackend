const rateLimit = require('express-rate-limit');

// Generous enough for real users, tight enough to blunt brute-force/credential-stuffing attempts.
// Login lockout (in the User model + authController) is the second layer of defense per-account.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts. Please try again in a few minutes.' },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many accounts created from this network. Please try again later.' },
});

// Stricter — this one triggers an outbound SendGrid email each time it succeeds,
// so it also protects your SendGrid quota/reputation from abuse.
const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many password reset requests. Please try again later.' },
});

module.exports = { loginLimiter, registerLimiter, forgotPasswordLimiter };