const asyncHandler = require('express-async-handler');
const Shop = require('../models/Shop');

// ---------------------------------------------------------------------------
// Shared helper — used by productController to silently attach a product to
// the seller's shop, but only if that shop is currently approved.
// ---------------------------------------------------------------------------
async function getApprovedShopForSeller(sellerId) {
  return Shop.findOne({ seller: sellerId, status: 'approved', isActive: true }).select('_id shopName status');
}

// ---------------------------------------------------------------------------
// Seller
// ---------------------------------------------------------------------------

// @desc    Seller creates their (single, optional) shop. Starts pending_approval.
// @route   POST /api/shops
// @access  Private (wholesaler, retailer)
const createShop = asyncHandler(async (req, res) => {
  const existing = await Shop.findOne({ seller: req.user._id });
  if (existing) {
    res.status(400);
    throw new Error('You already have a shop. Only one shop is allowed per seller right now.');
  }

  const { shopName, description, businessCategory, businessHours, logo, banner } = req.body;

  if (!shopName || !shopName.trim()) {
    res.status(400);
    throw new Error('Shop name is required');
  }

  const slug = await Shop.buildUniqueSlug(shopName);

  const shop = await Shop.create({
    seller: req.user._id,
    shopName: shopName.trim(),
    slug,
    description: description || '',
    businessCategory: businessCategory || '',
    businessHours: businessHours || '',
    logo: logo || '',
    banner: banner || '',
    status: 'pending_approval',
  });

  res.status(201).json({ success: true, message: 'Shop submitted for admin approval', shop });
});

// @desc    Seller views their own shop (or null if they haven't created one)
// @route   GET /api/shops/my-shop
// @access  Private (wholesaler, retailer)
const getMyShop = asyncHandler(async (req, res) => {
  const shop = await Shop.findOne({ seller: req.user._id });
  res.json({ success: true, shop: shop || null });
});

// @desc    Seller updates their own shop's basic info. Any update on an already
//          approved shop sends it back to pending_approval, mirroring the
//          product edit-while-live behavior.
// @route   PUT /api/shops/my-shop
// @access  Private (wholesaler, retailer)
const updateMyShop = asyncHandler(async (req, res) => {
  const shop = await Shop.findOne({ seller: req.user._id });
  if (!shop) {
    res.status(404);
    throw new Error('You do not have a shop yet');
  }

  const editableFields = ['description', 'businessCategory', 'businessHours', 'logo', 'banner'];
  editableFields.forEach((field) => {
    if (req.body[field] !== undefined) shop[field] = req.body[field];
  });

  if (req.body.shopName !== undefined && req.body.shopName.trim() && req.body.shopName.trim() !== shop.shopName) {
    shop.shopName = req.body.shopName.trim();
    shop.slug = await Shop.buildUniqueSlug(shop.shopName, shop._id);
  }

  const wasApproved = shop.status === 'approved';
  if (wasApproved) {
    shop.status = 'pending_approval';
    shop.reviewedBy = null;
    shop.reviewedAt = null;
    // A shop pulled back for re-review shouldn't keep spotlighting stale content.
    shop.isFeatured = false;
  }

  await shop.save();
  res.json({ success: true, shop });
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
};