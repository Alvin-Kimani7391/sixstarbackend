const asyncHandler = require('express-async-handler');
const Product = require('../models/Product');
const Order = require('../models/Order');
const Payment = require('../models/Payment');
const ProductVariant = require('../models/ProductVariant');
const FlashSale = require('../models/FlashSale');
const TransactionFeeTier = require('../models/TransactionFeeTier');
const { User } = require('../models/User');
const safeSendEmail = require('../utils/safeSendEmail');
const {
  productApprovedTemplate,
  productRejectedTemplate,
  paymentDecisionTemplate,
} = require('../utils/emailTemplates');
const { interpretMpesaResult } = require('../utils/mpesaErrors');
const { getTransactionStatus } = require('../utils/payhero');

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
// @route   GET /api/admin/orders?paymentStatus=confirmed&orderStatus=processing&sellerId=...
// @access  Private (admin)
const getAllOrdersAdmin = asyncHandler(async (req, res) => {
  const { paymentStatus, orderStatus, sellerId, page = 1, limit = 20 } = req.query;

  const filter = {};
  if (paymentStatus) filter.paymentStatus = paymentStatus;
  if (orderStatus) filter.orderStatus = orderStatus;
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

// @desc    Aggregate marketplace earnings
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
        orderTransactionFees: { $sum: '$sellerFees.transactionFee' },
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
        totalTransactionFees: { $sum: '$orderTransactionFees' },
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
    totalTransactionFees: 0,
    totalAgentCommission: 0,
    ordersWithAgent: 0,
  };
  delete totals._id;

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
    // Net marketplace earnings now also nets out transaction fees collected
    // from sellers separately from the commission/agent-payout math — those
    // fees offset your own payment-processing costs, they aren't "marketplace
    // profit" in the same sense as commission, so they're broken out on
    // `totals.totalTransactionFees` rather than folded into this figure.
    netMarketplaceEarnings: (totals.totalMarketplaceCommission || 0) - (totals.totalAgentCommission || 0),
    roleBreakdown,
    topSellers,
    topAgents,
  });
});

// @desc    Paginated per-order earnings breakdown
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
    const transactionFeesTotal = (o.sellerFees || []).reduce((sum, f) => sum + (f.transactionFee || 0), 0);

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
      // NEW — per-seller tiered transaction fees charged on this order, plus
      // the order-wide total for a quick glance in the admin table.
      transactionFeesTotal,
      sellerFees: (o.sellerFees || []).map((f) => ({
        seller: f.seller,
        subtotal: f.subtotal,
        transactionFee: f.transactionFee,
        tier: f.tier,
      })),
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
    .sort('createdAt');

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
        sender: 'info',
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
        sender: 'info',
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

// @desc    Admin suspends a live product
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

// ============================================================
// PAYMENTS — MANUAL VERIFICATION QUEUE (M-Pesa SMS orders ONLY)
// ============================================================

// @desc    Get orders awaiting MANUAL M-Pesa payment verification.
//
//          FIX: this used to query { paymentStatus: 'pending_verification' }
//          with no paymentMethod filter. STK orders start life at exactly
//          that same status before the webhook resolves them — which meant
//          a buyer's STK order sitting mid-flow (or one whose webhook was
//          delayed) could appear in this queue looking exactly like a
//          manual order genuinely waiting for an admin to eyeball an M-Pesa
//          SMS. An admin clicking "Confirm" on it would mark an order paid
//          that was never actually paid for — a real loophole. STK payments
//          are ONLY ever resolved by the PayHero webhook (or the admin
//          "Recheck with M-Pesa" / "Cancel" actions below) — never by a
//          human eyeballing an SMS that doesn't exist for that order.
// @route   GET /api/admin/orders/pending-payment
// @access  Private (admin)
const getPendingPaymentOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ paymentStatus: 'pending_verification', paymentMethod: 'manual' })
    .populate('buyer', 'name phone email')
    .sort('createdAt');

  res.json({ success: true, count: orders.length, orders });
});

// @desc    Admin confirms or rejects a MANUAL order's M-Pesa payment after
//          manually cross-checking the pasted SMS. Blocked for STK orders —
//          see the comment above; there is no SMS to check for those, and
//          "confirming" one would mean an admin vouching for a payment they
//          have no way to actually verify.
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

  if (order.paymentMethod === 'stk') {
    res.status(400);
    throw new Error(
      'This order was paid via M-Pesa STK Push and is verified automatically by M-Pesa — it cannot be manually confirmed or rejected. Use "Recheck with M-Pesa" or "Cancel & Restore Stock" instead, under STK Push Issues.'
    );
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
        sender: 'info',
      },
      'Payment verification'
    );
  }
});

// ============================================================
// PAYMENTS — STK PUSH ISSUES (failed / stuck / abandoned attempts)
// ============================================================

// @desc    Orders paid via STK Push that are NOT resolved as paid — either
//          a definitive failure came back (wrong PIN, insufficient balance,
//          cancelled, timeout) or the webhook hasn't reported back yet.
//          These are never in the manual-verification queue (see above) —
//          this is the dedicated place admins monitor STK health and step
//          in if the automatic paymentReaper hasn't cleaned something up yet.
// @route   GET /api/admin/orders/stk-issues
// @access  Private (admin)
const getStkPaymentIssues = asyncHandler(async (req, res) => {
  const orders = await Order.find({
    paymentMethod: 'stk',
    paymentStatus: { $in: ['pending_verification', 'rejected'] },
    orderStatus: 'processing',
  })
    .populate('buyer', 'name phone email')
    .sort('stk.lastAttemptAt');

  res.json({ success: true, count: orders.length, orders });
});

// @desc    Admin manually re-polls PayHero for this order's most recent STK
//          attempt — a fallback for when the webhook is lost/delayed. Does
//          NOT let the admin declare a payment successful themselves; it
//          only relays what PayHero itself reports, using the exact same
//          ResultCode interpretation as the webhook.
// @route   PATCH /api/admin/orders/:id/stk-recheck
// @access  Private (admin)
const recheckStkPayment = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id).populate('buyer', 'name email');
  if (!order) {
    res.status(404);
    throw new Error('Order not found');
  }
  if (order.paymentMethod !== 'stk') {
    res.status(400);
    throw new Error('This order was not paid via STK Push');
  }
  if (order.paymentStatus === 'confirmed') {
    res.status(400);
    throw new Error('This order is already confirmed as paid');
  }

  const payment = await Payment.findOne({ order: order._id }).sort('-createdAt');
  if (!payment || !payment.payheroReference) {
    res.status(400);
    throw new Error('No STK attempt on record for this order to recheck');
  }

  let phResult;
  try {
    phResult = await getTransactionStatus(payment.payheroReference);
  } catch (err) {
    res.status(502);
    throw new Error(`Could not reach PayHero: ${err.message}`);
  }

  // Tolerate PayHero's status-check response shape, which nests the same
  // ResultCode/ResultDesc fields the webhook sends, sometimes under
  // `.transaction` or at the top level depending on account/version.
  const result = phResult.transaction || phResult;
  const resultCode = result.ResultCode ?? result.result_code ?? result.status_code;
  const resultDesc = result.ResultDesc ?? result.result_desc ?? result.status;

  if (resultCode === undefined || resultCode === null) {
    res.json({
      success: true,
      message: 'PayHero has no final result for this attempt yet — still pending.',
      raw: phResult,
    });
    return;
  }

  const interpreted = interpretMpesaResult(resultCode, resultDesc);
  const succeeded = interpreted.type === 'success';

  if (payment.status === 'queued') {
    payment.resultCode = Number(resultCode);
    payment.resultDesc = String(resultDesc || '');
    payment.status = succeeded ? 'success' : 'failed';
    payment.failureType = succeeded ? '' : interpreted.type;
    payment.mpesaReceiptNumber = result.MpesaReceiptNumber || result.mpesa_receipt || payment.mpesaReceiptNumber;
    await payment.save();
  }

  order.stk = {
    ...order.stk,
    status: succeeded ? 'success' : 'failed',
    failureType: succeeded ? '' : interpreted.type,
  };

  if (succeeded && order.paymentStatus !== 'confirmed') {
    order.paymentStatus = 'confirmed';
    order.verifiedAt = new Date();
    order.rejectionReason = '';
    order.mpesaCode = payment.mpesaReceiptNumber || order.mpesaCode;
    order.mpesaMessage = order.mpesaMessage || `M-Pesa STK Push — Receipt ${payment.mpesaReceiptNumber || ''}`;
  } else if (!succeeded && order.paymentStatus !== 'rejected') {
    order.paymentStatus = 'rejected';
    order.rejectionReason = interpreted.message;
  }

  await order.save();

  res.json({
    success: true,
    message: succeeded
      ? 'PayHero confirms this payment succeeded — order marked confirmed.'
      : `PayHero confirms this payment did not succeed: ${interpreted.message}`,
    order,
  });
});

// @desc    Admin force-cancels an unresolved STK order right now and
//          restores its reserved stock, instead of waiting for the
//          automatic paymentReaper sweep (utils/paymentReaper.js). Mirrors
//          the exact restoration logic used by orderController.cancelOrder
//          and the reaper, so stock/variant/Flash-Sale bookkeeping never
//          drifts depending on which path released it.
// @route   PATCH /api/admin/orders/:id/stk-cancel
// @access  Private (admin)
const forceCancelStkOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id).populate('buyer', 'name email');
  if (!order) {
    res.status(404);
    throw new Error('Order not found');
  }
  if (order.paymentMethod !== 'stk') {
    res.status(400);
    throw new Error('This action is only for STK Push orders');
  }
  if (order.paymentStatus === 'confirmed') {
    res.status(400);
    throw new Error('This order is already paid — it cannot be cancelled this way');
  }
  if (order.orderStatus === 'cancelled') {
    res.status(400);
    throw new Error('This order is already cancelled');
  }

  for (const item of order.items) {
    await Product.findByIdAndUpdate(item.product, { $inc: { stock: item.quantity } });
    if (item.variant) {
      await ProductVariant.findByIdAndUpdate(item.variant, { $inc: { stock: item.quantity } });
    }
    if (item.isFlashDeal && item.flashSale) {
      const restored = await FlashSale.findByIdAndUpdate(
        item.flashSale,
        { $inc: { stockSold: -item.quantity } },
        { new: true }
      );
      if (restored && restored.status === 'sold_out' && restored.stockSold < restored.stockAllocated) {
        const now = new Date();
        restored.status = restored.endAt < now ? 'ended' : restored.startAt <= now ? 'active' : 'scheduled';
        await restored.save();
      }
    }
  }

  order.orderStatus = 'cancelled';
  order.rejectionReason = order.rejectionReason || 'Cancelled by admin — payment was never completed.';
  await order.save();

  res.json({ success: true, message: 'Order cancelled and stock restored', order });
});

// @desc    Get all users, filterable by role
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

// ============================================================
// TRANSACTION FEES (seller-side payment-processing fee ladder — NEW)
// ------------------------------------------------------------
// Admin-configurable tiers, e.g.:
//   KES 1–49      -> 0
//   KES 50–499    -> 6
//   KES 500–999   -> 10
//   KES 1000–1499 -> 15
//   KES 1500–2499 -> 20
//   KES 2500+     -> 25   (amountTo left null = open-ended top tier)
//
// Every new order resolves and snapshots the fee that applies to each
// seller's subtotal in that order AT THE TIME it's placed (see
// resolveTransactionFee usage in orderController.createOrder) — editing the
// ladder here never rewrites past orders or earnings.
// ============================================================

// Overlap check for create/update — amountTo === null is treated as +Infinity.
async function hasTierOverlap(from, to, excludeId) {
  const upper = to == null ? Infinity : to;
  const tiers = await TransactionFeeTier.find({
    isActive: true,
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  });
  return tiers.some((t) => {
    const tUpper = t.amountTo == null ? Infinity : t.amountTo;
    return from <= tUpper && t.amountFrom <= upper;
  });
}

// @desc    Every tier, active or not — the full ladder for the admin screen.
// @route   GET /api/admin/transaction-fees
// @access  Private (admin)
const getAllTiersAdmin = asyncHandler(async (req, res) => {
  const tiers = await TransactionFeeTier.find().sort('amountFrom');
  res.json({ success: true, count: tiers.length, tiers });
});

// @desc    Add a new fee tier.
// @route   POST /api/admin/transaction-fees
// @access  Private (admin)
const createTransactionFeeTier = asyncHandler(async (req, res) => {
  const { amountFrom, amountTo, fee, label, isActive } = req.body;

  if (amountFrom === undefined || fee === undefined) {
    res.status(400);
    throw new Error('amountFrom and fee are required');
  }

  const from = Number(amountFrom);
  const to = amountTo === undefined || amountTo === null || amountTo === '' ? null : Number(amountTo);
  const feeVal = Number(fee);

  if (Number.isNaN(from) || from < 0) {
    res.status(400);
    throw new Error('amountFrom must be a valid non-negative number');
  }
  if (to !== null && (Number.isNaN(to) || to <= from)) {
    res.status(400);
    throw new Error('amountTo must be greater than amountFrom, or left blank for an open-ended top tier');
  }
  if (Number.isNaN(feeVal) || feeVal < 0) {
    res.status(400);
    throw new Error('fee must be a valid non-negative number');
  }

  const active = isActive !== undefined ? !!isActive : true;
  if (active && (await hasTierOverlap(from, to))) {
    res.status(400);
    throw new Error(
      'This range overlaps an existing active tier. Adjust the range or deactivate the conflicting tier first.'
    );
  }

  const tier = await TransactionFeeTier.create({
    amountFrom: from,
    amountTo: to,
    fee: feeVal,
    label: label || '',
    isActive: active,
  });

  res.status(201).json({ success: true, tier });
});

// @desc    Edit an existing fee tier.
// @route   PATCH /api/admin/transaction-fees/:id
// @access  Private (admin)
const updateTransactionFeeTier = asyncHandler(async (req, res) => {
  const tier = await TransactionFeeTier.findById(req.params.id);
  if (!tier) {
    res.status(404);
    throw new Error('Tier not found');
  }

  const from = req.body.amountFrom !== undefined ? Number(req.body.amountFrom) : tier.amountFrom;
  const to =
    req.body.amountTo === undefined
      ? tier.amountTo
      : req.body.amountTo === null || req.body.amountTo === ''
      ? null
      : Number(req.body.amountTo);
  const feeVal = req.body.fee !== undefined ? Number(req.body.fee) : tier.fee;
  const isActive = req.body.isActive !== undefined ? !!req.body.isActive : tier.isActive;

  if (Number.isNaN(from) || from < 0) {
    res.status(400);
    throw new Error('amountFrom must be a valid non-negative number');
  }
  if (to !== null && (Number.isNaN(to) || to <= from)) {
    res.status(400);
    throw new Error('amountTo must be greater than amountFrom, or left blank for an open-ended top tier');
  }
  if (Number.isNaN(feeVal) || feeVal < 0) {
    res.status(400);
    throw new Error('fee must be a valid non-negative number');
  }

  if (isActive && (await hasTierOverlap(from, to, tier._id))) {
    res.status(400);
    throw new Error(
      'This range overlaps an existing active tier. Adjust the range or deactivate the conflicting tier first.'
    );
  }

  tier.amountFrom = from;
  tier.amountTo = to;
  tier.fee = feeVal;
  tier.isActive = isActive;
  if (req.body.label !== undefined) tier.label = req.body.label;

  await tier.save();
  res.json({ success: true, tier });
});

// @desc    Delete a fee tier entirely.
// @route   DELETE /api/admin/transaction-fees/:id
// @access  Private (admin)
const deleteTransactionFeeTier = asyncHandler(async (req, res) => {
  const tier = await TransactionFeeTier.findByIdAndDelete(req.params.id);
  if (!tier) {
    res.status(404);
    throw new Error('Tier not found');
  }
  res.json({ success: true, message: 'Tier deleted' });
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
  getStkPaymentIssues,
  recheckStkPayment,
  forceCancelStkOrder,
  getAllUsers,
  setUserStatus,
  getEarningsSummary,
  getEarningsOrders,
  // Transaction fee tiers (NEW)
  getAllTiersAdmin,
  createTransactionFeeTier,
  updateTransactionFeeTier,
  deleteTransactionFeeTier,
};