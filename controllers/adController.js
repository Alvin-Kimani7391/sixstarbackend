const asyncHandler = require('express-async-handler');
const Ad = require('../models/Ad');

// @desc    Get active ads for a given placement (called by frontend homepage/sidebar/etc)
// @route   GET /api/ads?placement=homepage_hero
// @access  Public
const getActiveAds = asyncHandler(async (req, res) => {
  const { placement } = req.query;
  const now = new Date();

  const filter = {
    isActive: true,
    startDate: { $lte: now },
    $or: [{ endDate: null }, { endDate: { $gte: now } }],
  };
  if (placement) filter.placement = placement;

  const ads = await Ad.find(filter).sort('-createdAt');
  res.json({ success: true, count: ads.length, ads });
});

// @desc    Admin creates an ad/banner (own brand or a paid third-party brand)
// @route   POST /api/ads
// @access  Private (admin)
const createAd = asyncHandler(async (req, res) => {
  const { title, linkUrl, placement, brandName, startDate, endDate } = req.body;

  if (!req.file) {
    res.status(400);
    throw new Error('An ad image is required');
  }
  if (!title || !placement) {
    res.status(400);
    throw new Error('Title and placement are required');
  }

  const ad = await Ad.create({
    title,
    image: req.file.path,
    linkUrl,
    placement,
    brandName,
    startDate: startDate || Date.now(),
    endDate: endDate || null,
    createdBy: req.user._id,
  });

  res.status(201).json({ success: true, ad });
});

// @desc    Admin updates an ad (toggle active, change dates, replace image, etc)
// @route   PUT /api/ads/:id
// @access  Private (admin)
const updateAd = asyncHandler(async (req, res) => {
  const ad = await Ad.findById(req.params.id);
  if (!ad) {
    res.status(404);
    throw new Error('Ad not found');
  }

  const editableFields = ['title', 'linkUrl', 'placement', 'brandName', 'isActive', 'startDate', 'endDate'];
  editableFields.forEach((field) => {
    if (req.body[field] !== undefined) ad[field] = req.body[field];
  });
  if (req.file) ad.image = req.file.path;

  await ad.save();
  res.json({ success: true, ad });
});

// @desc    Admin deletes an ad
// @route   DELETE /api/ads/:id
// @access  Private (admin)
const deleteAd = asyncHandler(async (req, res) => {
  const ad = await Ad.findByIdAndDelete(req.params.id);
  if (!ad) {
    res.status(404);
    throw new Error('Ad not found');
  }
  res.json({ success: true, message: 'Ad deleted' });
});

// @desc    Track an ad click (called by frontend when a user clicks a banner)
// @route   PATCH /api/ads/:id/click
// @access  Public
const trackAdClick = asyncHandler(async (req, res) => {
  await Ad.findByIdAndUpdate(req.params.id, { $inc: { clickCount: 1 } });
  res.json({ success: true });
});

// @desc    Admin: list all ads (active + inactive) for the admin panel
// @route   GET /api/admin/ads
// @access  Private (admin)
const getAllAdsAdmin = asyncHandler(async (req, res) => {
  const ads = await Ad.find().sort('-createdAt');
  res.json({ success: true, count: ads.length, ads });
});

module.exports = { getActiveAds, createAd, updateAd, deleteAd, trackAdClick, getAllAdsAdmin };
