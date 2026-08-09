/* ============================================================
   SIX STAR SUPPLIERS — Flash Sale controller
   ============================================================
   Seller flow:
     POST   /api/flash-sales           submitFlashSale
     GET    /api/flash-sales/my        getMyFlashSales
     PATCH  /api/flash-sales/:id/cancel  cancelMyFlashSale

   Public storefront:
     GET    /api/flash-sales/active    getActiveFlashSales

   Admin flow (mounted under /api/admin in adminRoutes.js):
     GET    /flash-sales               getAllFlashSalesAdmin
     GET    /flash-sales/pending       getPendingFlashSales
     PATCH  /flash-sales/:id/approve   approveFlashSale
     PATCH  /flash-sales/:id/reject    rejectFlashSale

   Order-controller integration (NOT wired automatically since
   orderController.js wasn't part of this change set):
     const { recordFlashSaleSale } = require('./flashSaleController');
     await recordFlashSaleSale(productId, quantity);
   Call this whenever a buyer's order item is for a product that
   has an active Flash Sale, right where you already decrement the
   product's regular stock. It depletes the Flash Sale's own stock
   pool and flips it to 'sold_out' the instant it runs out — even
   mid-window, without waiting for the next scheduler tick.

   Emails: every submission fires a receipt to the submitting seller
   AND a review-needed alert to admins; every approve/reject fires a
   decision email back to the seller. All sends are fire-and-forget
   (safeSendEmail) so a SendGrid hiccup never breaks the API response.
   ============================================================ */

const asyncHandler = require('express-async-handler');
const FlashSale = require('../models/FlashSale');
const Product = require('../models/Product');
const { User } = require('../models/User');
const { FLASH_SALE_START_HOUR, MIN_LEAD_TIME_HOURS } = require('../utils/flashSaleConfig');
const safeSendEmail = require('../utils/safeSendEmail');
const getAdminEmails = require('../utils/getAdminEmails');
const {
  flashSaleSubmittedSellerTemplate,
  flashSaleSubmittedAdminTemplate,
  flashSaleDecisionTemplate,
} = require('../utils/emailTemplates');

const ACTIVE_PIPELINE_STATUSES = ['pending_review', 'approved', 'scheduled', 'active'];
const CANCELLABLE_STATUSES = ['pending_review', 'approved', 'scheduled'];

// ---------------------------------------------------------------------------
// Turns a plain "YYYY-MM-DD" (or any parseable date) into the three moments
// that matter for a Flash Sale run: the calendar day, its 2:00 PM start, and
// its midnight end. Runs on server local time — if your server isn't already
// set to Africa/Nairobi (EAT, UTC+3, no DST), set process.env.TZ = 'Africa/Nairobi'
// at the very top of server.js so "2:00 PM" means 2:00 PM Nairobi time.
// ---------------------------------------------------------------------------
function buildSaleWindow(saleDateInput) {
  const parsed = new Date(saleDateInput);
  if (Number.isNaN(parsed.getTime())) {
    const err = new Error('Please provide a valid sale date');
    err.status = 400;
    throw err;
  }
  const y = parsed.getFullYear();
  const m = parsed.getMonth();
  const d = parsed.getDate();

  const saleDate = new Date(y, m, d, 0, 0, 0, 0);
  const startAt = new Date(y, m, d, FLASH_SALE_START_HOUR, 0, 0, 0);
  const endAt = new Date(y, m, d, 23, 59, 59, 999);

  return { saleDate, startAt, endAt };
}

// @desc    Seller submits one of their own LIVE products for a Flash Sale slot
// @route   POST /api/flash-sales
// @access  Private (wholesaler, retailer)
const submitFlashSale = asyncHandler(async (req, res) => {
  const { productId, flashSalePrice, stock, saleDate } = req.body;

  if (!productId || !flashSalePrice || !stock || !saleDate) {
    res.status(400);
    throw new Error('productId, flashSalePrice, stock and saleDate are all required');
  }

  const product = await Product.findById(productId);
  if (!product) {
    res.status(404);
    throw new Error('Product not found');
  }
  if (product.seller.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error('Not authorized to submit this product');
  }
  if (product.status !== 'active') {
    res.status(400);
    throw new Error('Only live (active) products can be submitted to a Flash Sale');
  }

  const referencePrice = Number(product.finalPrice || product.sellerPrice || 0);
  const price = Number(flashSalePrice);
  if (Number.isNaN(price) || price <= 0) {
    res.status(400);
    throw new Error('Please provide a valid Flash Sale price');
  }
  if (!referencePrice || price >= referencePrice) {
    res.status(400);
    throw new Error('The Flash Sale price must be lower than the product\u2019s current selling price');
  }

  const allocatedStock = Number(stock);
  if (!Number.isInteger(allocatedStock) || allocatedStock < 1) {
    res.status(400);
    throw new Error('Please allocate a valid whole number of units for the Flash Sale');
  }
  if (allocatedStock > product.stock) {
    res.status(400);
    throw new Error(`You only have ${product.stock} unit(s) in stock \u2014 reduce the Flash Sale allocation`);
  }

  const { saleDate: normalizedSaleDate, startAt, endAt } = buildSaleWindow(saleDate);

  const minStartAt = new Date(Date.now() + MIN_LEAD_TIME_HOURS * 60 * 60 * 1000);
  if (startAt < minStartAt) {
    res.status(400);
    throw new Error(
      `Flash Sale submissions must be made at least ${MIN_LEAD_TIME_HOURS} hours before the ${FLASH_SALE_START_HOUR === 14 ? '2:00 PM' : ''} start time`
    );
  }

  const existing = await FlashSale.findOne({
    product: product._id,
    status: { $in: ACTIVE_PIPELINE_STATUSES },
  });
  if (existing) {
    res.status(400);
    throw new Error('This product already has an active or pending Flash Sale submission');
  }

  const discountPercent = Math.max(1, Math.min(99, Math.round(((referencePrice - price) / referencePrice) * 100)));

  const flashSale = await FlashSale.create({
    product: product._id,
    seller: req.user._id,
    originalPrice: referencePrice,
    flashSalePrice: price,
    discountPercent,
    stockAllocated: allocatedStock,
    saleDate: normalizedSaleDate,
    startAt,
    endAt,
    status: 'pending_review',
  });

  const populated = await FlashSale.findById(flashSale._id).populate(
    'product',
    'name images finalPrice sellerPrice stock category'
  );

  res.status(201).json({ success: true, flashSale: populated });

  // ---- Receipt emails: one to the seller, one to admins ----
  if (req.user.email) {
    safeSendEmail(
      {
        to: req.user.email,
        subject: `Flash Sale Submitted - ${product.name}`,
        html: flashSaleSubmittedSellerTemplate({
          sellerName: req.user.name,
          product,
          flashSale: populated,
        }),
      },
      'Flash Sale receipt (seller)'
    );
  }

  getAdminEmails()
    .then((adminEmails) => {
      adminEmails.forEach((to) => {
        safeSendEmail(
          {
            to,
            subject: `New Flash Sale Submitted - ${product.name}`,
            html: flashSaleSubmittedAdminTemplate({
              sellerName: req.user.name,
              sellerEmail: req.user.email,
              product,
              flashSale: populated,
            }),
          },
          'Flash Sale receipt (admin)'
        );
      });
    })
    .catch((err) => console.error('Failed to resolve admin emails:', err.message));
});

// @desc    Seller's own Flash Sale submissions, any status
// @route   GET /api/flash-sales/my
// @access  Private (wholesaler, retailer)
const getMyFlashSales = asyncHandler(async (req, res) => {
  const flashSales = await FlashSale.find({ seller: req.user._id })
    .populate('product', 'name images finalPrice sellerPrice stock status')
    .sort('-createdAt');

  res.json({ success: true, count: flashSales.length, flashSales });
});

// @desc    Seller cancels their own submission before it goes live
// @route   PATCH /api/flash-sales/:id/cancel
// @access  Private (owner only)
const cancelMyFlashSale = asyncHandler(async (req, res) => {
  const flashSale = await FlashSale.findById(req.params.id);
  if (!flashSale) {
    res.status(404);
    throw new Error('Flash Sale submission not found');
  }
  if (flashSale.seller.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error('Not authorized');
  }
  if (!CANCELLABLE_STATUSES.includes(flashSale.status)) {
    res.status(400);
    throw new Error('Only a pending, approved, or scheduled Flash Sale can be cancelled');
  }

  flashSale.status = 'cancelled';
  await flashSale.save();

  res.json({ success: true, message: 'Flash Sale submission cancelled', flashSale });
});

// @desc    Everything currently live on the Flash Sale storefront right now
//          (self-healing: checked against the real clock on every call, so
//          the response is correct even if the scheduler hasn't ticked yet)
// @route   GET /api/flash-sales/active
// @access  Public
const getActiveFlashSales = asyncHandler(async (req, res) => {
  const now = new Date();

  const sales = await FlashSale.find({
    status: { $in: ['scheduled', 'active'] },
    startAt: { $lte: now },
    endAt: { $gte: now },
  })
    .populate('product', 'name images category finalPrice sellerPrice stock')
    .sort('-createdAt');

  const live = sales.filter((s) => s.stockAllocated - s.stockSold > 0);

  res.json({ success: true, count: live.length, flashSales: live });
});


// @desc    Everything scheduled for TODAY's Flash Sale window — both live
//          items (buyable now) and upcoming ones still waiting for 2:00 PM
//          (shown locked on the storefront so shoppers can preview them).
// @route   GET /api/flash-sales/today
// @access  Public
const getTodayFlashSales = asyncHandler(async (req, res) => {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const sales = await FlashSale.find({
    status: { $in: ['scheduled', 'active'] },
    saleDate: { $gte: startOfDay, $lte: endOfDay },
  })
    .populate('product', 'name images category finalPrice sellerPrice stock')
    .sort('startAt');

  const result = sales
    // drop anything already fully sold out even though status hasn't ticked yet
    .filter((s) => s.stockAllocated - s.stockSold > 0)
    .map((s) => {
      const obj = s.toObject();
      obj.isLive = s.startAt <= now && s.endAt >= now;
      return obj;
    });

  res.json({ success: true, count: result.length, flashSales: result });
});




// @desc    Single Flash Sale by id — used by the frontend cart/checkout to
//          re-validate live price/stock for a line before charging it,
//          the same way products are re-fetched fresh on every page load.
// @route   GET /api/flash-sales/:id
// @access  Public
const getFlashSaleById = asyncHandler(async (req, res) => {
  const flashSale = await FlashSale.findById(req.params.id).populate(
    'product',
    'name images category finalPrice sellerPrice stock sellerRole'
  );
  if (!flashSale) {
    res.status(404);
    throw new Error('Flash Sale not found');
  }

  const now = new Date();
  const obj = flashSale.toObject();
  obj.isLive =
    ['scheduled', 'active'].includes(flashSale.status) &&
    flashSale.startAt <= now &&
    flashSale.endAt >= now &&
    flashSale.stockAllocated - flashSale.stockSold > 0;

  res.json({ success: true, flashSale: obj });
});

// ---------------------------------------------------------------------------
// See the integration note at the top of this file — call from wherever an
// order is finalized for a product currently in an active Flash Sale.
// ---------------------------------------------------------------------------
async function recordFlashSaleSale(productId, quantity) {
  const now = new Date();
  const flashSale = await FlashSale.findOne({
    product: productId,
    status: 'active',
    startAt: { $lte: now },
    endAt: { $gte: now },
  });
  if (!flashSale) return null;

  flashSale.stockSold += Number(quantity) || 0;
  if (flashSale.stockSold >= flashSale.stockAllocated) {
    flashSale.status = 'sold_out';
  }
  await flashSale.save();
  return flashSale;
}

// =========================================================
// ---------------------- ADMIN ----------------------------
// =========================================================

// @desc    Flash Sale submissions awaiting admin review
// @route   GET /api/admin/flash-sales/pending
// @access  Private (admin)
const getPendingFlashSales = asyncHandler(async (req, res) => {
  const flashSales = await FlashSale.find({ status: 'pending_review' })
    .populate('product', 'name images finalPrice sellerPrice stock category')
    .populate('seller', 'name businessName shopName role email phone')
    .sort('createdAt'); // oldest first

  res.json({ success: true, count: flashSales.length, flashSales });
});

// @desc    Full Flash Sale table, filterable by status
// @route   GET /api/admin/flash-sales?status=&page=&limit=
// @access  Private (admin)
const getAllFlashSalesAdmin = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;

  const filter = {};
  if (status) filter.status = status;

  const skip = (Number(page) - 1) * Number(limit);

  const [flashSales, total] = await Promise.all([
    FlashSale.find(filter)
      .populate('product', 'name images finalPrice sellerPrice stock')
      .populate('seller', 'name businessName shopName role email phone')
      .sort('-createdAt')
      .skip(skip)
      .limit(Number(limit)),
    FlashSale.countDocuments(filter),
  ]);

  res.json({
    success: true,
    count: flashSales.length,
    total,
    page: Number(page),
    pages: Math.ceil(total / Number(limit)),
    flashSales,
  });
});

// @desc    Admin approves a pending Flash Sale submission
// @route   PATCH /api/admin/flash-sales/:id/approve
// @access  Private (admin)
const approveFlashSale = asyncHandler(async (req, res) => {
  const flashSale = await FlashSale.findById(req.params.id).populate('product', 'name images');
  if (!flashSale) {
    res.status(404);
    throw new Error('Flash Sale submission not found');
  }
  if (flashSale.status !== 'pending_review') {
    res.status(400);
    throw new Error('Only submissions awaiting review can be approved');
  }

  // Defensive re-derivation of status at approval time (covers the rare case
  // where review happens right at/after the scheduled start).
  const now = new Date();
  if (flashSale.endAt <= now) {
    flashSale.status = 'ended';
  } else if (flashSale.startAt <= now) {
    flashSale.status = 'active';
  } else {
    flashSale.status = 'scheduled';
  }

  flashSale.reviewedBy = req.user._id;
  flashSale.reviewedAt = now;
  await flashSale.save();

  res.json({ success: true, message: 'Flash Sale approved', flashSale });

  const seller = await User.findById(flashSale.seller).select('name email');
  if (seller?.email) {
    safeSendEmail(
      {
        to: seller.email,
        subject: `Flash Sale Approved - ${flashSale.product.name}`,
        html: flashSaleDecisionTemplate({
          sellerName: seller.name,
          product: flashSale.product,
          flashSale,
          decision: 'approved',
        }),
      },
      'Flash Sale decision (approved)'
    );
  }
});

// @desc    Admin rejects a pending Flash Sale submission with a reason
// @route   PATCH /api/admin/flash-sales/:id/reject
// @access  Private (admin)
const rejectFlashSale = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  if (!reason) {
    res.status(400);
    throw new Error('A rejection reason is required');
  }

  const flashSale = await FlashSale.findById(req.params.id).populate('product', 'name images');
  if (!flashSale) {
    res.status(404);
    throw new Error('Flash Sale submission not found');
  }
  if (flashSale.status !== 'pending_review') {
    res.status(400);
    throw new Error('Only submissions awaiting review can be rejected');
  }

  flashSale.status = 'rejected';
  flashSale.rejectionReason = reason;
  flashSale.reviewedBy = req.user._id;
  flashSale.reviewedAt = new Date();
  await flashSale.save();

  res.json({ success: true, message: 'Flash Sale rejected', flashSale });

  const seller = await User.findById(flashSale.seller).select('name email');
  if (seller?.email) {
    safeSendEmail(
      {
        to: seller.email,
        subject: `Flash Sale Rejected - ${flashSale.product.name}`,
        html: flashSaleDecisionTemplate({
          sellerName: seller.name,
          product: flashSale.product,
          flashSale,
          decision: 'rejected',
          reason,
        }),
      },
      'Flash Sale decision (rejected)'
    );
  }
});




module.exports = {
  submitFlashSale,
  getMyFlashSales,
  cancelMyFlashSale,
  getActiveFlashSales,
  recordFlashSaleSale,
  getPendingFlashSales,
  getAllFlashSalesAdmin,
  approveFlashSale,
  rejectFlashSale,
  getTodayFlashSales,
  getFlashSaleById, // <-- new
};