// utils/emailOtp.js
const crypto = require('crypto');
const sendEmail = require('./sendEmail');
const { emailOtpTemplate } = require('./emailTemplates');

const EMAIL_OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const EMAIL_OTP_RESEND_COOLDOWN_MS = 60 * 1000; // 1 minute

function generateOtp() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

// Shared by registration (auto-send) and the manual resend endpoint.
// Mutates + saves `user`, then emails the code. Caller decides how to
// handle a failed send (block vs. swallow).
async function issueEmailVerificationOtp(user) {
  const code = generateOtp();
  user.emailOtpHash = crypto.createHash('sha256').update(code).digest('hex');
  user.emailOtpExpire = new Date(Date.now() + EMAIL_OTP_TTL_MS);
  user.emailOtpAttempts = 0;
  user.emailOtpLastSentAt = new Date();
  await user.save({ validateBeforeSave: false });

  // OTP codes always go out from noreply@sixstarsuppliers.com — never info@.
  await sendEmail({
    to: user.email,
    subject: 'Verify your email — Six Star Suppliers',
    html: emailOtpTemplate({ name: user.name, code }),
    sender: 'noreply',
  });
}

module.exports = { issueEmailVerificationOtp, EMAIL_OTP_TTL_MS, EMAIL_OTP_RESEND_COOLDOWN_MS };