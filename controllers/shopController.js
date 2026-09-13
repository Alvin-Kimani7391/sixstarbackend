const asyncHandler = require('express-async-handler');
const Shop = require('../models/Shop');
const Product = require('../models/Product');
const { User } = require('../models/User');
const safeSendEmail = require('../utils/safeSendEmail');
const getAdminEmails = require('../utils/getAdminEmails');
const {
  shopSubmittedSellerTemplate,
  shopSubmittedAdminTemplate,
  shopDecisionTemplate,
} = require('../utils/emailTemplates');
const { mergeWithDefaults, sanitizeIncomingTheme } = require('../utils/shopThemeDefaults');

// ---------------------------------------------------------------------------
// Shared helper — used by productController to silently attach a product to
// the seller's shop, but only if that shop is currently approved.
// ---------------------------------------------------------------------------
async function getApprovedShopForSeller(sellerId) {
  return Shop.findOne({ seller: sellerId, status: 'approved', isActive: true }).select('_id shopName status');
}

// Safely parses themeConfiguration whether it arrived as a JSON string
// (multipart/form-data always sends strings) or as a real object (plain
// JSON requests, e.g. the Settings/Customize tabs), THEN runs it through
// sanitizeIncomingTheme() so nothing malformed or oversized gets persisted.
function parseThemeConfiguration(raw, fallback = {}) {
  if (raw === undefined || raw === null) return fallback;
  let parsed;
  if (typeof raw === 'object') {
    parsed = raw;
  } else {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return fallback;
    }
  }
  if (typeof parsed !== 'object' || parsed === null) return fallback;
  return sanitizeIncomingTheme(parsed);
}

function parseCustomizationMode(raw, fallback = 'basic') {
  return raw === 'basic' || raw === 'custom' ? raw : fallback;
}

// Fires the "submitted for review" receipt to the seller and the
// "needs review" alert to admins. Shared by createShop and the
// re-submission path in updateMyShop so both places stay in sync.
function sendShopSubmissionEmails({ sellerName, sellerEmail, shop }) {
  if (sellerEmail) {
    safeSendEmail(
      {
        to: sellerEmail,
        subject: `Shop Submitted for Approval - ${shop.shopName}`,
        html: shopSubmittedSellerTemplate({ sellerName, shop }),
        sender: 'info',
      },
      'Shop receipt (seller)'
    );
  }

  getAdminEmails()
    .then((adminEmails) => {
      adminEmails.forEach((to) => {
        safeSendEmail(
          {
            to,
            subject: `New Shop Submitted - ${shop.shopName}`,
            html: shopSubmittedAdminTemplate({ sellerName, sellerEmail, shop }),
            sender: 'info',
          },
          'Shop receipt (admin)'
        );
      });
    })
    .catch((err) => console.error('Failed to resolve admin emails:', err.message));
}

// ---------------------------------------------------------------------------
// Seller
// ---------------------------------------------------------------------------

// @desc    Seller creates their (single, optional) shop. Starts pending_approval.
//          Logo/banner are optional file uploads (multipart/form-data, field
//          names "logo" and "banner") handled by uploadShopImages and streamed
//          to Cloudinary — req.files.logo[0].path / req.files.banner[0].path
//          are already the final Cloudinary URLs by the time this runs.
// @route   POST /api/shops
// @access  Private (wholesaler, retailer)
const createShop = asyncHandler(async (req, res) => {
  const existing = await Shop.findOne({ seller: req.user._id });
  if (existing) {
    res.status(400);
    throw new Error('You already have a shop. Only one shop is allowed per seller right now.');
  }

  const { shopName, description, businessCategory, businessHours, homepageLayout } = req.body;

  if (!shopName || !shopName.trim()) {
    res.status(400);
    throw new Error('Shop name is required');
  }

  const slug = await Shop.buildUniqueSlug(shopName);

  const ALLOWED_LAYOUTS = ['default', 'banner-focus', 'grid-focus'];
  const safeLayout = ALLOWED_LAYOUTS.includes(homepageLayout) ? homepageLayout : 'default';
  const safeTheme = parseThemeConfiguration(req.body.themeConfiguration, {});
  const safeMode = parseCustomizationMode(req.body.customizationMode, 'basic');

  const logo = req.files?.logo?.[0]?.path || '';
  const banner = req.files?.banner?.[0]?.path || '';

  const shop = await Shop.create({
    seller: req.user._id,
    shopName: shopName.trim(),
    slug,
    description: description || '',
    businessCategory: businessCategory || '',
    businessHours: businessHours || '',
    logo,
    banner,
    themeConfiguration: safeTheme,
    customizationMode: safeMode,
    homepageLayout: safeLayout,
    status: 'pending_approval',
  });

  res.status(201).json({ success: true, message: 'Shop submitted for admin approval', shop });

  sendShopSubmissionEmails({ sellerName: req.user.name, sellerEmail: req.user.email, shop });
});


const toggleMyShopActive = asyncHandler(async (req, res) => {
  const shop = await Shop.findOne({ seller: req.user._id });
  if (!shop) {
    res.status(404);
    throw new Error('You do not have a shop yet');
  }
  if (shop.status !== 'approved') {
    res.status(400);
    throw new Error('Only an approved shop can be paused or resumed');
  }
  shop.isActive = !shop.isActive;
  await shop.save();
  res.json({ success: true, shop });
});

// @desc    Seller views their own shop (or null if they haven't created one)
// @route   GET /api/shops/my-shop
// @access  Private (wholesaler, retailer)
const getMyShop = asyncHandler(async (req, res) => {
  const shop = await Shop.findOne({ seller: req.user._id });
  if (!shop) return res.json({ success: true, shop: null });

  // The seller's own dashboard always sees the fully merged theme (with
  // defaults filled in) regardless of customizationMode, so the customizer
  // UI always has a complete object to edit — even on a shop that's never
  // touched a theme field before.
  const shopObj = shop.toObject();
  shopObj.themeConfiguration = mergeWithDefaults(shopObj.themeConfiguration);

  res.json({ success: true, shop: shopObj });
});

// @desc    Seller updates their own shop's basic info. Any update on an already
//          approved shop sends it back to pending_approval, mirroring the
//          product edit-while-live behavior — and, same as a fresh shop
//          submission, fires the seller receipt + admin review-needed emails
//          again so the re-review doesn't sit silently.
//          Logo/banner: only replaced if a new file was actually uploaded in
//          this request (req.files.logo / req.files.banner) — otherwise the
//          existing Cloudinary URLs on the shop are left untouched, so the
//          seller isn't forced to re-upload branding on every edit.
//
//          NOTE: changing customizationMode or themeConfiguration alone
//          (i.e. the Customize tab) does NOT send an approved shop back to
//          review — only shopName/description/businessCategory/businessHours/
//          logo/banner changes trigger that, exactly as before this feature.
//          Storefront design changes are the seller's own to publish freely.
// @route   PUT /api/shops/my-shop
// @access  Private (wholesaler, retailer)
const updateMyShop = asyncHandler(async (req, res) => {
  const shop = await Shop.findOne({ seller: req.user._id });
  if (!shop) {
    res.status(404);
    throw new Error('You do not have a shop yet');
  }

  const editableFields = ['description', 'businessCategory', 'businessHours'];
  let reviewTriggeringChange = false;

  editableFields.forEach((field) => {
    if (req.body[field] !== undefined && req.body[field] !== shop[field]) {
      shop[field] = req.body[field];
      reviewTriggeringChange = true;
    }
  });

  if (req.body.homepageLayout !== undefined) {
    const ALLOWED_LAYOUTS = ['default', 'banner-focus', 'grid-focus'];
    shop.homepageLayout = ALLOWED_LAYOUTS.includes(req.body.homepageLayout) ? req.body.homepageLayout : shop.homepageLayout;
  }

  // --- Storefront customization (Customize tab) — never triggers re-review ---
  if (req.body.customizationMode !== undefined) {
    shop.customizationMode = parseCustomizationMode(req.body.customizationMode, shop.customizationMode);
  }
  if (req.body.themeConfiguration !== undefined) {
    shop.themeConfiguration = parseThemeConfiguration(req.body.themeConfiguration, shop.themeConfiguration);
  }

  // req.files comes from uploadShopImages (multer .fields), so each key is an
  // array — only overwrite logo/banner when a new file actually came through.
  if (req.files?.logo?.[0]) {
    shop.logo = req.files.logo[0].path;
    reviewTriggeringChange = true;
  }
  if (req.files?.banner?.[0]) {
    shop.banner = req.files.banner[0].path;
    reviewTriggeringChange = true;
  }

  if (req.body.shopName !== undefined && req.body.shopName.trim() && req.body.shopName.trim() !== shop.shopName) {
    shop.shopName = req.body.shopName.trim();
    shop.slug = await Shop.buildUniqueSlug(shop.shopName, shop._id);
    reviewTriggeringChange = true;
  }

  const wasApproved = shop.status === 'approved';
  const goesBackToReview = wasApproved && reviewTriggeringChange;

  if (goesBackToReview) {
    shop.status = 'pending_approval';
    shop.reviewedBy = null;
    shop.reviewedAt = null;
    // A shop pulled back for re-review shouldn't keep spotlighting stale content.
    shop.isFeatured = false;
  }

  await shop.save();

  const shopObj = shop.toObject();
  shopObj.themeConfiguration = mergeWithDefaults(shopObj.themeConfiguration);
  res.json({ success: true, shop: shopObj });

  // Only fire the submission emails when this edit actually pulled a
  // previously-approved shop back into the review queue — routine
  // design-only edits (or edits to a shop that's still pending/rejected/
  // suspended) shouldn't spam anyone.
  if (goesBackToReview) {
    sendShopSubmissionEmails({ sellerName: req.user.name, sellerEmail: req.user.email, shop });
  }
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

// @desc    Admin: list ALL shops (any status), filterable — the main shops table
// @route   GET /api/shops/admin?status=pending_approval&search=name
// @access  Private (admin)
const getAllShopsAdmin = asyncHandler(async (req, res) => {
  const { status, search } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (search) filter.shopName = { $regex: search, $options: 'i' };

  const shops = await Shop.find(filter)
    .populate('seller', 'name email phone businessName shopName role')
    .populate('reviewedBy', 'name')
    .sort('-createdAt');

  res.json({ success: true, count: shops.length, shops });
});

// @desc    Admin views all shops pending approval
// @route   GET /api/shops/admin/pending
// @access  Private (admin)
const getPendingShops = asyncHandler(async (req, res) => {
  const shops = await Shop.find({ status: 'pending_approval' })
    .populate('seller', 'name email businessName shopName role')
    .sort('createdAt');
  res.json({ success: true, count: shops.length, shops });
});

// @desc    Admin approves a shop
// @route   PATCH /api/shops/admin/:id/approve
// @access  Private (admin)
const approveShop = asyncHandler(async (req, res) => {
  const shop = await Shop.findById(req.params.id);
  if (!shop) {
    res.status(404);
    throw new Error('Shop not found');
  }
  if (shop.status !== 'pending_approval') {
    res.status(400);
    throw new Error('Only shops pending approval can be approved');
  }
  shop.status = 'approved';
  shop.rejectionReason = '';
  shop.reviewedBy = req.user._id;
  shop.reviewedAt = new Date();
  await shop.save();
  res.json({ success: true, message: 'Shop approved', shop });

  const seller = await User.findById(shop.seller).select('name email');
  if (seller?.email) {
    safeSendEmail(
      {
        to: seller.email,
        subject: `Shop Approved - ${shop.shopName}`,
        html: shopDecisionTemplate({ sellerName: seller.name, shop, decision: 'approved' }),
        sender: 'info',
      },
      'Shop decision (approved)'
    );
  }
});

// @desc    Admin rejects a shop with a reason
// @route   PATCH /api/shops/admin/:id/reject
// @access  Private (admin)
const rejectShop = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  if (!reason) {
    res.status(400);
    throw new Error('A rejection reason is required');
  }
  const shop = await Shop.findById(req.params.id);
  if (!shop) {
    res.status(404);
    throw new Error('Shop not found');
  }
  shop.status = 'rejected';
  shop.rejectionReason = reason;
  shop.reviewedBy = req.user._id;
  shop.reviewedAt = new Date();
  shop.isFeatured = false;
  await shop.save();
  res.json({ success: true, message: 'Shop rejected', shop });

  const seller = await User.findById(shop.seller).select('name email');
  if (seller?.email) {
    safeSendEmail(
      {
        to: seller.email,
        subject: `Shop Rejected - ${shop.shopName}`,
        html: shopDecisionTemplate({ sellerName: seller.name, shop, decision: 'rejected', reason }),
        sender: 'info',
      },
      'Shop decision (rejected)'
    );
  }
});

// @desc    Admin suspends an approved shop
// @route   PATCH /api/shops/admin/:id/suspend
// @access  Private (admin)
const suspendShop = asyncHandler(async (req, res) => {
  const shop = await Shop.findById(req.params.id);
  if (!shop) {
    res.status(404);
    throw new Error('Shop not found');
  }
  shop.status = 'suspended';
  shop.isFeatured = false;
  await shop.save();
  res.json({ success: true, message: 'Shop suspended', shop });
});

// @desc    Admin reverses a suspension, putting a shop back on the storefront
// @route   PATCH /api/shops/admin/:id/reactivate
// @access  Private (admin)
const reactivateShop = asyncHandler(async (req, res) => {
  const shop = await Shop.findById(req.params.id);
  if (!shop) {
    res.status(404);
    throw new Error('Shop not found');
  }
  if (shop.status !== 'suspended') {
    res.status(400);
    throw new Error('Only suspended shops can be reactivated');
  }
  shop.status = 'approved';
  await shop.save();
  res.json({ success: true, message: 'Shop reactivated', shop });
});

// @desc    Admin toggles the "Verified" badge
// @route   PATCH /api/shops/admin/:id/verify   { verificationStatus: 'verified' | 'unverified' }
// @access  Private (admin)
const setShopVerification = asyncHandler(async (req, res) => {
  const { verificationStatus } = req.body;
  if (!['verified', 'unverified'].includes(verificationStatus)) {
    res.status(400);
    throw new Error('verificationStatus must be "verified" or "unverified"');
  }

  const shop = await Shop.findById(req.params.id);
  if (!shop) {
    res.status(404);
    throw new Error('Shop not found');
  }
  if (verificationStatus === 'verified' && shop.status !== 'approved') {
    res.status(400);
    throw new Error('Only approved shops can be marked as verified');
  }

  shop.verificationStatus = verificationStatus;
  await shop.save();
  res.json({ success: true, shop });
});

// @desc    Admin features/unfeatures a shop for the homepage — only approved shops
// @route   PATCH /api/shops/admin/:id/feature   { isFeatured: true|false }
// @access  Private (admin)
const setShopFeatured = asyncHandler(async (req, res) => {
  const { isFeatured } = req.body;

  const shop = await Shop.findById(req.params.id);
  if (!shop) {
    res.status(404);
    throw new Error('Shop not found');
  }
  if (isFeatured && shop.status !== 'approved') {
    res.status(400);
    throw new Error('Only approved shops can be featured');
  }

  shop.isFeatured = !!isFeatured;
  await shop.save();
  res.json({ success: true, shop });
});

// @desc    Admin fully edits a shop's basic info, optionally replacing logo/banner
// @route   PATCH /api/shops/admin/:id
// @access  Private (admin)
const adminUpdateShop = asyncHandler(async (req, res) => {
  const shop = await Shop.findById(req.params.id);
  if (!shop) {
    res.status(404);
    throw new Error('Shop not found');
  }

  const editableFields = ['description', 'businessCategory', 'businessHours'];
  editableFields.forEach((field) => {
    if (req.body[field] !== undefined) shop[field] = req.body[field];
  });

  if (req.body.isActive !== undefined) {
    shop.isActive = req.body.isActive === true || req.body.isActive === 'true';
  }

  if (req.body.customizationMode !== undefined) {
    shop.customizationMode = parseCustomizationMode(req.body.customizationMode, shop.customizationMode);
  }
  if (req.body.themeConfiguration !== undefined) {
    shop.themeConfiguration = parseThemeConfiguration(req.body.themeConfiguration, shop.themeConfiguration);
  }

  if (req.body.shopName !== undefined && req.body.shopName.trim() && req.body.shopName.trim() !== shop.shopName) {
    shop.shopName = req.body.shopName.trim();
    shop.slug = await Shop.buildUniqueSlug(shop.shopName, shop._id);
  }

  // req.files comes from uploadShopImages (multer .fields), so each key is an array
  if (req.files?.logo?.[0]) shop.logo = req.files.logo[0].path;
  if (req.files?.banner?.[0]) shop.banner = req.files.banner[0].path;

  await shop.save();
  res.json({ success: true, shop });
});

// @desc    Admin removes a shop entirely (soft delete — seller can create a new one)
// @route   DELETE /api/shops/admin/:id
// @access  Private (admin)
const adminDeleteShop = asyncHandler(async (req, res) => {
  const shop = await Shop.findByIdAndUpdate(
    req.params.id,
    { isActive: false, status: 'suspended', isFeatured: false },
    { new: true }
  );
  if (!shop) {
    res.status(404);
    throw new Error('Shop not found');
  }
  res.json({ success: true, message: 'Shop removed' });
});

// @desc    Public: browse approved shops directory
// @route   GET /api/shops
// @access  Public
const getPublicShops = asyncHandler(async (req, res) => {
  const { search, category, verified, featured, sort, page = 1, limit = 12 } = req.query;

  const filter = { status: 'approved', isActive: true };
  if (category) filter.businessCategory = category;
  if (verified === 'true') filter.verificationStatus = 'verified';
  if (featured === 'true') filter.isFeatured = true;
  if (search) filter.$text = { $search: search };

  const sortMap = {
    newest: '-createdAt',
    name: 'shopName',
    featured: '-isFeatured -createdAt',
  };

  const skip = (Number(page) - 1) * Number(limit);

  const [shops, total] = await Promise.all([
    Shop.find(filter)
      .select(
        'shopName slug logo banner description businessCategory businessHours verificationStatus isFeatured createdAt ratingsAverage ratingsCount customizationMode themeConfiguration'
      )
      .sort(sortMap[sort] || sortMap.featured)
      .skip(skip)
      .limit(Number(limit)),
    Shop.countDocuments(filter),
  ]);

  // Live "X products" count per shop, cheap at directory scale. If the shop
  // count grows large, swap this for a $lookup in an aggregation pipeline.
  const counts = await Product.aggregate([
    { $match: { shop: { $in: shops.map((s) => s._id) }, status: 'active', isActive: true } },
    { $group: { _id: '$shop', count: { $sum: 1 } } },
  ]);
  const countMap = new Map(counts.map((c) => [String(c._id), c.count]));

  res.json({
    success: true,
    count: shops.length,
    total,
    page: Number(page),
    pages: Math.ceil(total / Number(limit)),
    shops: shops.map((s) => {
      const obj = { ...s.toObject(), productCount: countMap.get(String(s._id)) || 0 };
      // Only pay the merge cost for shops actually using custom mode — 'basic'
      // shops don't need a full theme object sent to the directory listing.
      if (obj.customizationMode === 'custom') obj.themeConfiguration = mergeWithDefaults(obj.themeConfiguration);
      else delete obj.themeConfiguration;
      return obj;
    }),
  });
});

// @desc    Public: single approved shop by slug, for the shop storefront page
// @route   GET /api/shops/:slug
// @access  Public
const getShopBySlug = asyncHandler(async (req, res) => {
  const shop = await Shop.findOne({
    slug: req.params.slug,
    status: 'approved',
    isActive: true,
  }).select(
    'shopName slug logo banner description businessCategory businessHours verificationStatus isFeatured createdAt ratingsAverage ratingsCount customizationMode themeConfiguration'
  );

  if (!shop) {
    res.status(404);
    throw new Error('Shop not found');
  }

  const shopObj = shop.toObject();
  // Always send a fully merged theme so the storefront renderer never has to
  // special-case missing keys — it decides whether to USE it based on
  // customizationMode, not based on whether the object is complete.
  shopObj.themeConfiguration = mergeWithDefaults(shopObj.themeConfiguration);

  res.json({ success: true, shop: shopObj });
});

module.exports = {
  getApprovedShopForSeller,
  createShop,
  getMyShop,
  updateMyShop,
  getPendingShops,
  approveShop,
  rejectShop,
  suspendShop,
  getAllShopsAdmin,
  reactivateShop,
  setShopVerification,
  setShopFeatured,
  adminUpdateShop,
  adminDeleteShop,
  toggleMyShopActive,
  getPublicShops,
  getShopBySlug,
};