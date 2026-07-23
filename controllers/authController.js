const asyncHandler = require('express-async-handler');
const { User, Wholesaler, Retailer, Buyer, Admin } = require('../models/User');
const generateToken = require('../utils/generateToken');

const roleModelMap = { wholesaler: Wholesaler, retailer: Retailer, buyer: Buyer, admin: Admin };

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

  const user = await User.findOne({ email }).select('+password');

  if (!user || !(await user.matchPassword(password))) {
    res.status(401);
    throw new Error('Invalid email or password');
  }

  if (!user.isActive) {
    res.status(403);
    throw new Error('This account has been suspended. Contact support.');
  }

  generateToken(res, user._id);

  res.json({ success: true, user: sanitizeUser(user) });
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
  const disallowed = ['role', 'password', 'email', 'isVerified', 'isActive'];
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
  return obj;
}

module.exports = { registerUser, loginUser, logoutUser, getMe, updateMe };
