const asyncHandler = require('express-async-handler');
const SellerVerification = require('../models/SellerVerification');
const LegalDocument = require('../models/LegalDocument');
const SellerAcceptance = require('../models/SellerAcceptance');

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
  });
});

// @desc  Submit (or resubmit after rejection) seller verification
// @route POST /api/seller-verification
const submitVerification = asyncHandler(async (req, res) => {
  if (!['retailer', 'wholesaler'].includes(req.user.role)) {
    res.status(403);
    throw new Error('Only sellers can submit verification');
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
  const fileUrl = (field) => (files[field]?.[0]?.path);

  // Wholesalers are always forced onto the business tier no matter what the
  // client sends — the lightweight ID+KRA path is for small retailers only.
  const tier = req.user.role === 'wholesaler'
    ? 'business'
    : (req.body.tier === 'business' ? 'business' : 'basic');

  if (!req.body.agreedToTerms || req.body.agreedToTerms === 'false') {
    res.status(400);
    throw new Error('You must accept the seller agreement to continue');
  }

  const payload = {
    seller: req.user.id,
    sellerRole: req.user.role,
    tier,
    status: 'pending',
    submittedAt: new Date(),
    rejectionReason: undefined,

    identity: {
      idType: req.body.idType,
      fullName: req.body.fullName,
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

    address: {
      county: req.body.county,
      city: req.body.city,
      street: req.body.street,
      building: req.body.building,
      postalCode: req.body.postalCode,
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
    };
    if (!payload.business.businessName || !payload.business.classification) {
      res.status(400);
      throw new Error('Business name and classification are required for the business tier');
    }
    if (!payload.business.registrationCertificate) {
      res.status(400);
      throw new Error('Business registration certificate is required for the business tier');
    }
  }

  if (tier === 'basic') {
    if (!payload.identity.idType || !payload.identity.idNumber || !payload.identity.idFrontImage) {
      res.status(400);
      throw new Error('National ID (or passport) details and photo are required');
    }
  }

  if (!payload.tax.kraPinNumber || !payload.tax.kraPinCertificate) {
    res.status(400);
    throw new Error('KRA PIN number and certificate are required');
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
  getPendingVerifications,
  approveVerification,
  rejectVerification,
};