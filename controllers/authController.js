const crypto = require('crypto');
const asyncHandler = require('express-async-handler');
const { OAuth2Client } = require('google-auth-library');
const { User, Wholesaler, Retailer, Buyer, Admin } = require('../models/User');
const generateToken = require('../utils/generateToken');
const sendEmail = require('../utils/sendEmail');
const { passwordResetEmailTemplate } = require('../utils/emailTemplates');

const roleModelMap = { wholesaler: Wholesaler, retailer: Retailer, buyer: Buyer, admin: Admin };
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_TIME_MS = 15 * 60 * 1000; // 15 minutes
const RESET_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

// @desc    Register a new user (wholesaler, retailer, or buyer)
// @route   POST /api/auth/register
// @access  Public
const registerUser = asyncHandler(async (req, res) => {
  const { name, email, phone, password, role, ...rest } = req.body;

  if (!name || !email || !phone || !password || !role) {
    res.status(400);
    throw new Error('Please provide name, email, phone, password, and role');
  }

  // Public registration should never allow creating an admin account
  if (!['wholesaler', 'retailer', 'buyer'].includes(role)) {
    res.status(400);
    throw new Error('Invalid role. Must be wholesaler, retailer, or buyer');
  }

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    res.status(400);
    throw new Error('An account with this email already exists');
  }

  // Role-specific required fields
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

  const Model = roleModelMap[role];
  const user = await Model.create({ name, email, phone, password, ...rest });

  generateToken(res, user._id);

  res.status(201).json({
    success: true,
    user: sanitizeUser(user),
  });
});

// @desc    Login any user type
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

  // Same generic message whether the email doesn't exist or the password is wrong —
  // never reveal which one it was.
  if (!user) {
    res.status(401);
    throw new Error('Invalid email or password');
  }

  if (user.isLocked()) {
    const minutesLeft = Math.ceil((user.lockUntil - Date.now()) / 60000);
    res.status(423); // Locked
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

  // Successful login — reset lockout counters
  user.failedLoginAttempts = 0;
  user.lockUntil = undefined;
  await user.save({ validateBeforeSave: false });

  generateToken(res, user._id);

  res.json({ success: true, user: sanitizeUser(user) });
});

// @desc    Sign in or register using a Google ID token
// @route   POST /api/auth/google
// @access  Public
const googleAuth = asyncHandler(async (req, res) => {
  const { credential } = req.body;

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

  if (user) {
    // Existing account (registered with email/password) signing in with Google for the first time
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
    // Brand-new sign-up via Google. Defaults to a buyer account since we don't yet know
    // whether they want to sell — sellers can be upgraded later from their profile/settings.
    user = await Buyer.create({
      name,
      email,
      googleId,
      avatar: picture,
      isVerified: true,
    });
  }

  generateToken(res, user._id);

  res.json({ success: true, user: sanitizeUser(user) });
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

  // Always the same response, whether or not the account exists — this is what
  // stops the endpoint being used to check which emails are registered.
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
    });
  } catch (err) {
    // Don't leave a dangling valid token if the email failed to send
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save({ validateBeforeSave: false });

    console.error('SendGrid send error:', err.response?.body || err.message);
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

  user.password = password; // re-hashed by the pre('save') hook
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

// Strip sensitive fields before sending user back to client
function sanitizeUser(user) {
  const obj = user.toObject ? user.toObject() : user;
  delete obj.password;
  delete obj.googleId;
  delete obj.resetPasswordToken;
  delete obj.resetPasswordExpire;
  delete obj.failedLoginAttempts;
  delete obj.lockUntil;
  return obj;
}

module.exports = {
  registerUser,
  loginUser,
  googleAuth,
  forgotPassword,
  resetPassword,
  logoutUser,
  getMe,
  updateMe,
};