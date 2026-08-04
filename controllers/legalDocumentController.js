const asyncHandler = require('express-async-handler');
const LegalDocument = require('../models/LegalDocument');
const SellerAcceptance = require('../models/SellerAcceptance');

// ============================================================
// ADMIN
// ============================================================

const createLegalDocument = asyncHandler(async (req, res) => {
  const { title, type, version, description, effectiveDate, expiryDate, isMandatory, audience } = req.body;

  if (!title || !type || !version || !effectiveDate) {
    res.status(400);
    throw new Error('Title, type, version and effective date are required');
  }
  if (!req.file) {
    res.status(400);
    throw new Error('A PDF file is required');
  }

  const doc = await LegalDocument.create({
    title,
    type,
    version,
    description,
    fileUrl: req.file.path,
    effectiveDate,
    expiryDate: expiryDate || undefined,
    isMandatory: isMandatory !== 'false',
    audience: audience || 'sellers',
    status: 'draft',
    createdBy: req.user.id,
  });

  res.status(201).json({ success: true, document: doc });
});

const getAllLegalDocumentsAdmin = asyncHandler(async (req, res) => {
  const { status, type } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (type) filter.type = type;
  const docs = await LegalDocument.find(filter).sort('-createdAt');
  res.json({ success: true, documents: docs });
});

const updateLegalDocument = asyncHandler(async (req, res) => {
  const doc = await LegalDocument.findById(req.params.id);
  if (!doc) { res.status(404); throw new Error('Document not found'); }
  if (doc.status === 'published') {
    res.status(400);
    throw new Error('Published documents cannot be edited — publish a new version instead');
  }

  ['title', 'type', 'version', 'description', 'effectiveDate', 'expiryDate', 'isMandatory', 'audience'].forEach((f) => {
    if (req.body[f] !== undefined) doc[f] = req.body[f];
  });
  if (req.file) doc.fileUrl = req.file.path;

  await doc.save();
  res.json({ success: true, document: doc });
});

// Publishing auto-archives the previous published version of the same type,
// so a seller is only ever asked to accept the current one.
const publishLegalDocument = asyncHandler(async (req, res) => {
  const doc = await LegalDocument.findById(req.params.id);
  if (!doc) { res.status(404); throw new Error('Document not found'); }

  await LegalDocument.updateMany(
    { type: doc.type, status: 'published', _id: { $ne: doc._id } },
    { status: 'archived' }
  );

  doc.status = 'published';
  await doc.save();
  res.json({ success: true, document: doc });
});

const archiveLegalDocument = asyncHandler(async (req, res) => {
  const doc = await LegalDocument.findByIdAndUpdate(req.params.id, { status: 'archived' }, { new: true });
  if (!doc) { res.status(404); throw new Error('Document not found'); }
  res.json({ success: true, document: doc });
});

const deleteLegalDocument = asyncHandler(async (req, res) => {
  const doc = await LegalDocument.findById(req.params.id);
  if (!doc) { res.status(404); throw new Error('Document not found'); }
  if (doc.status === 'published') {
    res.status(400);
    throw new Error('Archive a published document before deleting it');
  }
  await doc.deleteOne();
  res.json({ success: true, message: 'Document deleted' });
});

const getDocumentAcceptances = asyncHandler(async (req, res) => {
  const acceptances = await SellerAcceptance.find({ document: req.params.id })
    .populate('seller', 'name email role businessName shopName')
    .sort('-acceptedAt');
  res.json({ success: true, acceptances });
});

// ============================================================
// SELLER-FACING
// ============================================================

const getRequiredDocumentsForSeller = asyncHandler(async (req, res) => {
  const docs = await LegalDocument.find({
    status: 'published',
    isMandatory: true,
    audience: { $in: ['sellers', 'both'] },
  }).sort('title');

  const acceptedIds = await SellerAcceptance.find({
    seller: req.user.id,
    document: { $in: docs.map((d) => d._id) },
  }).distinct('document');
  const acceptedSet = new Set(acceptedIds.map(String));

  res.json({
    success: true,
    documents: docs.map((d) => ({
      _id: d._id,
      title: d.title,
      type: d.type,
      version: d.version,
      fileUrl: d.fileUrl,
      effectiveDate: d.effectiveDate,
      accepted: acceptedSet.has(String(d._id)),
    })),
  });
});

const acceptDocument = asyncHandler(async (req, res) => {
  const doc = await LegalDocument.findById(req.params.id);
  if (!doc || doc.status !== 'published') {
    res.status(404);
    throw new Error('Document not found or not currently active');
  }

  const existing = await SellerAcceptance.findOne({ seller: req.user.id, document: doc._id });
  if (existing) {
    return res.json({ success: true, acceptance: existing, message: 'Already accepted' });
  }

  const acceptance = await SellerAcceptance.create({
    seller: req.user.id,
    document: doc._id,
    documentType: doc.type,
    version: doc.version,
    acceptedAt: new Date(),
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'] || '',
  });

  res.status(201).json({ success: true, acceptance });
});

module.exports = {
  createLegalDocument,
  getAllLegalDocumentsAdmin,
  updateLegalDocument,
  publishLegalDocument,
  archiveLegalDocument,
  deleteLegalDocument,
  getDocumentAcceptances,
  getRequiredDocumentsForSeller,
  acceptDocument,
};