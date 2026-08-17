const asyncHandler = require('express-async-handler');
const Product = require('../models/Product');
const Order = require('../models/Order');
const { User } = require('../models/User');
const safeSendEmail = require('../utils/safeSendEmail');
const {
  productApprovedTemplate,
  productRejectedTemplate,
  paymentDecisionTemplate,
} = require('../utils/emailTemplates');

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
//
//          Also accepts an optional ?sellerId= filter — used by the Seller
//          Verification modal to pull "this seller's orders" so the admin
//          can review fulfillment history and pickup location alongside
//          identity/business/tax documents in one place.
// @route   GET /api/admin/orders?paymentStatus=confirmed&orderStatus=processing&sellerId=...
// @access  Private (admin)
const getAllOrdersAdmin = asyncHandler(async (req, res) => {
  const { paymentStatus, orderStatus, sellerId, page = 1, limit = 20 } = req.query;

  const filter = {};
  if (paymentStatus) filter.paymentStatus = paymentStatus;
  if (orderStatus) filter.orderStatus = orderStatus;
  // Matches any order that has at least one line item sold by this seller —
  // the item-level breakdown (still populated below) is what actually
  // isolates that seller's items on the frontend.
  if (sellerId) filter.items = { $elemMatch: { seller: sellerId } };

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


// ============================================================
// EARNINGS
// ============================================================

// @desc    Aggregate marketplace earnings — gross commission, agent payouts,
//          net earnings, plus breakdowns by seller role, top sellers, and
//          top agents. Defaults to CONFIRMED-payment orders only (real
//          money), but accepts paymentStatus=all / pending_verification /
//          rejected to inspect other slices.
// @route   GET /api/admin/earnings/summary?from=&to=&paymentStatus=confirmed
// @access  Private (admin)
const getEarningsSummary = asyncHandler(async (req, res) => {
  const { from, to, paymentStatus = 'confirmed' } = req.query;

  const match = {};
  if (paymentStatus && paymentStatus !== 'all') match.paymentStatus = paymentStatus;
  if (from || to) {
    match.createdAt = {};
    if (from) match.createdAt.$gte = new Date(from);
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      match.createdAt.$lte = toDate;
    }
  }

  const [totalsAgg] = await Order.aggregate([
    { $match: match },
    {
      $addFields: {
        orderMarketplaceCommission: { $sum: '$items.commissionAmount' },
        orderSellerPayout: { $sum: '$items.sellerPayout' },
      },
    },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        totalRevenue: { $sum: '$totalAmount' },
        totalDeliveryFees: { $sum: '$deliveryFee' },
        totalMarketplaceCommission: { $sum: '$orderMarketplaceCommission' },
        totalSellerPayout: { $sum: '$orderSellerPayout' },
        totalAgentCommission: { $sum: '$commissionAmount' },
        ordersWithAgent: { $sum: { $cond: [{ $ifNull: ['$agent', false] }, 1, 0] } },
      },
    },
  ]);

  const totals = totalsAgg || {
    totalOrders: 0,
    totalRevenue: 0,
    totalDeliveryFees: 0,
    totalMarketplaceCommission: 0,
    totalSellerPayout: 0,
    totalAgentCommission: 0,
    ordersWithAgent: 0,
  };
  delete totals._id;

  // --- By seller role (wholesaler vs retailer) ---
  const roleBreakdown = await Order.aggregate([
    { $match: match },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.sellerRole',
        commission: { $sum: '$items.commissionAmount' },
        payout: { $sum: '$items.sellerPayout' },
        itemsSold: { $sum: '$items.quantity' },
      },
    },
    { $sort: { commission: -1 } },
  ]);

  // --- Top 10 sellers by commission generated ---
  const topSellersRaw = await Order.aggregate([
    { $match: match },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.seller',
        role: { $first: '$items.sellerRole' },
        commission: { $sum: '$items.commissionAmount' },
        payout: { $sum: '$items.sellerPayout' },
        itemsSold: { $sum: '$items.quantity' },
      },
    },
    { $sort: { commission: -1 } },
    { $limit: 10 },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'sellerDoc' } },
    { $unwind: { path: '$sellerDoc', preserveNullAndEmptyArrays: true } },
  ]);

  const topSellers = topSellersRaw.map((s) => ({
    id: s._id,
    name: s.sellerDoc?.businessName || s.sellerDoc?.shopName || s.sellerDoc?.name || 'Unknown seller',
    role: s.role,
    commission: s.commission,
    payout: s.payout,
    itemsSold: s.itemsSold,
  }));

  // --- Top 10 agents by commission PAID OUT ---
  const topAgentsRaw = await Order.aggregate([
    { $match: { ...match, agent: { $ne: null } } },
    {
      $group: {
        _id: '$agent',
        commission: { $sum: '$commissionAmount' },
        orders: { $sum: 1 },
      },
    },
    { $sort: { commission: -1 } },
    { $limit: 10 },
    { $lookup: { from: 'agents', localField: '_id', foreignField: '_id', as: 'agentDoc' } },
    { $unwind: { path: '$agentDoc', preserveNullAndEmptyArrays: true } },
  ]);

  const topAgents = topAgentsRaw.map((a) => ({
    id: a._id,
    name: a.agentDoc?.name || 'Unknown agent',
    code: a.agentDoc?.code || '',
    commission: a.commission,
    orders: a.orders,
  }));

  res.json({
    success: true,
    filters: { from: from || null, to: to || null, paymentStatus },
    totals,
    netMarketplaceEarnings: (totals.totalMarketplaceCommission || 0) - (totals.totalAgentCommission || 0),
    roleBreakdown,
    topSellers,
    topAgents,
  });
});

// @desc    Paginated per-order earnings breakdown — every order with its
//          marketplace commission, agent commission, seller payout, and
//          full per-item commission detail. This is the "each earning with
//          its associated order" view.
// @route   GET /api/admin/earnings/orders?from=&to=&paymentStatus=confirmed&search=&page=&limit=
// @access  Private (admin)
const getEarningsOrders = asyncHandler(async (req, res) => {
  const { from, to, paymentStatus = 'confirmed', search, page = 1, limit = 20 } = req.query;

  const filter = {};
  if (paymentStatus && paymentStatus !== 'all') filter.paymentStatus = paymentStatus;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = toDate;
    }
  }
  if (search && search.trim()) {
    const q = search.trim();
    filter.$or = [
      { orderNumber: { $regex: q, $options: 'i' } },
      { mpesaCode: { $regex: q, $options: 'i' } },
    ];
  }

  const skip = (Number(page) - 1) * Number(limit);

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .populate('buyer', 'name phone email')
      .populate('agent', 'name code commissionRate')
      .populate('items.seller', 'name businessName shopName role')
      .sort('-createdAt')
      .skip(skip)
      .limit(Number(limit)),
    Order.countDocuments(filter),
  ]);

  const results = orders.map((o) => {
    const marketplaceCommission = o.items.reduce((sum, i) => sum + (i.commissionAmount || 0), 0);
    const sellerPayout = o.items.reduce((sum, i) => sum + (i.sellerPayout || 0), 0);
    const agentCommission = o.commissionAmount || 0;

    return {
      _id: o._id,
      orderNumber: o.orderNumber,
      buyer: o.buyer,
      createdAt: o.createdAt,
      paymentStatus: o.paymentStatus,
      orderStatus: o.orderStatus,
      totalAmount: o.totalAmount,
      itemsCount: o.items.length,
      marketplaceCommission,
      sellerPayout,
      agent: o.agent,
      agentCommission,
      netMarketplaceEarning: marketplaceCommission - agentCommission,
      items: o.items.map((i) => ({
        name: i.name,
        seller: i.seller,
        quantity: i.quantity,
        priceAtPurchase: i.priceAtPurchase,
        commissionRate: i.commissionRate,
        commissionAmount: i.commissionAmount,
        sellerPayout: i.sellerPayout,
      })),
    };
  });

  res.json({
    success: true,
    count: results.length,
    total,
    page: Number(page),
    pages: Math.ceil(total / Number(limit)),
    orders: results,
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

  const seller = await User.findById(product.seller).select('name email');
  if (seller?.email) {
    safeSendEmail(
      {
        to: seller.email,
        subject: `Product Approved - ${product.name}`,
        html: productApprovedTemplate({ product, sellerName: seller.name }),
      },
      'Product approved'
    );
  }
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

  const seller = await User.findById(product.seller).select('name email');
  if (seller?.email) {
    safeSendEmail(
      {
        to: seller.email,
        subject: `Product Needs Changes - ${product.name}`,
        html: productRejectedTemplate({ product, sellerName: seller.name, reason }),
      },
      'Product rejected'
    );
  }
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

  const order = await Order.findById(req.params.id).populate('buyer', 'name email');
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

  if (order.buyer?.email) {
    safeSendEmail(
      {
        to: order.buyer.email,
        subject:
          decision === 'confirmed'
            ? `Payment Confirmed - ${order.orderNumber}`
            : `Payment Could Not Be Verified - ${order.orderNumber}`,
        html: paymentDecisionTemplate({ order, buyerName: order.buyer.name, decision }),
      },
      'Payment verification'
    );
  }
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
  getEarningsSummary,   // <-- add
  getEarningsOrders,    // <-- add
};