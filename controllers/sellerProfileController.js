const asyncHandler = require('express-async-handler');
const SellerVerification = require('../models/SellerVerification');
const { User } = require('../models/User');

const CATEGORY_OPTIONS = SellerVerification.CATEGORY_OPTIONS;

// @desc  Get the seller's editable profile + a read-only view of locked data
// @route GET /api/seller-profile/me
const getMyProfile = asyncHandler(async (req, res) => {
  const record = await SellerVerification.findOne({ seller: req.user.id });

  if (!record || record.status !== 'approved') {
    res.status(403);
    throw new Error('Your seller profile unlocks once your verification is approved.');
  }

  res.json({
    success: true,
    profile: {
      name: req.user.name,
      phone: req.user.phone,
      avatar: req.user.avatar,
      businessAddress: record.businessAddress,
      warehouseAddress: record.warehouseAddress,
      returnAddress: record.returnAddress,
      store: record.store,
      categories: record.categories,
      social: record.social,
      payout: record.payout,
    },
    // Shown for reference only — this route never accepts writes to these.
    locked: {
      tier: record.tier,
      sellerRole: record.sellerRole,
      identity: record.identity,
      business: record.business,
      tax: record.tax,
      status: record.status,
    },
    categoryOptions: CATEGORY_OPTIONS,
  });
});

// @desc  Update the seller's editable profile fields only
// @route PUT /api/seller-profile/me
const updateMyProfile = asyncHandler(async (req, res) => {
  const record = await SellerVerification.findOne({ seller: req.user.id });

  if (!record || record.status !== 'approved') {
    res.status(403);
    throw new Error('Your seller profile unlocks once your verification is approved.');
  }

  const files = req.files || {};
  const fileUrl = (field) => files[field]?.[0]?.path;

  // ---------- personal (lives on the User document) ----------
  const userUpdates = {};
  if (typeof req.body.name === 'string' && req.body.name.trim()) userUpdates.name = req.body.name.trim();
  if (typeof req.body.phone === 'string' && req.body.phone.trim()) userUpdates.phone = req.body.phone.trim();
  if (Object.keys(userUpdates).length) {
    await User.findByIdAndUpdate(req.user.id, userUpdates, { runValidators: true });
  }

  // ---------- business location ----------
  if (req.body.county !== undefined) {
    record.businessAddress = {
      county: req.body.county,
      city: req.body.city,
      street: req.body.street,
      building: req.body.building,
      postalCode: req.body.postalCode,
    };
  }

  // ---------- warehouse / delivery pickup address ----------
  if (req.body.warehouseSameAsBusiness !== undefined) {
    const same = req.body.warehouseSameAsBusiness !== 'false';
    record.warehouseAddress = {
      sameAsBusiness: same,
      warehouseName: same ? undefined : req.body.warehouseName,
      county: same ? record.businessAddress?.county : req.body.warehouseCounty,
      city: same ? record.businessAddress?.city : req.body.warehouseCity,
      street: same ? record.businessAddress?.street : req.body.warehouseStreet,
      building: same ? record.businessAddress?.building : req.body.warehouseBuilding,
      mapLink: same ? undefined : req.body.warehouseMapLink,
    };
  }

  // ---------- return address ----------
  if (req.body.returnCounty !== undefined) {
    if (!req.body.returnRecipientName || !req.body.returnCounty) {
      res.status(400);
      throw new Error('Return address needs a recipient name and county');
    }
    record.returnAddress = {
      recipientName: req.body.returnRecipientName,
      county: req.body.returnCounty,
      city: req.body.returnCity,
      street: req.body.returnStreet,
      postalCode: req.body.returnPostalCode,
    };
  }

  // ---------- store profile (marketing text/images only — never identity docs) ----------
  if (req.body.storeName !== undefined) {
    if (!req.body.storeName.trim()) {
      res.status(400);
      throw new Error('Store name is required');
    }
    record.store = {
      storeName: req.body.storeName.trim(),
      storeDescription: (req.body.storeDescription || '').slice(0, 500),
      storeLogo: fileUrl('storeLogo') || record.store?.storeLogo,
      storeBanner: fileUrl('storeBanner') || record.store?.storeBanner,
    };
  }

  // ---------- product categories sold ----------
  if (req.body.categories !== undefined) {
    let categories = [];
    try {
      categories = Array.isArray(req.body.categories) ? req.body.categories : JSON.parse(req.body.categories);
    } catch {
      categories = String(req.body.categories).split(',').map((c) => c.trim()).filter(Boolean);
    }
    categories = categories.filter((c) => CATEGORY_OPTIONS.includes(c));
    if (!categories.length) {
      res.status(400);
      throw new Error('Select at least one product category');
    }
    record.categories = categories;
  }

  // ---------- social links ----------
  if (
    req.body.website !== undefined ||
    req.body.facebook !== undefined ||
    req.body.instagram !== undefined ||
    req.body.tiktok !== undefined
  ) {
    record.social = {
      website: req.body.website ?? record.social?.website,
      facebook: req.body.facebook ?? record.social?.facebook,
      instagram: req.body.instagram ?? record.social?.instagram,
      tiktok: req.body.tiktok ?? record.social?.tiktok,
    };
  }

  // ---------- payout / payment ----------
  if (req.body.payoutMethod !== undefined) {
    if (req.body.payoutMethod === 'mpesa' && !req.body.mpesaNumber) {
      res.status(400);
      throw new Error('Enter your M-Pesa number');
    }
    if (req.body.payoutMethod === 'bank' && (!req.body.bankName || !req.body.accountNumber)) {
      res.status(400);
      throw new Error('Enter your bank name and account number');
    }
    record.payout = {
      method: req.body.payoutMethod,
      mpesaNumber: req.body.mpesaNumber,
      mpesaName: req.body.mpesaName,
      bankName: req.body.bankName,
      accountName: req.body.accountName,
      accountNumber: req.body.accountNumber,
      branchName: req.body.branchName,
    };
  }

  // Deliberately never touches identity / business / tax / status — this save
  // never triggers a re-review.
  await record.save();

  const updatedUser = await User.findById(req.user.id);

  res.json({
    success: true,
    message: 'Profile updated',
    profile: {
      name: updatedUser.name,
      phone: updatedUser.phone,
      avatar: updatedUser.avatar,
      businessAddress: record.businessAddress,
      warehouseAddress: record.warehouseAddress,
      returnAddress: record.returnAddress,
      store: record.store,
      categories: record.categories,
      social: record.social,
      payout: record.payout,
    },
  });
});

module.exports = { getMyProfile, updateMyProfile };