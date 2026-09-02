const asyncHandler = require('express-async-handler');
const WeightTier = require('../models/WeightTier');

// Overlap check for create/update — weightTo === null is treated as +Infinity.
async function hasWeightTierOverlap(from, to, excludeId) {
  const upper = to == null ? Infinity : to;
  const tiers = await WeightTier.find({
    isActive: true,
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  });
  return tiers.some((t) => {
    const tUpper = t.weightTo == null ? Infinity : t.weightTo;
    return from <= tUpper && t.weightFrom <= upper;
  });
}

// @desc    Every weight tier, active or not — the full ladder for the admin screen.
// @route   GET /api/admin/weight-tiers
// @access  Private (admin)
const getAllWeightTiersAdmin = asyncHandler(async (req, res) => {
  const tiers = await WeightTier.find().sort('weightFrom');
  res.json({ success: true, count: tiers.length, tiers });
});

// @desc    Active-only tiers — public, used by the checkout shipping-quote preview.
// @route   GET /api/weight-tiers
// @access  Public
const getActiveWeightTiers = asyncHandler(async (req, res) => {
  const tiers = await WeightTier.find({ isActive: true }).sort('weightFrom');
  res.json({ success: true, count: tiers.length, tiers });
});

// @desc    Add a new weight tier.
// @route   POST /api/admin/weight-tiers
// @access  Private (admin)
const createWeightTier = asyncHandler(async (req, res) => {
  const { weightFrom, weightTo, price, label, isActive } = req.body;

  if (weightFrom === undefined || price === undefined) {
    res.status(400);
    throw new Error('weightFrom and price are required');
  }

  const from = Number(weightFrom);
  const to = weightTo === undefined || weightTo === null || weightTo === '' ? null : Number(weightTo);
  const priceVal = Number(price);

  if (Number.isNaN(from) || from < 0) {
    res.status(400);
    throw new Error('weightFrom must be a valid non-negative number');
  }
  if (to !== null && (Number.isNaN(to) || to <= from)) {
    res.status(400);
    throw new Error('weightTo must be greater than weightFrom, or left blank for an open-ended top tier');
  }
  if (Number.isNaN(priceVal) || priceVal < 0) {
    res.status(400);
    throw new Error('price must be a valid non-negative number');
  }

  const active = isActive !== undefined ? !!isActive : true;
  if (active && (await hasWeightTierOverlap(from, to))) {
    res.status(400);
    throw new Error(
      'This weight range overlaps an existing active tier. Adjust the range or deactivate the conflicting tier first.'
    );
  }

  const tier = await WeightTier.create({
    weightFrom: from,
    weightTo: to,
    price: priceVal,
    label: label || '',
    isActive: active,
  });

  res.status(201).json({ success: true, tier });
});

// @desc    Edit an existing weight tier.
// @route   PATCH /api/admin/weight-tiers/:id
// @access  Private (admin)
const updateWeightTier = asyncHandler(async (req, res) => {
  const tier = await WeightTier.findById(req.params.id);
  if (!tier) {
    res.status(404);
    throw new Error('Tier not found');
  }

  const from = req.body.weightFrom !== undefined ? Number(req.body.weightFrom) : tier.weightFrom;
  const to =
    req.body.weightTo === undefined
      ? tier.weightTo
      : req.body.weightTo === null || req.body.weightTo === ''
      ? null
      : Number(req.body.weightTo);
  const priceVal = req.body.price !== undefined ? Number(req.body.price) : tier.price;
  const isActive = req.body.isActive !== undefined ? !!req.body.isActive : tier.isActive;

  if (Number.isNaN(from) || from < 0) {
    res.status(400);
    throw new Error('weightFrom must be a valid non-negative number');
  }
  if (to !== null && (Number.isNaN(to) || to <= from)) {
    res.status(400);
    throw new Error('weightTo must be greater than weightFrom, or left blank for an open-ended top tier');
  }
  if (Number.isNaN(priceVal) || priceVal < 0) {
    res.status(400);
    throw new Error('price must be a valid non-negative number');
  }

  if (isActive && (await hasWeightTierOverlap(from, to, tier._id))) {
    res.status(400);
    throw new Error(
      'This weight range overlaps an existing active tier. Adjust the range or deactivate the conflicting tier first.'
    );
  }

  tier.weightFrom = from;
  tier.weightTo = to;
  tier.price = priceVal;
  tier.isActive = isActive;
  if (req.body.label !== undefined) tier.label = req.body.label;

  await tier.save();
  res.json({ success: true, tier });
});

// @desc    Delete a weight tier entirely.
// @route   DELETE /api/admin/weight-tiers/:id
// @access  Private (admin)
const deleteWeightTier = asyncHandler(async (req, res) => {
  const tier = await WeightTier.findByIdAndDelete(req.params.id);
  if (!tier) {
    res.status(404);
    throw new Error('Tier not found');
  }
  res.json({ success: true, message: 'Tier deleted' });
});

module.exports = {
  getAllWeightTiersAdmin,
  getActiveWeightTiers,
  createWeightTier,
  updateWeightTier,
  deleteWeightTier,
};