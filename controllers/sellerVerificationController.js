const asyncHandler = require('express-async-handler');
const SellerVerification = require('../models/SellerVerification');
const LegalDocument = require('../models/LegalDocument');
const SellerAcceptance = require('../models/SellerAcceptance');

const CATEGORY_OPTIONS = SellerVerification.CATEGORY_OPTIONS;
const BUSINESS_AGE_OPTIONS = ['lt_6m', '6_12m', '1_3y', 'gt_3y'];

// @desc  Get logged-in seller's verification record
// @route GET /api/seller-verification/me
const getMyVerification = asyncHandler(async (req, res) => {
  if (!['retailer', 'wholesaler'].includes(req.user.role)) {
    res.status(403);
    throw new Error('Only sellers have a verification record');
  }

  const record = await SellerVerification.findOne({ seller: req.user.id });

  res.json({
    success: true,
    verification: record || null,
    // Wholesalers never see the basic ID+KRA-only path — that's retailer-only.
    eligibleTiers: req.user.role === 'wholesaler' ? ['business'] : ['basic', 'business'],
    emailVerified: !!req.user.isVerified,
    email: req.user.email,
    categoryOptions: CATEGORY_OPTIONS,
  });
});

// @desc  Submit (or resubmit after rejection) seller verification
// @route POST /api/seller-verification
const submitVerification = asyncHandler(async (req, res) => {
  if (!['retailer', 'wholesaler'].includes(req.user.role)) {
    res.status(403);
    throw new Error('Only sellers can submit verification');
  }

  // ---- Email must be verified before anything else is accepted ----
  if (!req.user.isVerified) {
    res.status(400);
    throw new Error('Please verify your email address before submitting your documents');
  }

  const requiredDocs = await LegalDocument.find({
    status: 'published',
    isMandatory: true,
    audience: { $in: ['sellers', 'both'] },
  }).select('_id title');

  if (requiredDocs.length) {
    const acceptedIds = await SellerAcceptance.find({
      seller: req.user.id,
      document: { $in: requiredDocs.map((d) => d._id) },
    }).distinct('document');
    const acceptedSet = new Set(acceptedIds.map(String));
    const missing = requiredDocs.filter((d) => !acceptedSet.has(String(d._id)));

    if (missing.length) {
      res.status(400);
      throw new Error(`Accept the following before submitting: ${missing.map((d) => d.title).join(', ')}`);
    }
  }

  const existing = await SellerVerification.findOne({ seller: req.user.id });
  if (existing && existing.status === 'approved') {
    res.status(400);
    throw new Error('Your account is already verified');
  }
  if (existing && existing.status === 'pending') {
    res.status(400);
    throw new Error('Your verification is already pending review');
  }

  const files = req.files || {};
  const fileUrl = (field) => files[field]?.[0]?.path;

  // Wholesalers are always forced onto the business tier no matter what the
  // client sends — the lightweight ID+KRA path is for small retailers only.
  const tier = req.user.role === 'wholesaler'
    ? 'business'
    : (req.body.tier === 'business' ? 'business' : 'basic');

  if (!req.body.agreedToTerms || req.body.agreedToTerms === 'false') {
    res.status(400);
    throw new Error('You must accept the seller agreement to continue');
  }

  // categories may arrive as a JSON string, a comma list, or repeated fields
  let categories = [];
  if (req.body.categories) {
    try {
      categories = Array.isArray(req.body.categories)
        ? req.body.categories
        : JSON.parse(req.body.categories);
    } catch {
      categories = String(req.body.categories).split(',').map((c) => c.trim()).filter(Boolean);
    }
  }
  categories = categories.filter((c) => CATEGORY_OPTIONS.includes(c));

  const sameAsBusiness = req.body.warehouseSameAsBusiness !== 'false';

  const payload = {
    seller: req.user.id,
    sellerRole: req.user.role,
    tier,
    status: 'pending',
    submittedAt: new Date(),
    rejectionReason: undefined,

    emailVerification: {
      email: req.user.email,
      verified: true,
      verifiedAt: existing?.emailVerification?.verifiedAt || new Date(),
    },

    identity: {
      idType: req.body.idType,
      fullName: req.body.fullName,
      dateOfBirth: req.body.dateOfBirth || undefined,
      nationality: req.body.nationality,
      idNumber: req.body.idNumber,
      idFrontImage: fileUrl('idFrontImage') || existing?.identity?.idFrontImage,
      idBackImage: fileUrl('idBackImage') || existing?.identity?.idBackImage,
      selfieWithId: fileUrl('selfieWithId') || existing?.identity?.selfieWithId,
    },

    tax: {
      kraPinNumber: req.body.kraPinNumber,
      kraPinCertificate: fileUrl('kraPinCertificate') || existing?.tax?.kraPinCertificate,
      vatRegistered: req.body.vatRegistered === 'true',
      vatCertificate: fileUrl('vatCertificate') || existing?.tax?.vatCertificate,
    },

    businessAddress: {
      county: req.body.county,
      city: req.body.city,
      street: req.body.street,
      building: req.body.building,
      postalCode: req.body.postalCode,
    },

    warehouseAddress: {
      sameAsBusiness,
      warehouseName: sameAsBusiness ? undefined : req.body.warehouseName,
      county: sameAsBusiness ? req.body.county : req.body.warehouseCounty,
      city: sameAsBusiness ? req.body.city : req.body.warehouseCity,
      street: sameAsBusiness ? req.body.street : req.body.warehouseStreet,
      building: sameAsBusiness ? req.body.building : req.body.warehouseBuilding,
      mapLink: sameAsBusiness ? undefined : req.body.warehouseMapLink,
    },

    returnAddress: {
      recipientName: req.body.returnRecipientName,
      county: req.body.returnCounty,
      city: req.body.returnCity,
      street: req.body.returnStreet,
      postalCode: req.body.returnPostalCode,
    },

    store: {
      storeName: req.body.storeName,
      storeLogo: fileUrl('storeLogo') || existing?.store?.storeLogo,
      storeBanner: fileUrl('storeBanner') || existing?.store?.storeBanner,
      storeDescription: (req.body.storeDescription || '').slice(0, 500),
    },

    categories,

    social: {
      website: req.body.website,
      facebook: req.body.facebook,
      instagram: req.body.instagram,
      tiktok: req.body.tiktok,
    },

    payout: {
      method: req.body.payoutMethod,
      mpesaNumber: req.body.mpesaNumber,
      mpesaName: req.body.mpesaName,
      bankName: req.body.bankName,
      accountName: req.body.accountName,
      accountNumber: req.body.accountNumber,
      branchName: req.body.branchName,
    },

    agreedToTerms: true,
    agreedAt: new Date(),
  };

  if (tier === 'business') {
    payload.business = {
      classification: req.body.businessClassification,
      businessName: req.body.businessName,
      registrationNumber: req.body.registrationNumber,
      registrationCertificate: fileUrl('registrationCertificate') || existing?.business?.registrationCertificate,
      cr12Document: fileUrl('cr12Document') || existing?.business?.cr12Document,
      partnershipAgreement: fileUrl('partnershipAgreement') || existing?.business?.partnershipAgreement,
      businessAge: BUSINESS_AGE_OPTIONS.includes(req.body.businessAge) ? req.body.businessAge : undefined,
      businessLicense: fileUrl('businessLicenseDoc') || existing?.business?.businessLicense,
    };
    if (!payload.business.businessName || !payload.business.classification) {
      res.status(400);
      throw new Error('Business name and classification are required for the business tier');
    }
    if (!payload.business.registrationCertificate) {
      res.status(400);
      throw new Error('Business registration certificate is required for the business tier');
    }
    if (payload.business.classification === 'limited_company' && !payload.business.cr12Document) {
      res.status(400);
      throw new Error('CR12 is required for limited companies');
    }
    if (payload.business.classification === 'partnership' && !payload.business.partnershipAgreement) {
      res.status(400);
      throw new Error('Partnership agreement is required for partnerships');
    }
  }

  if (tier === 'basic') {
    if (!payload.identity.idType || !payload.identity.idNumber || !payload.identity.idFrontImage) {
      res.status(400);
      throw new Error('National ID (or passport) details and photo are required');
    }
  }

  if (!payload.identity.fullName || !payload.identity.dateOfBirth || !payload.identity.nationality) {
    res.status(400);
    throw new Error('Full name, date of birth and nationality are required');
  }
  if (!payload.identity.selfieWithId) {
    res.status(400);
    throw new Error('A selfie holding your ID is required');
  }
  if (!payload.tax.kraPinNumber || !payload.tax.kraPinCertificate) {
    res.status(400);
    throw new Error('KRA PIN number and certificate are required');
  }
  if (payload.tax.vatRegistered && !payload.tax.vatCertificate) {
    res.status(400);
    throw new Error('Upload your VAT registration certificate, or untick VAT registered');
  }
  if (!payload.businessAddress.county) {
    res.status(400);
    throw new Error('Business county is required');
  }
  if (!payload.returnAddress.recipientName || !payload.returnAddress.county) {
    res.status(400);
    throw new Error('A return address (recipient name and county) is required');
  }
  if (!payload.store.storeName) {
    res.status(400);
    throw new Error('Store name is required');
  }
  if (!payload.categories.length) {
    res.status(400);
    throw new Error('Select at least one product category');
  }
  if (!payload.payout.method) {
    res.status(400);
    throw new Error('Choose how you want to receive payouts');
  }

  let record;
  if (existing) {
    Object.assign(existing, payload);
    record = await existing.save();
  } else {
    record = await SellerVerification.create(payload);
  }

  res.json({ success: true, verification: record, message: 'Submitted for review' });
});

// ============================================================
// ADMIN
// ============================================================

// @desc  Full list of verification records, optionally filtered by status
// @route GET /api/admin/seller-verifications?status=pending
const getAllVerifications = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const filter = {};
  if (status) filter.status = status;

  const records = await SellerVerification.find(filter)
    .populate('seller', 'name email phone role businessName shopName')
    .sort({ submittedAt: -1, updatedAt: -1 });

  res.json({ success: true, verifications: records });
});

// @desc  Pending-only shortcut (kept for backward compatibility)
// @route GET /api/admin/seller-verifications/pending
const getPendingVerifications = asyncHandler(async (req, res) => {
  const records = await SellerVerification.find({ status: 'pending' })
    .populate('seller', 'name email phone role businessName shopName')
    .sort({ submittedAt: 1 });
  res.json({ success: true, verifications: records });
});

const approveVerification = asyncHandler(async (req, res) => {
  const record = await SellerVerification.findById(req.params.id);
  if (!record) { res.status(404); throw new Error('Verification record not found'); }
  record.status = 'approved';
  record.rejectionReason = undefined;
  record.reviewedAt = new Date();
  record.reviewedBy = req.user.id;
  await record.save();
  res.json({ success: true, verification: record });
});

const rejectVerification = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  if (!reason) { res.status(400); throw new Error('A rejection reason is required'); }
  const record = await SellerVerification.findById(req.params.id);
  if (!record) { res.status(404); throw new Error('Verification record not found'); }
  record.status = 'rejected';
  record.rejectionReason = reason;
  record.reviewedAt = new Date();
  record.reviewedBy = req.user.id;
  await record.save();
  res.json({ success: true, verification: record });
});

module.exports = {
  getMyVerification,
  submitVerification,
  getAllVerifications,
  getPendingVerifications,
  approveVerification,
  rejectVerification,
};