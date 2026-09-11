const asyncHandler = require('express-async-handler');
const TownLocation = require('../models/TownLocation');

// @desc    Every active town, grouped by county — powers the checkout dropdown
// @route   GET /api/town-locations
// @access  Public
const getPublicTownLocations = asyncHandler(async (req, res) => {
  const towns = await TownLocation.find({ isActive: true }).sort({ county: 1, town: 1 });

  const regions = {};
  towns.forEach((t) => {
    if (!regions[t.county]) regions[t.county] = [];
    regions[t.county].push({
      _id: t._id,
      town: t.town,
      isNairobi: t.isNairobi,
      nairobiManualFee: t.isNairobi ? t.nairobiManualFee : undefined,
      deliveryDays: t.deliveryDays,
      hasPickupStation: t.hasPickupStation,
      pickupStationAddress: t.hasPickupStation ? t.pickupStationAddress : '',
    });
  });

  res.json({ success: true, regions });
});

// @desc    Full list, unfiltered/filterable, with every field
// @route   GET /api/town-locations/admin/all
// @access  Admin
const getAdminTownLocations = asyncHandler(async (req, res) => {
  const { county, isNairobi, hasPickupStation, search } = req.query;
  const filter = {};
  if (county) filter.county = county;
  if (isNairobi !== undefined) filter.isNairobi = isNairobi === 'true';
  if (hasPickupStation !== undefined) filter.hasPickupStation = hasPickupStation === 'true';
  if (search) filter.town = { $regex: search, $options: 'i' };

  const towns = await TownLocation.find(filter).sort({ county: 1, town: 1 });
  res.json({ success: true, count: towns.length, towns });
});

// @route   POST /api/town-locations/admin
const createTownLocation = asyncHandler(async (req, res) => {
  const { county, town, isNairobi, nairobiManualFee, deliveryDays, hasPickupStation, pickupStationAddress, isActive } = req.body;

  if (!county || !county.trim() || !town || !town.trim()) {
    res.status(400);
    throw new Error('County and town are both required');
  }

  const exists = await TownLocation.findOne({ county: county.trim(), town: town.trim() });
  if (exists) {
    res.status(400);
    throw new Error('This town already exists under this county');
  }

  const doc = await TownLocation.create({
    county: county.trim(),
    town: town.trim(),
    isNairobi: !!isNairobi,
    nairobiManualFee: Number(nairobiManualFee) || 0,
    deliveryDays: Number(deliveryDays) || 2,
    hasPickupStation: !!hasPickupStation,
    pickupStationAddress: (pickupStationAddress || '').trim(),
    isActive: isActive !== undefined ? !!isActive : true,
  });

  res.status(201).json({ success: true, town: doc });
});

// @route   PATCH /api/town-locations/admin/:id
const updateTownLocation = asyncHandler(async (req, res) => {
  const doc = await TownLocation.findById(req.params.id);
  if (!doc) {
    res.status(404);
    throw new Error('Town not found');
  }

  const { county, town, isNairobi, nairobiManualFee, deliveryDays, hasPickupStation, pickupStationAddress, isActive } = req.body;

  if (county !== undefined) doc.county = county.trim();
  if (town !== undefined) doc.town = town.trim();
  if (isNairobi !== undefined) doc.isNairobi = !!isNairobi;
  if (nairobiManualFee !== undefined) doc.nairobiManualFee = Number(nairobiManualFee) || 0;
  if (deliveryDays !== undefined) doc.deliveryDays = Number(deliveryDays) || 2;
  if (hasPickupStation !== undefined) doc.hasPickupStation = !!hasPickupStation;
  if (pickupStationAddress !== undefined) doc.pickupStationAddress = (pickupStationAddress || '').trim();
  if (isActive !== undefined) doc.isActive = !!isActive;

  // Duplicate check if county/town changed
  if (county !== undefined || town !== undefined) {
    const dupe = await TownLocation.findOne({ county: doc.county, town: doc.town, _id: { $ne: doc._id } });
    if (dupe) {
      res.status(400);
      throw new Error('Another town with this exact name already exists under this county');
    }
  }

  await doc.save(); // pre-save hook clears stale fee/address if flags are off
  res.json({ success: true, town: doc });
});

// @route   DELETE /api/town-locations/admin/:id
const deleteTownLocation = asyncHandler(async (req, res) => {
  const doc = await TownLocation.findByIdAndDelete(req.params.id);
  if (!doc) {
    res.status(404);
    throw new Error('Town not found');
  }
  res.json({ success: true, message: 'Town deleted' });
});

module.exports = {
  getPublicTownLocations,
  getAdminTownLocations,
  createTownLocation,
  updateTownLocation,
  deleteTownLocation,
};