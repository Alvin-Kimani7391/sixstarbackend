const asyncHandler = require('express-async-handler');
const RFQRequest = require('../models/RFQRequest');
const RFQBid = require('../models/RFQBid');
const RFQMessage = require('../models/RFQMessage');
const Product = require('../models/Product');
const { User } = require('../models/User');
const safeSendEmail = require('../utils/safeSendEmail');
const { maskIdentity } = require('../utils/privacy');
const {
  rfqPostedBuyerTemplate,
  rfqClosedTemplate,
  relevantRfqSellerTemplate,
} = require('../utils/emailTemplates.rfq');

// Default bidding window if the buyer doesn't specify one relative to their
// requiredDate — 14 days from creation, capped at requiredDate.
const DEFAULT_BIDDING_DAYS = 14;

/* ================================================================ */
/* BUYER                                                              */
/* ================================================================ */

// @desc    Buyer creates a Request for Quote
// @route   POST /api/rfq
// @access  Private (buyer)
const createRFQ = asyncHandler(async (req, res) => {
  if (req.user.role !== 'buyer') {
    res.status(403);
    throw new Error('Only buyers can post a Request for Quote');
  }

  const {
    productName,
    category,
    quantity,
    unit,
    minBudget,
    maxBudget,
    budgetType,
    location,
    deliveryRequired,
    deliveryBudget,
    requiredDate,
    description,
  } = req.body;

  if (!productName || !quantity || !unit || !minBudget || !maxBudget || !location || !requiredDate || !description) {
    res.status(400);
    throw new Error('Please fill in all required fields');
  }
  if (Number(minBudget) > Number(maxBudget)) {
    res.status(400);
    throw new Error('Minimum budget cannot be greater than maximum budget');
  }

  const requiredDateObj = new Date(requiredDate);
  const defaultExpiry = new Date(Date.now() + DEFAULT_BIDDING_DAYS * 24 * 60 * 60 * 1000);
  const expiresAt = requiredDateObj < defaultExpiry ? requiredDateObj : defaultExpiry;

  const rfq = await RFQRequest.create({
    buyer: req.user._id,
    productName,
    productImage: req.file ? req.file.path : '',
    category: category || undefined,
    quantity,
    unit,
    minBudget,
    maxBudget,
    budgetType: budgetType || 'per_unit',
    location,
    deliveryRequired: deliveryRequired !== undefined ? deliveryRequired : true,
    deliveryBudget: deliveryBudget || 0,
    requiredDate: requiredDateObj,
    description,
    expiresAt,
  });

  res.status(201).json({ success: true, rfq });

  const buyer = await User.findById(req.user._id).select('name email');
  if (buyer?.email) {
    safeSendEmail(
      {
        to: buyer.email,
        subject: `Request Posted - ${rfq.productName}`,
        html: rfqPostedBuyerTemplate({ rfq, buyerName: buyer.name }),
      },
      'RFQ posted'
    );
  }

  // Notify sellers in the same category — best-effort, never blocks the response.
  if (category) {
    try {
      const matchingSellers = await User.find({
        role: { $in: ['wholesaler', 'retailer'] },
        isActive: true,
      })
        .select('name email')
        .limit(200); // safety cap; swap for a real category-subscription query as the catalog grows

      matchingSellers.forEach((seller) => {
        if (seller.email) {
          safeSendEmail(
            {
              to: seller.email,
              subject: `New Buyer Request - ${rfq.productName}`,
              html: relevantRfqSellerTemplate({ rfq, sellerName: seller.name }),
            },
            'RFQ seller notification'
          );
        }
      });
    } catch (err) {
      console.error('RFQ seller-notification lookup failed:', err.message);
    }
  }
});

// @desc    Public RFQ feed — buyer identity always masked
// @route   GET /api/rfq?category=&location=&status=&page=&limit=
// @access  Public
const getPublicRFQs = asyncHandler(async (req, res) => {
  const { category, location, status, page = 1, limit = 20 } = req.query;

  const filter = { isSuspended: false, status: { $in: ['OPEN', 'BIDDING'] } };
  if (status && ['OPEN', 'BIDDING'].includes(status)) filter.status = status;
  if (category) filter.category = category;
  if (location) filter.location = { $regex: location, $options: 'i' };

  const skip = (Number(page) - 1) * Number(limit);

  const [rfqs, total] = await Promise.all([
    RFQRequest.find(filter)
      .select('-buyer -cancelReason -isSuspended -suspendReason -flaggedForReview')
      .populate('category', 'name')
      .sort('-createdAt')
      .skip(skip)
      .limit(Number(limit)),
    RFQRequest.countDocuments(filter),
  ]);

  res.json({
    success: true,
    count: rfqs.length,
    total,
    page: Number(page),
    pages: Math.ceil(total / Number(limit)),
    rfqs, // already buyer-anonymous — no maskIdentity needed since `buyer` was never selected
  });
});

// @desc    Public RFQ detail. Never exposes buyer contact info; never
//          exposes other sellers' bids.
// @route   GET /api/rfq/:id
// @access  Public
const getRFQDetail = asyncHandler(async (req, res) => {
  const rfq = await RFQRequest.findOne({ _id: req.params.id, isSuspended: false }).populate('category', 'name');
  if (!rfq) {
    res.status(404);
    throw new Error('Request not found');
  }
  res.json({ success: true, rfq: rfq.toPublicJSON() });
});

// @desc    Buyer's own RFQs (full detail, including their own view)
// @route   GET /api/rfq/mine
// @access  Private (buyer)
const getMyRFQs = asyncHandler(async (req, res) => {
  const rfqs = await RFQRequest.find({ buyer: req.user._id }).populate('category', 'name').sort('-createdAt');
  res.json({ success: true, count: rfqs.length, rfqs });
});

// @desc    Similar existing marketplace products for a draft/posted RFQ
//          (report section 9) — lets the buyer buy now instead of waiting.
// @route   GET /api/rfq/similar-products?productName=&category=&minBudget=&maxBudget=
// @access  Public
const getSimilarProducts = asyncHandler(async (req, res) => {
  const { productName, category, minBudget, maxBudget } = req.query;

  const filter = { status: 'active', isActive: { $ne: false } };
  if (category) filter.category = category;
  if (productName) filter.name = { $regex: productName, $options: 'i' };
  if (minBudget || maxBudget) {
    filter.finalPrice = {};
    if (minBudget) filter.finalPrice.$gte = Number(minBudget) * 0.8; // small tolerance band
    if (maxBudget) filter.finalPrice.$lte = Number(maxBudget) * 1.2;
  }

  const products = await Product.find(filter)
    .select('name images finalPrice discountPercent category')
    .limit(6);

  res.json({ success: true, count: products.length, products });
});

// @desc    Buyer selects the winning seller for their RFQ. Delegated to
//          rfqBidController.acceptBid for the actual bid-status transition
//          — this endpoint exists as a convenience alias some frontends
//          may prefer (POST /api/rfq/:id/select-seller with a bidId body).
// @route   PATCH /api/rfq/:id/close
// @access  Private (buyer, owner only)
const closeRFQ = asyncHandler(async (req, res) => {
  const rfq = await RFQRequest.findById(req.params.id);
  if (!rfq) {
    res.status(404);
    throw new Error('Request not found');
  }
  if (String(rfq.buyer) !== String(req.user._id)) {
    res.status(403);
    throw new Error('Not authorized');
  }
  if (rfq.status === 'CLOSED') {
    res.status(400);
    throw new Error('Request is already closed');
  }

  rfq.status = 'CLOSED';
  rfq.closedAt = new Date();
  await rfq.save();

  res.json({ success: true, message: 'Request closed', rfq });

  // Notify buyer + selected seller (if any) that the RFQ has closed.
  const buyer = await User.findById(rfq.buyer).select('name email');
  if (buyer?.email) {
    safeSendEmail(
      {
        to: buyer.email,
        subject: `Request Closed - ${rfq.productName}`,
        html: rfqClosedTemplate({ rfq, recipientName: buyer.name, isBuyer: true }),
      },
      'RFQ closed (buyer)'
    );
  }
  if (rfq.selectedSeller) {
    const seller = await User.findById(rfq.selectedSeller).select('name email');
    if (seller?.email) {
      safeSendEmail(
        {
          to: seller.email,
          subject: `Request Closed - ${rfq.productName}`,
          html: rfqClosedTemplate({ rfq, recipientName: seller.name, isBuyer: false }),
        },
        'RFQ closed (seller)'
      );
    }
  }
});

// @desc    Buyer cancels their own RFQ (before or after bids exist)
// @route   PATCH /api/rfq/:id/cancel
// @access  Private (buyer, owner only)
const cancelRFQ = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  const rfq = await RFQRequest.findById(req.params.id);
  if (!rfq) {
    res.status(404);
    throw new Error('Request not found');
  }
  if (String(rfq.buyer) !== String(req.user._id)) {
    res.status(403);
    throw new Error('Not authorized');
  }
  if (['CLOSED', 'CANCELLED'].includes(rfq.status)) {
    res.status(400);
    throw new Error('Request is already closed or cancelled');
  }

  rfq.status = 'CANCELLED';
  rfq.cancelReason = reason || '';
  rfq.closedAt = new Date();
  await rfq.save();

  res.json({ success: true, message: 'Request cancelled', rfq });
});

/* ================================================================ */
/* PROFILE — combined recent activity (report requirement: buyer/seller  */
/* can see recent messages/bids from their profile)                     */
/* ================================================================ */

// @desc    Recent RFQ activity for the logged-in user's profile page —
//          their most recent messages AND their most recent bids/RFQs,
//          merged and sorted by recency. Works for buyers and sellers.
// @route   GET /api/rfq/profile/activity?limit=10
// @access  Private
const getMyRFQActivity = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  const userId = req.user._id;

  const [messages, bids, myRfqs] = await Promise.all([
    RFQMessage.find({ $or: [{ sender: userId }, { receiver: userId }] })
      .populate('rfq', 'productName productImage status')
      .sort('-createdAt')
      .limit(limit),
    req.user.role === 'buyer'
      ? []
      : RFQBid.find({ seller: userId }).populate('rfq', 'productName productImage status').sort('-updatedAt').limit(limit),
    req.user.role === 'buyer'
      ? RFQRequest.find({ buyer: userId }).select('productName productImage status bidCount').sort('-updatedAt').limit(limit)
      : [],
  ]);

  const activity = [
    ...messages.map((m) => ({
      type: 'message',
      rfq: m.rfq,
      preview: m.messageType === 'image' ? '📷 Photo' : m.message,
      unread: !m.read && String(m.receiver) === String(userId),
      at: m.createdAt,
    })),
    ...bids.map((b) => ({
      type: 'bid',
      rfq: b.rfq,
      status: b.status,
      unitPrice: b.unitPrice,
      at: b.updatedAt,
    })),
    ...myRfqs.map((r) => ({
      type: 'my_request',
      rfq: { _id: r._id, productName: r.productName, productImage: r.productImage },
      status: r.status,
      bidCount: r.bidCount,
      at: r.updatedAt,
    })),
  ]
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, limit);

  res.json({ success: true, activity });
});

/* ================================================================ */
/* ADMIN (report section 16/17)                                       */
/* ================================================================ */

// @desc    Admin RFQ monitoring dashboard feed
// @route   GET /api/rfq/admin?status=&flagged=&page=&limit=
// @access  Private (admin)
const adminGetAllRFQs = asyncHandler(async (req, res) => {
  const { status, flagged, page = 1, limit = 20 } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (flagged === 'true') filter.flaggedForReview = true;

  const skip = (Number(page) - 1) * Number(limit);
  const [rfqs, total] = await Promise.all([
    RFQRequest.find(filter)
      .populate('buyer', 'name email phone')
      .populate('selectedSeller', 'name email businessName shopName')
      .sort('-createdAt')
      .skip(skip)
      .limit(Number(limit)),
    RFQRequest.countDocuments(filter),
  ]);

  res.json({ success: true, count: rfqs.length, total, page: Number(page), pages: Math.ceil(total / Number(limit)), rfqs });
});

// @desc    Admin suspends/unsuspends an RFQ (pulls it from the public feed)
// @route   PATCH /api/rfq/admin/:id/suspend
// @access  Private (admin)
const adminSuspendRFQ = asyncHandler(async (req, res) => {
  const { suspend, reason } = req.body;
  const rfq = await RFQRequest.findById(req.params.id);
  if (!rfq) {
    res.status(404);
    throw new Error('Request not found');
  }
  rfq.isSuspended = suspend !== false;
  rfq.suspendReason = rfq.isSuspended ? reason || '' : '';
  await rfq.save();
  res.json({ success: true, rfq });
});

// @desc    Admin permanently removes an inappropriate RFQ
// @route   DELETE /api/rfq/admin/:id
// @access  Private (admin)
const adminDeleteRFQ = asyncHandler(async (req, res) => {
  const rfq = await RFQRequest.findByIdAndDelete(req.params.id);
  if (!rfq) {
    res.status(404);
    throw new Error('Request not found');
  }
  await Promise.all([RFQBid.deleteMany({ rfq: rfq._id }), RFQMessage.deleteMany({ rfq: rfq._id })]);
  res.json({ success: true, message: 'Request permanently removed' });
});

// @desc    Admin view of users flagged for repeated off-platform-contact attempts
// @route   GET /api/rfq/admin/flagged-users
// @access  Private (admin)
const adminGetFlaggedUsers = asyncHandler(async (req, res) => {
  const users = await User.find({ $or: [{ flaggedForReview: true }, { messagingRestricted: true }] })
    .select('name email role contactShareWarnings messagingRestricted messagingRestrictedAt flaggedForReview')
    .sort('-messagingRestrictedAt');
  res.json({ success: true, count: users.length, users });
});

// @desc    Admin lifts a messaging restriction after review
// @route   PATCH /api/rfq/admin/users/:id/lift-restriction
// @access  Private (admin)
const adminLiftRestriction = asyncHandler(async (req, res) => {
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { messagingRestricted: false, flaggedForReview: false, contactShareWarnings: 0 },
    { new: true }
  ).select('name email messagingRestricted');
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }
  res.json({ success: true, user });
});

module.exports = {
  createRFQ,
  getPublicRFQs,
  getRFQDetail,
  getMyRFQs,
  getSimilarProducts,
  closeRFQ,
  cancelRFQ,
  getMyRFQActivity,
  adminGetAllRFQs,
  adminSuspendRFQ,
  adminDeleteRFQ,
  adminGetFlaggedUsers,
  adminLiftRestriction,
};