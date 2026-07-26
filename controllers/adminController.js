const asyncHandler = require('express-async-handler');
const Product = require('../models/Product');
const Order = require('../models/Order');
const { User } = require('../models/User');

// @desc    Get ALL products regardless of status - the main dashboard product table
// @route   GET /api/admin/products?status=active&search=phone&page=1&limit=20
// @access  Private (admin)
const getAllProductsAdmin = asyncHandler(async (req, res) => {
  const { status, search, category, page = 1, limit = 20 } = req.query;

  const filter = {};
  if (status) filter.status = status;
  if (category) filter.category = category;
  if (search) filter.name = { $regex: search, $options: 'i' };

  const skip = (Number(page) - 1) * Number(limit);

  const [products, total] = await Promise.all([
    Product.find(filter)
      .populate('category', 'name')
      .populate('seller', 'name businessName shopName role email phone')
      .sort('-createdAt')
      .skip(skip)
      .limit(Number(limit)),
    Product.countDocuments(filter),
  ]);

  res.json({
    success: true,
    count: products.length,
    total,
    page: Number(page),
    pages: Math.ceil(total / Number(limit)),
    products,
  });
});

// @desc    Admin fully edits ANY field on ANY product, regardless of status
//          (name, description, category, stock, sellerPrice, finalPrice,
//          discountPercent, isHotDeal, and optionally replaces images)
// @route   PATCH /api/admin/products/:id
// @access  Private (admin)
const adminUpdateProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) {
    res.status(404);
    throw new Error('Product not found');
  }

  const editableFields = [
    'name',
    'description',
    'category',
    'stock',
    'sellerPrice',
    'finalPrice',
    'discountPercent',
    'isHotDeal',
  ];
  editableFields.forEach((field) => {
    if (req.body[field] !== undefined) product[field] = req.body[field];
  });

  // Admin can replace product images too (uploaded via the same multer/Cloudinary middleware)
  if (req.files && req.files.length > 0) {
    product.images = req.files.map((file) => file.path);
  }

  await product.save();
  res.json({ success: true, product });
});

// @desc    Admin reverses a suspension, putting a product back on the storefront
// @route   PATCH /api/admin/products/:id/reactivate
// @access  Private (admin)
const reactivateProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) {
    res.status(404);
    throw new Error('Product not found');
  }
  if (product.status !== 'suspended') {
    res.status(400);
    throw new Error('Only suspended products can be reactivated');
  }
  product.status = 'active';
  await product.save();
  res.json({ success: true, message: 'Product reactivated', product });
});

// @desc    Admin permanently removes a product from the platform (soft delete)
// @route   DELETE /api/admin/products/:id
// @access  Private (admin)
const adminDeleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
  if (!product) {
    res.status(404);
    throw new Error('Product not found');
  }
  res.json({ success: true, message: 'Product removed from the platform' });
});

// @desc    Get ALL orders (any payment/order status) - full order oversight
//          NOW populates items.product / items.seller / agent so the admin
//          panel's expandable order row can show buyer, seller-per-item,
//          agent, and commission without extra round trips.
// @route   GET /api/admin/orders?paymentStatus=confirmed&orderStatus=processing
// @access  Private (admin)
const getAllOrdersAdmin = asyncHandler(async (req, res) => {
  const { paymentStatus, orderStatus, page = 1, limit = 20 } = req.query;

  const filter = {};
  if (paymentStatus) filter.paymentStatus = paymentStatus;
  if (orderStatus) filter.orderStatus = orderStatus;

  const skip = (Number(page) - 1) * Number(limit);

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .populate('buyer', 'name phone email')
      .populate('items.product', 'name images')
      .populate('items.seller', 'name businessName shopName role')
      .populate('agent', 'name code commissionRate')
      .populate('verifiedBy', 'name')
      .sort('-createdAt')
      .skip(skip)
      .limit(Number(limit)),
    Order.countDocuments(filter),
  ]);

  res.json({
    success: true,
    count: orders.length,
    total,
    page: Number(page),
    pages: Math.ceil(total / Number(limit)),
    orders,
  });
});

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
  getAllProductsAdmin,
  adminUpdateProduct,
  reactivateProduct,
  adminDeleteProduct,
  getAllOrdersAdmin,
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