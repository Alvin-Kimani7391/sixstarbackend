const express = require('express');
const router = express.Router();
const {
  getAllProductsAdmin,
  adminUpdateProduct,
  reactivateProduct,
  adminDeleteProduct,
  getAllOrdersAdmin,
  getPendingProducts,
  approveProduct,
  rejectProduct,
  updateProductPricing,
  suspendProduct,
  getPendingPaymentOrders,
  verifyOrderPayment,
  getAllUsers,
  setUserStatus,
} = require('../controllers/adminController');
const { getAllAdsAdmin } = require('../controllers/adController');
const { getAllCategoriesAdmin } = require('../controllers/categoryController');
const { setCategoryAttributes } = require('../controllers/categoryAttributeController');
const {
  getAttributes,
  createAttribute,
  updateAttribute,
  deleteAttribute,
} = require('../controllers/attributeController');
const { getAllAgentsAdmin } = require('../controllers2/agentController');
const { protect, authorize } = require('../middleware/authMiddleware');
const { uploadProductImages, uploadLegalDocument } = require('../middleware/uploadMiddleware');

const {
  getAllVerifications,
  getPendingVerifications,
  approveVerification,
  rejectVerification,
} = require('../controllers/sellerVerificationController');

const {
  createLegalDocument,
  getAllLegalDocumentsAdmin,
  updateLegalDocument,
  publishLegalDocument,
  archiveLegalDocument,
  deleteLegalDocument,
  getDocumentAcceptances,
} = require('../controllers/legalDocumentController');

// ---------------------------------------------------------------------------
// SECURITY: everything below this line is admin-only. Nothing in this router
// should ever sit above this line — the previous draft had the legal-document
// CRUD routes declared before this gate, which made them publicly reachable.
// ---------------------------------------------------------------------------
router.use(protect, authorize('admin'));

// ---------- Seller Verification ----------
// Full list with optional ?status= filter (pending | approved | rejected | not_submitted)
router.get('/seller-verifications', getAllVerifications);
// Kept for backward compatibility with any existing callers
router.get('/seller-verifications/pending', getPendingVerifications);
router.patch('/seller-verifications/:id/approve', approveVerification);
router.patch('/seller-verifications/:id/reject', rejectVerification);

// ---------- Legal Documents ----------
router.get('/legal-documents', getAllLegalDocumentsAdmin);
router.post('/legal-documents', uploadLegalDocument, createLegalDocument);
router.patch('/legal-documents/:id', uploadLegalDocument, updateLegalDocument);
router.patch('/legal-documents/:id/publish', publishLegalDocument);
router.patch('/legal-documents/:id/archive', archiveLegalDocument);
router.delete('/legal-documents/:id', deleteLegalDocument);
router.get('/legal-documents/:id/acceptances', getDocumentAcceptances);

// ---------- Categories ----------
router.get('/categories', getAllCategoriesAdmin);
router.put('/categories/:id/attributes', setCategoryAttributes);

// ---------- Attributes ----------
router.get('/attributes', getAttributes);
router.post('/attributes', createAttribute);
router.put('/attributes/:id', updateAttribute);
router.delete('/attributes/:id', deleteAttribute);

// ---------- Agents ----------
router.get('/agents', getAllAgentsAdmin);

// ---------- Products ----------
router.get('/products', getAllProductsAdmin);
router.patch('/products/:id', uploadProductImages, adminUpdateProduct); // full field edit, incl. images
router.patch('/products/:id/reactivate', reactivateProduct);
router.delete('/products/:id', adminDeleteProduct);

router.get('/products/pending', getPendingProducts);
router.patch('/products/:id/approve', approveProduct);
router.patch('/products/:id/reject', rejectProduct);
router.patch('/products/:id/price', updateProductPricing);
router.patch('/products/:id/suspend', suspendProduct);

// ---------- Orders ----------
router.get('/orders', getAllOrdersAdmin);
router.get('/orders/pending-payment', getPendingPaymentOrders);
router.patch('/orders/:id/verify-payment', verifyOrderPayment);

// ---------- Ads ----------
router.get('/ads', getAllAdsAdmin);

// ---------- Users ----------
router.get('/users', getAllUsers);
router.patch('/users/:id/status', setUserStatus);

module.exports = router;