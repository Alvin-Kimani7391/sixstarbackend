const asyncHandler = require('express-async-handler');
const Shop = require('../models/Shop');

// ---------------------------------------------------------------------------
// Shared helper — used by productController to silently attach a product to
// the seller's shop, but only if that shop is currently approved.
// ---------------------------------------------------------------------------
async function getApprovedShopForSeller(sellerId) {
  return Shop.findOne({ seller: sellerId, status: 'approved', isActive: true }).select('_id shopName status');
}

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
  }

  await shop.save();
  res.json({ success: true, shop });
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

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
  await shop.save();
  res.json({ success: true, message: 'Shop suspended', shop });
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
};
