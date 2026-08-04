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
const { uploadProductImages } = require('../middleware/uploadMiddleware');


const {
  getPendingVerifications,
  approveVerification,
  rejectVerification,
} = require('../controllers/sellerVerificationController');

router.get('/seller-verifications/pending', protect, admin, getPendingVerifications);
router.patch('/seller-verifications/:id/approve', protect, admin, approveVerification);
router.patch('/seller-verifications/:id/reject', protect, admin, rejectVerification);

const {
  createLegalDocument,
  getAllLegalDocumentsAdmin,
  updateLegalDocument,
  publishLegalDocument,
  archiveLegalDocument,
  deleteLegalDocument,
  getDocumentAcceptances,
} = require('../controllers/legalDocumentController');
const { uploadLegalDocument } = require('../middleware/uploadMiddleware');

// Legal document management (Terms, Seller Agreement, policies, etc.)
router.get('/legal-documents', getAllLegalDocumentsAdmin);
router.post('/legal-documents', uploadLegalDocument, createLegalDocument);
router.patch('/legal-documents/:id', uploadLegalDocument, updateLegalDocument);
router.patch('/legal-documents/:id/publish', publishLegalDocument);
router.patch('/legal-documents/:id/archive', archiveLegalDocument);
router.delete('/legal-documents/:id', deleteLegalDocument);
router.get('/legal-documents/:id/acceptances', getDocumentAcceptances);

// Every route here is admin-only
router.use(protect, authorize('admin'));

// Categories (full list including inactive)
router.get('/categories', getAllCategoriesAdmin);

// Which attributes are assigned to a category (leaf categories only)
router.put('/categories/:id/attributes', setCategoryAttributes);

// Attribute definitions (Brand, Size, Color, ...)
router.get('/attributes', getAttributes);
router.post('/attributes', createAttribute);
router.put('/attributes/:id', updateAttribute);
router.delete('/attributes/:id', deleteAttribute);

// Agents (full list including inactive, with commission stats)
router.get('/agents', getAllAgentsAdmin);

// Full product oversight - the dashboard's main product table
router.get('/products', getAllProductsAdmin);
router.patch('/products/:id', uploadProductImages, adminUpdateProduct); // full field edit, incl. images
router.patch('/products/:id/reactivate', reactivateProduct);
router.delete('/products/:id', adminDeleteProduct);

// Product review/pricing gate
router.get('/products/pending', getPendingProducts);
router.patch('/products/:id/approve', approveProduct);
router.patch('/products/:id/reject', rejectProduct);
router.patch('/products/:id/price', updateProductPricing);
router.patch('/products/:id/suspend', suspendProduct);

// Full order oversight + M-Pesa manual payment verification
router.get('/orders', getAllOrdersAdmin);
router.get('/orders/pending-payment', getPendingPaymentOrders);
router.patch('/orders/:id/verify-payment', verifyOrderPayment);

// Ads (full list including inactive)
router.get('/ads', getAllAdsAdmin);

// User management (view + suspend/reactivate wholesalers, retailers, buyers)
router.get('/users', getAllUsers);
router.patch('/users/:id/status', setUserStatus);

module.exports = router;