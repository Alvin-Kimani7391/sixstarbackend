const asyncHandler = require('express-async-handler'); // or your own try/catch wrapper
const { User } = require('../models/User');

// @desc  Get logged-in user's profile
// @route GET /api/users/profile
const getProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).select('-password');
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }
  res.json({ success: true, user });
});

// @desc  Update logged-in user's profile
// @route PUT /api/users/profile
const updateProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  const { name, phone, avatar, address, savedLocations } = req.body;
  if (name !== undefined) user.name = name;
  if (phone !== undefined) user.phone = phone;
  if (avatar !== undefined) user.avatar = avatar;
  if (address !== undefined && user.role === 'buyer') user.address = address;
  if (savedLocations !== undefined && user.role === 'buyer') user.savedLocations = savedLocations;

  const updated = await user.save();
  const safe = updated.toObject();
  delete safe.password;
  res.json({ success: true, user: safe });
});

// @desc  Change password
// @route PUT /api/users/change-password
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user.id).select('+password');
  if (!user || !(await user.matchPassword(currentPassword))) {
    res.status(401);
    throw new Error('Current password is incorrect');
  }
  user.password = newPassword; // pre-save hook re-hashes
  await user.save();
  res.json({ success: true, message: 'Password updated' });
});

// @desc  Get recently viewed products (buyers)
// @route GET /api/users/recently-viewed
const getRecentlyViewed = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).populate({
    path: 'recentlyViewed.product',
    select: 'name price images discountPrice stock',
  });
  const items = (user?.recentlyViewed || [])
    .filter((v) => v.product)
    .sort((a, b) => b.viewedAt - a.viewedAt)
    .slice(0, 20);
  res.json({ success: true, items });
});

// @desc  Record a product view
// @route POST /api/users/recently-viewed/:productId
const trackProductView = asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const user = await User.findById(req.user.id);
  if (!user || user.role !== 'buyer') {
    return res.json({ success: true }); // no-op for non-buyers, don't error the page
  }
  user.recentlyViewed = user.recentlyViewed.filter(
    (v) => v.product.toString() !== productId
  );
  user.recentlyViewed.unshift({ product: productId, viewedAt: new Date() });
  user.recentlyViewed = user.recentlyViewed.slice(0, 20);
  await user.save();
  res.json({ success: true });
});

module.exports = {
  getProfile,
  updateProfile,
  changePassword,
  getRecentlyViewed,
  trackProductView,
};