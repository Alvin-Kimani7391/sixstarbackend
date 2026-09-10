const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const asyncHandler = require('express-async-handler');
const { OAuth2Client } = require('google-auth-library');
const { User, Wholesaler, Retailer, Buyer, Admin } = require('../models/User');
const SellerVerification = require('../models/SellerVerification');
const Agent = require('../models/Agent'); // NEW — referral attribution at signup
const generateToken = require('../utils/generateToken');
const sendEmail = require('../utils/sendEmail');
const { issueEmailOtp } = require('./emailVerificationController');
const { checkSelfReferral } = require('../services/fraudService'); // NEW
const { autoTrackConversion } = require('../services/leadService'); // NEW
const {
  passwordResetEmailTemplate,
  welcomeEmailTemplate,
  emailOtpTemplate,
} = require('../utils/emailTemplates');

const roleModelMap = { wholesaler: Wholesaler, retailer: Retailer, buyer: Buyer, admin: Admin };
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_TIME_MS = 15 * 60 * 1000; // 15 minutes
const RESET_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

// ---------- Login OTP config (approved sellers only — 2FA, separate from email verification) ----------
const LOGIN_OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const LOGIN_OTP_RESEND_COOLDOWN_MS = 60 * 1000; // 1 minute
const LOGIN_OTP_MAX_ATTEMPTS = 5;

function generateOtp() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function signLoginOtpToken(userId) {
  return jwt.sign({ id: userId, purpose: 'login_otp' }, process.env.JWT_SECRET, { expiresIn: '10m' });
}

function decodeLoginOtpToken(token) {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  if (decoded.purpose !== 'login_otp') throw new Error('Invalid verification session');
  return decoded;
}

function maskEmail(email) {
  const [local, domain] = String(email).split('@');
  if (!local || !domain) return email;
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

async function issueLoginOtp(user) {
  const code = generateOtp();
  user.loginOtpHash = crypto.createHash('sha256').update(code).digest('hex');
  user.loginOtpExpire = new Date(Date.now() + LOGIN_OTP_TTL_MS);
  user.loginOtpAttempts = 0;
  user.loginOtpLastSentAt = new Date();
  await user.save({ validateBeforeSave: false });

  // Login 2FA codes go out from noreply@sixstarsuppliers.com — same bucket
  // as email verification and password reset.
  await sendEmail({
    to: user.email,
    subject: 'Your login verification code — Six Star Suppliers',
    html: emailOtpTemplate({ name: user.name, code }),
    sender: 'noreply',
  });
}

function sendWelcomeEmail(user) {
  // Welcome emails aren't OTP/verify — they go from info@sixstarsuppliers.com.
  sendEmail({
    to: user.email,
    subject: `Welcome to Six Star Suppliers, ${user.name?.split(' ')[0] || ''}!`,
    html: welcomeEmailTemplate({ name: user.name, role: user.role }),
    sender: 'info',
  }).catch((err) => console.error('Welcome email failed:', err.body || err.message));
}

// ============================================================
// Agent referral attribution at signup.
// ------------------------------------------------------------
// Accepts either `referralCode` or the shorter `ref` (matching the
// ?ref=CODE query param your referral links use — see
// controllers2/agentController.js's getPublicAgentProfile). Looks up a
// working agent by code; if found, snapshots the attribution onto the new
// user and bumps the agent's buyersReferred/sellersReferred counter.
//
// FIX: this used to filter on `isActive: true`, which only becomes true
// once an agent's status is EXACTLY 'active' (see the pre-save hook in
// models/Agent.js). The agent dashboard (agent.js -> showDashboard()) and
// the referral-click tracker both treat 'approved' as a fully working
// agent too — so an agent sitting in 'approved' status could send out a
// perfectly good recruitment link, the buyer would register with ?ref=
// attached and everything, and this lookup would STILL come back empty,
// silently dropping the attribution (referredBy stayed null). Matching on
// `status` the same way those other two places do fixes it.
//
// This never blocks registration — an invalid/expired/missing code just
// means no attribution is recorded, exactly like the existing agentCode
// flow at checkout in orderController.js.
// ============================================================
async function resolveReferralAttribution(rawCode, role) {
  const code = (rawCode || '').trim().toUpperCase();
  if (!code) return null;

  const agent = await Agent.findOne({ code, status: { $in: ['approved', 'active'] } });
  if (!agent) return null;

  const referralType = role === 'buyer' ? 'buyer' : 'seller'; // wholesaler/retailer both count as seller referrals

  return {
    agentDoc: agent,
    snapshot: {
      agent: agent._id,
      code: agent.code,
      referralType,
      referredAt: new Date(),
    },
  };
}

async function bumpAgentReferralStat(agentDoc, role) {
  const field = role === 'buyer' ? 'buyersReferred' : 'sellersReferred';
  await Agent.findByIdAndUpdate(agentDoc._id, { $inc: { [field]: 1 } });
}

// @desc    Register a new user (wholesaler, retailer, or buyer)
// @route   POST /api/auth/register
// @access  Public
const registerUser = asyncHandler(async (req, res) => {
  const { name, email, phone, password, role, referralCode, ref, ...rest } = req.body;

  if (!name || !email || !phone || !password || !role) {
    res.status(400);
    throw new Error('Please provide name, email, phone, password, and role');
  }

  if (!['wholesaler', 'retailer', 'buyer'].includes(role)) {
    res.status(400);
    throw new Error('Invalid role. Must be wholesaler, retailer, or buyer');
  }

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    res.status(400);
    throw new Error('An account with this email already exists');
  }

  if ((role === 'wholesaler' || role === 'retailer') && !rest.location) {
    res.status(400);
    throw new Error('Business location is required');
  }
  if (role === 'wholesaler' && !rest.businessName) {
    res.status(400);
    throw new Error('Business name is required for wholesalers');
  }
  if (role === 'retailer' && !rest.shopName) {
    res.status(400);
    throw new Error('Shop name is required for retailers');
  }

  // Resolve referral attribution (if a code was carried through from a
  // referral link / QR code) before creating the account, so it can be
  // set at creation time rather than a second write.
  const attribution = await resolveReferralAttribution(referralCode || ref, role);

  const Model = roleModelMap[role];
  const user = await Model.create({
    name,
    email,
    phone,
    password,
    ...rest,
    ...(attribution ? { referredBy: attribution.snapshot } : {}),
  });

  if (attribution) {
    bumpAgentReferralStat(attribution.agentDoc, role).catch((err) =>
      console.error('Agent referral stat update failed:', err.message)
    );
  }
  
  if (attribution) {
    checkSelfReferral(attribution.agentDoc, user).catch(() => {}); // NEW
    autoTrackConversion({ agentId: attribution.agentDoc._id, user, leadType: role === 'buyer' ? 'buyer' : 'seller' }).catch(() => {}); // NEW
  }
  // Session cookie so the frontend can immediately call the protected
  // /auth/email/verify-code endpoint on the next page (verify-email.html)
  // without asking the person to log in again.
  generateToken(res, user._id);

  res.status(201).json({
    success: true,
    user: sanitizeUser(user),
  });

  sendWelcomeEmail(user);

  // Every local registration (buyer, retailer, wholesaler) starts out
  // unverified — fire the first OTP code immediately so the person lands
  // straight on the code-entry screen instead of having to ask for one.
  // (issueEmailOtp itself sends with sender: 'noreply' — see emailVerificationController.js)
  issueEmailOtp(user).catch((err) =>
    console.error('Registration OTP email failed:', err.body || err.message)
  );
});

// @desc    Login any user type.
//          Unverified accounts (any role) are stopped for email OTP
//          verification before they can use the app.
//          Sellers whose verification is separately APPROVED are then
//          also stopped for a login 2FA OTP.
// @route   POST /api/auth/login
// @access  Public
const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400);
    throw new Error('Please provide email and password');
  }

  const user = await User.findOne({ email }).select(
    '+password +failedLoginAttempts +lockUntil +googleId'
  );

  if (!user) {
    res.status(401);
    throw new Error('Invalid email or password');
  }

  if (user.isLocked()) {
    const minutesLeft = Math.ceil((user.lockUntil - Date.now()) / 60000);
    res.status(423);
    throw new Error(`Too many failed attempts. Please try again in ${minutesLeft} minute(s).`);
  }

  if (user.googleId && !user.password) {
    res.status(400);
    throw new Error('This account uses Google Sign-In. Please continue with Google below.');
  }

  const isMatch = await user.matchPassword(password);

  if (!isMatch) {
    user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
    if (user.failedLoginAttempts >= MAX_LOGIN_ATTEMPTS) {
      user.lockUntil = Date.now() + LOCK_TIME_MS;
      user.failedLoginAttempts = 0;
    }
    await user.save({ validateBeforeSave: false });

    res.status(401);
    throw new Error('Invalid email or password');
  }

  if (!user.isActive) {
    res.status(403);
    throw new Error('This account has been suspended. Contact support.');
  }

  // Password is correct — reset lockout counters regardless of what happens next.
  user.failedLoginAttempts = 0;
  user.lockUntil = undefined;
  await user.save({ validateBeforeSave: false });

  // ---------- Email verification gate — applies to EVERY role ----------
  if (!user.isVerified) {
    generateToken(res, user._id);

    return res.json({
      success: true,
      emailVerificationRequired: true,
      email: user.email,
      user: sanitizeUser(user),
    });
  }

  // ---------- Login-OTP gate (2FA): only for sellers with an APPROVED verification ----------
  const isSellerRole = ['wholesaler', 'retailer'].includes(user.role);
  let requiresLoginOtp = false;

  if (isSellerRole) {
    const approvedVerification = await SellerVerification.findOne({
      seller: user._id,
      status: 'approved',
    }).select('_id');
    requiresLoginOtp = !!approvedVerification;
  }

  if (requiresLoginOtp) {
    try {
      await issueLoginOtp(user);
    } catch (err) {
      console.error('Login OTP email failed:', err.body || err.message);
      res.status(500);
      throw new Error('Could not send your login verification code. Please try again shortly.');
    }

    return res.json({
      success: true,
      otpRequired: true,
      otpToken: signLoginOtpToken(user._id),
      maskedEmail: maskEmail(user.email),
    });
  }

  generateToken(res, user._id);
  res.json({ success: true, user: sanitizeUser(user) });
});

// @desc    Complete a login by verifying the code emailed to an approved seller
// @route   POST /api/auth/login/verify-otp
// @access  Public (guarded by the short-lived otpToken, not a session)
const verifyLoginOtp = asyncHandler(async (req, res) => {
  const { otpToken, code } = req.body;

  if (!otpToken || !code) {
    res.status(400);
    throw new Error('Enter the code we emailed you');
  }

  let decoded;
  try {
    decoded = decodeLoginOtpToken(otpToken);
  } catch {
    res.status(400);
    throw new Error('Your verification session has expired. Please log in again.');
  }

  const user = await User.findById(decoded.id).select(
    '+loginOtpHash +loginOtpExpire +loginOtpAttempts'
  );

  if (!user) {
    res.status(401);
    throw new Error('Account not found');
  }
  if (!user.isActive) {
    res.status(403);
    throw new Error('This account has been suspended. Contact support.');
  }

  if (!user.loginOtpHash || !user.loginOtpExpire || user.loginOtpExpire < new Date()) {
    res.status(400);
    throw new Error('This code has expired. Please request a new one.');
  }

  if (user.loginOtpAttempts >= LOGIN_OTP_MAX_ATTEMPTS) {
    res.status(429);
    throw new Error('Too many incorrect attempts. Please request a new code.');
  }

  const hashed = crypto.createHash('sha256').update(String(code).trim()).digest('hex');
  if (hashed !== user.loginOtpHash) {
    user.loginOtpAttempts += 1;
    await user.save({ validateBeforeSave: false });
    res.status(400);
    throw new Error('Incorrect code. Please try again.');
  }

  user.loginOtpHash = undefined;
  user.loginOtpExpire = undefined;
  user.loginOtpAttempts = 0;
  await user.save({ validateBeforeSave: false });

  generateToken(res, user._id);
  res.json({ success: true, user: sanitizeUser(user) });
});

// @desc    Resend the login OTP for a pending login
// @route   POST /api/auth/login/resend-otp
// @access  Public (guarded by the short-lived otpToken)
const resendLoginOtp = asyncHandler(async (req, res) => {
  const { otpToken } = req.body;

  if (!otpToken) {
    res.status(400);
    throw new Error('Missing verification session');
  }

  let decoded;
  try {
    decoded = decodeLoginOtpToken(otpToken);
  } catch {
    res.status(400);
    throw new Error('Your verification session has expired. Please log in again.');
  }

  const user = await User.findById(decoded.id).select('+loginOtpLastSentAt');
  if (!user) {
    res.status(401);
    throw new Error('Account not found');
  }

  if (
    user.loginOtpLastSentAt &&
    Date.now() - user.loginOtpLastSentAt.getTime() < LOGIN_OTP_RESEND_COOLDOWN_MS
  ) {
    const waitSec = Math.ceil(
      (LOGIN_OTP_RESEND_COOLDOWN_MS - (Date.now() - user.loginOtpLastSentAt.getTime())) / 1000
    );
    res.status(429);
    throw new Error(`Please wait ${waitSec}s before requesting another code`);
  }

  try {
    await issueLoginOtp(user);
  } catch (err) {
    console.error('Resend login OTP failed:', err.body || err.message);
    res.status(500);
    throw new Error('Could not resend the code right now. Please try again shortly.');
  }

  res.json({
    success: true,
    otpToken: signLoginOtpToken(user._id),
    maskedEmail: maskEmail(user.email),
  });
});

// @desc    Sign in or register using a Google ID token
// @route   POST /api/auth/google
// @access  Public
//
// NEW: Google sign-up is buyer-only, but it now carries `ref` through the
// same resolveReferralAttribution() path as the email/password flow, so a
// buyer who clicks a recruitment link and then signs up with Google (instead
// of the email form) still gets correctly attributed to the referring
// agent. Only applied on brand-new signups — an existing account logging in
// via Google is never retroactively re-attributed.
const googleAuth = asyncHandler(async (req, res) => {
  const { credential, ref, referralCode } = req.body;

  if (!credential) {
    res.status(400);
    throw new Error('Missing Google credential');
  }

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch (err) {
    res.status(401);
    throw new Error('Invalid or expired Google credential');
  }

  const { sub: googleId, email, name, picture, email_verified: emailVerified } = payload;

  if (!emailVerified) {
    res.status(401);
    throw new Error('Google account email is not verified');
  }

  let user = await User.findOne({ $or: [{ googleId }, { email }] }).select('+googleId');
  let isNewSignup = false;
  let attribution = null;

  if (user) {
    if (!user.googleId) {
      user.googleId = googleId;
      user.isVerified = true;
      if (!user.avatar) user.avatar = picture;
      await user.save({ validateBeforeSave: false });
    }
    if (!user.isActive) {
      res.status(403);
      throw new Error('This account has been suspended. Contact support.');
    }
  } else {
    attribution = await resolveReferralAttribution(referralCode || ref, 'buyer');

    user = await Buyer.create({
      name,
      email,
      googleId,
      avatar: picture,
      isVerified: true,
      ...(attribution ? { referredBy: attribution.snapshot } : {}),
    });
    isNewSignup = true;

    if (attribution) {
      bumpAgentReferralStat(attribution.agentDoc, 'buyer').catch((err) =>
        console.error('Agent referral stat update failed:', err.message)
      );
      checkSelfReferral(attribution.agentDoc, user).catch(() => {});
      autoTrackConversion({ agentId: attribution.agentDoc._id, user, leadType: 'buyer' }).catch(() => {});
    }
  }

  // Google sign-in bypasses the email-OTP gate intentionally — Google's own
  // verified-email claim already proves ownership of the address.
  generateToken(res, user._id);

  res.json({ success: true, user: sanitizeUser(user) });

  if (isNewSignup) sendWelcomeEmail(user);
});

// @desc    Request a password reset email
// @route   POST /api/auth/forgot-password
// @access  Public
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    res.status(400);
    throw new Error('Please provide your email address');
  }

  const genericResponse = {
    success: true,
    message: 'If an account exists for that email, we\u2019ve sent password reset instructions.',
  };

  const user = await User.findOne({ email }).select('+googleId +password');

  if (!user || (user.googleId && !user.password)) {
    return res.json(genericResponse);
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  user.resetPasswordToken = crypto.createHash('sha256').update(rawToken).digest('hex');
  user.resetPasswordExpire = Date.now() + RESET_TOKEN_TTL_MS;
  await user.save({ validateBeforeSave: false });

  const resetUrl = `${process.env.FRONTEND_URL}/reset-password.html?token=${rawToken}`;

  try {
    await sendEmail({
      to: user.email,
      subject: 'Reset your Six Star Suppliers password',
      html: passwordResetEmailTemplate(user.name, resetUrl),
      sender: 'noreply',
    });
  } catch (err) {
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save({ validateBeforeSave: false });

    console.error('Brevo send error:', err.body || err.message);
    res.status(500);
    throw new Error('Could not send the reset email right now. Please try again shortly.');
  }

  res.json(genericResponse);
});

// @desc    Reset password using the token emailed to the user
// @route   POST /api/auth/reset-password/:token
// @access  Public
const resetPassword = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;

  if (!password || password.length < 6) {
    res.status(400);
    throw new Error('Password must be at least 6 characters');
  }

  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  const user = await User.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpire: { $gt: Date.now() },
  }).select('+resetPasswordToken +resetPasswordExpire');

  if (!user) {
    res.status(400);
    throw new Error('This reset link is invalid or has expired. Please request a new one.');
  }

  user.password = password;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpire = undefined;
  user.failedLoginAttempts = 0;
  user.lockUntil = undefined;
  await user.save();

  generateToken(res, user._id);

  res.json({ success: true, message: 'Password updated successfully', user: sanitizeUser(user) });
});

// @desc    Logout - clears the auth cookie
// @route   POST /api/auth/logout
// @access  Private
const logoutUser = asyncHandler(async (req, res) => {
  res.cookie('token', '', { httpOnly: true, expires: new Date(0) });
  res.json({ success: true, message: 'Logged out successfully' });
});

// @desc    Get logged-in user's own profile
// @route   GET /api/auth/me
// @access  Private
const getMe = asyncHandler(async (req, res) => {
  res.json({ success: true, user: sanitizeUser(req.user) });
});

// @desc    Update own profile
// @route   PUT /api/auth/me
// @access  Private
const updateMe = asyncHandler(async (req, res) => {
  const disallowed = ['role', 'password', 'email', 'isVerified', 'isActive', 'googleId'];
  disallowed.forEach((field) => delete req.body[field]);

  const updated = await User.findByIdAndUpdate(req.user._id, req.body, {
    new: true,
    runValidators: true,
  });

  res.json({ success: true, user: sanitizeUser(updated) });
});

function sanitizeUser(user) {
  const obj = user.toObject ? user.toObject() : user;
  delete obj.password;
  delete obj.googleId;
  delete obj.resetPasswordToken;
  delete obj.resetPasswordExpire;
  delete obj.failedLoginAttempts;
  delete obj.lockUntil;
  delete obj.loginOtpHash;
  delete obj.loginOtpExpire;
  delete obj.loginOtpAttempts;
  delete obj.loginOtpLastSentAt;
  delete obj.emailOtpHash;
  delete obj.emailOtpExpire;
  delete obj.emailOtpAttempts;
  delete obj.emailOtpLastSentAt;
  return obj;
}

module.exports = {
  registerUser,
  loginUser,
  verifyLoginOtp,
  resendLoginOtp,
  googleAuth,
  forgotPassword,
  resetPassword,
  logoutUser,
  getMe,
  updateMe,
};