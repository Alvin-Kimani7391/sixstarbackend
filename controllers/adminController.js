const asyncHandler = require('express-async-handler');
const Product = require('../models/Product');
const Order = require('../models/Order');
const { User } = require('../models/User');

// @desc    Get all products awaiting admin review (status = pending_review)
// @route   GET /api/admin/products/pending
// @access  Private (admin)
const getPendingProducts = asyncHandler(async (req, res) => {
  const products = await Product.find({ status: 'pending_review' })
    .populate('category', 'name')
    .populate('seller', 'name businessName shopName role email phone')
    .sort('createdAt'); // oldest first, so nothing sits waiting too long

  res.json({ success: true, count: products.length, products });
});

// @desc    Admin sets the final price and approves a product -> goes live
// @route   PATCH /api/admin/products/:id/approve
// @access  Private (admin)
const approveProduct = asyncHandler(async (req, res) => {
  const { finalPrice, discountPercent, isHotDeal } = req.body;

  if (finalPrice == null || finalPrice <= 0) {
    res.status(400);
    throw new Error('A valid finalPrice is required to approve a product');
  }

  const product = await Product.findById(req.params.id);
  if (!product) {
    res.status(404);
    throw new Error('Product not found');
  }
  if (product.status !== 'pending_review') {
    res.status(400);
    throw new Error('Only products pending review can be approved');
  }

  product.finalPrice = finalPrice;
  if (discountPercent !== undefined) product.discountPercent = discountPercent;
  if (isHotDeal !== undefined) product.isHotDeal = isHotDeal;
  product.status = 'active';
  product.reviewedBy = req.user._id;
  product.reviewedAt = new Date();

  await product.save();
  res.json({ success: true, message: 'Product approved and now live', product });
});

// @desc    Admin rejects a product back to the seller with a reason
// @route   PATCH /api/admin/products/:id/reject
// @access  Private (admin)
const rejectProduct = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  if (!reason) {
    res.status(400);
    throw new Error('A rejection reason is required');
  }

  const product = await Product.findById(req.params.id);
  if (!product) {
    res.status(404);
    throw new Error('Product not found');
  }

  product.status = 'rejected';
  product.rejectionReason = reason;
  product.reviewedBy = req.user._id;
  product.reviewedAt = new Date();

  await product.save();
  res.json({ success: true, message: 'Product rejected', product });
});

// @desc    Admin edits an already-live product's price/discount/hot-deal flag anytime
// @route   PATCH /api/admin/products/:id/price
// @access  Private (admin)
const updateProductPricing = asyncHandler(async (req, res) => {
  const { finalPrice, discountPercent, isHotDeal } = req.body;

  const product = await Product.findById(req.params.id);
  if (!product) {
    res.status(404);
    throw new Error('Product not found');
  }

  if (finalPrice !== undefined) product.finalPrice = finalPrice;
  if (discountPercent !== undefined) product.discountPercent = discountPercent;
  if (isHotDeal !== undefined) product.isHotDeal = isHotDeal;

  await product.save();
  res.json({ success: true, product });
});

// @desc    Admin suspends a live product (pulls it from the storefront without deleting it)
// @route   PATCH /api/admin/products/:id/suspend
// @access  Private (admin)
const suspendProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) {
    res.status(404);
    throw new Error('Product not found');
  }
  product.status = 'suspended';
  await product.save();
  res.json({ success: true, message: 'Product suspended', product });
});

// @desc    Get all orders awaiting M-Pesa payment verification
// @route   GET /api/admin/orders/pending-payment
// @access  Private (admin)
const getPendingPaymentOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ paymentStatus: 'pending_verification' })
    .populate('buyer', 'name phone email')
    .sort('createdAt');

  res.json({ success: true, count: orders.length, orders });
});

// @desc    Admin confirms or rejects an order's M-Pesa payment after manual cross-check
// @route   PATCH /api/admin/orders/:id/verify-payment
// @access  Private (admin)
const verifyOrderPayment = asyncHandler(async (req, res) => {
  const { decision } = req.body; // "confirmed" or "rejected"

  if (!['confirmed', 'rejected'].includes(decision)) {
    res.status(400);
    throw new Error('Decision must be "confirmed" or "rejected"');
  }

  const order = await Order.findById(req.params.id);
  if (!order) {
    res.status(404);
    throw new Error('Order not found');
  }

  order.paymentStatus = decision;
  order.verifiedBy = req.user._id;
  order.verifiedAt = new Date();
  if (decision === 'rejected') order.orderStatus = 'cancelled';

  await order.save();
  res.json({ success: true, order });
});

// @desc    Get all users, filterable by role - for admin user management
// @route   GET /api/admin/users
// @access  Private (admin)
const getAllUsers = asyncHandler(async (req, res) => {
  const { role } = req.query;
  const filter = role ? { role } : {};
  const users = await User.find(filter).select('-password').sort('-createdAt');
  res.json({ success: true, count: users.length, users });
});

// @desc    Suspend or reactivate a user account
// @route   PATCH /api/admin/users/:id/status
// @access  Private (admin)
const setUserStatus = asyncHandler(async (req, res) => {
  const { isActive } = req.body;
  const user = await User.findByIdAndUpdate(req.params.id, { isActive }, { new: true }).select('-password');
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }
  res.json({ success: true, user });
});

module.exports = {
  getPendingProducts,
  approveProduct,
  rejectProduct,
  updateProductPricing,
  suspendProduct,
  getPendingPaymentOrders,
  verifyOrderPayment,
  getAllUsers,
  setUserStatus,
};
