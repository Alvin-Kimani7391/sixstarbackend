const crypto = require('crypto');
const asyncHandler = require('express-async-handler');
const { User } = require('../models/User');
const sendEmail = require('../utils/sendEmail');
const { emailOtpTemplate } = require('../utils/emailTemplates');

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // 1 minute between sends
const MAX_ATTEMPTS = 5;

function generateOtp() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

// ---------------------------------------------------------------
// Reusable core — generates + emails a fresh code and persists the
// hash on the given user doc. Exported so authController can call it
// straight after registration, not just from the /send-code route.
// Works on any user doc, whether it was just created in memory
// (Model.create(...)) or loaded fresh from the DB.
// ---------------------------------------------------------------
async function issueEmailOtp(user) {
  const code = generateOtp();
  user.emailOtpHash = crypto.createHash('sha256').update(code).digest('hex');
  user.emailOtpExpire = new Date(Date.now() + OTP_TTL_MS);
  user.emailOtpAttempts = 0;
  user.emailOtpLastSentAt = new Date();
  await user.save({ validateBeforeSave: false });

  await sendEmail({
    to: user.email,
    subject: 'Verify your email — Six Star Suppliers',
    html: emailOtpTemplate({ name: user.name, code }),
  });
}

// @desc  Send (or resend) a 6-digit verification code to the logged-in
//        user's email. Works for buyers, retailers, and wholesalers —
//        anyone whose account isn't verified yet.
// @route POST /api/auth/email/send-code
//        (also mounted at /api/seller-verification/email/send-code for
//        backward compatibility with the seller onboarding wizard)
// @access Private (any authenticated role)
const sendEmailOtp = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).select('+emailOtpLastSentAt');

  if (!user) {
    res.status(404);
    throw new Error('Account not found');
  }

  if (user.isVerified) {
    res.json({ success: true, alreadyVerified: true, email: user.email });
    return;
  }

  if (user.emailOtpLastSentAt && Date.now() - user.emailOtpLastSentAt.getTime() < RESEND_COOLDOWN_MS) {
    const waitSec = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - user.emailOtpLastSentAt.getTime())) / 1000);
    res.status(429);
    throw new Error(`Please wait ${waitSec}s before requesting another code`);
  }

  try {
    await issueEmailOtp(user);
  } catch (err) {
    console.error('OTP email failed:', err.response?.body || err.message);
    res.status(500);
    throw new Error('Could not send the verification email right now. Please try again shortly.');
  }

  res.json({ success: true, email: user.email, expiresInSeconds: OTP_TTL_MS / 1000 });
});

// @desc  Verify the 6-digit code and flip isVerified to true
// @route POST /api/auth/email/verify-code
//        (also mounted at /api/seller-verification/email/verify-code)
// @access Private (any authenticated role)
const verifyEmailOtp = asyncHandler(async (req, res) => {
  const { code } = req.body;
  if (!code) {
    res.status(400);
    throw new Error('Enter the code we emailed you');
  }

  const user = await User.findById(req.user.id).select(
    '+emailOtpHash +emailOtpExpire +emailOtpAttempts'
  );

  if (!user) {
    res.status(404);
    throw new Error('Account not found');
  }

  if (user.isVerified) {
    res.json({ success: true, verified: true, email: user.email });
    return;
  }

  if (!user.emailOtpHash || !user.emailOtpExpire || user.emailOtpExpire < new Date()) {
    res.status(400);
    throw new Error('That code has expired. Request a new one.');
  }

  if (user.emailOtpAttempts >= MAX_ATTEMPTS) {
    res.status(429);
    throw new Error('Too many incorrect attempts. Request a new code.');
  }

  const hashed = crypto.createHash('sha256').update(String(code).trim()).digest('hex');
  if (hashed !== user.emailOtpHash) {
    user.emailOtpAttempts += 1;
    await user.save({ validateBeforeSave: false });
    res.status(400);
    throw new Error('Incorrect code. Please try again.');
  }

  user.isVerified = true;
  user.emailOtpHash = undefined;
  user.emailOtpExpire = undefined;
  user.emailOtpAttempts = 0;
  await user.save({ validateBeforeSave: false });

  res.json({ success: true, verified: true, email: user.email });
});

module.exports = { sendEmailOtp, verifyEmailOtp, issueEmailOtp };