/* ============================================================
   SIX STAR SUPPLIERS — Admin routes
   Every route in this file requires an authenticated admin
   (see the protect/authorize gate below). Nothing should ever be
   declared above that gate.
   ============================================================ */

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
  getStkPaymentIssues,
  recheckStkPayment,
  forceCancelStkOrder,
  getAllUsers,
  setUserStatus,
  getEarningsSummary,
  getEarningsOrders,
  getAllTiersAdmin,
  createTransactionFeeTier,
  updateTransactionFeeTier,
  deleteTransactionFeeTier,
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

// ---------- Flash Sale (daily 2:00 PM \u2013 midnight deals) ----------
const {
  getPendingFlashSales,
  getAllFlashSalesAdmin,
  approveFlashSale,
  rejectFlashSale,
} = require('../controllers/flashSaleController');

const { protect, authorize } = require('../middleware/authMiddleware');
const { uploadProductImages, uploadLegalDocument } = require('../middleware/uploadMiddleware');



// ---------------------------------------------------------------------------
// SECURITY: everything below this line is admin-only. Nothing in this router
// should ever sit above this line.
// ---------------------------------------------------------------------------
router.use(protect, authorize('admin'));

// ============================================================
// Seller Verification
// ============================================================
router.get('/seller-verifications', getAllVerifications); // ?status=pending|approved|rejected|not_submitted
router.get('/seller-verifications/pending', getPendingVerifications); // kept for backward compatibility
router.patch('/seller-verifications/:id/approve', approveVerification);
router.patch('/seller-verifications/:id/reject', rejectVerification);

// ============================================================
// Legal Documents
// ============================================================
router.get('/legal-documents', getAllLegalDocumentsAdmin);
router.post('/legal-documents', uploadLegalDocument, createLegalDocument);
router.patch('/legal-documents/:id', uploadLegalDocument, updateLegalDocument);
router.patch('/legal-documents/:id/publish', publishLegalDocument);
router.patch('/legal-documents/:id/archive', archiveLegalDocument);
router.delete('/legal-documents/:id', deleteLegalDocument);
router.get('/legal-documents/:id/acceptances', getDocumentAcceptances);

// ============================================================
// Categories & Attributes
// ============================================================
router.get('/categories', getAllCategoriesAdmin);
router.put('/categories/:id/attributes', setCategoryAttributes);

router.get('/attributes', getAttributes);
router.post('/attributes', createAttribute);
router.put('/attributes/:id', updateAttribute);
router.delete('/attributes/:id', deleteAttribute);

// ============================================================
// Agents
// ============================================================
router.get('/agents', getAllAgentsAdmin);

// ============================================================
// Products
// ============================================================
router.get('/products', getAllProductsAdmin);
router.patch('/products/:id', uploadProductImages, adminUpdateProduct); // full field edit, incl. images
router.patch('/products/:id/reactivate', reactivateProduct);
router.delete('/products/:id', adminDeleteProduct);

router.get('/products/pending', getPendingProducts);
router.patch('/products/:id/approve', approveProduct);
router.patch('/products/:id/reject', rejectProduct);
router.patch('/products/:id/price', updateProductPricing);
router.patch('/products/:id/suspend', suspendProduct);

// ============================================================
// Flash Sale (daily 2:00 PM \u2013 midnight deals)
// ------------------------------------------------------------
// A seller submits a live product (price, stock allocation, sale
// date) at least 24h ahead via POST /api/flash-sales. It lands
// here as 'pending_review' until an admin approves or rejects it.
// Once approved, a background scheduler (utils/flashSaleScheduler.js)
// automatically flips it live at 2:00 PM and ends it at midnight
// or the moment its allocated stock sells out \u2014 no further admin
// action needed after approval.
// ============================================================
router.get('/flash-sales', getAllFlashSalesAdmin); // ?status=&page=&limit=
router.get('/flash-sales/pending', getPendingFlashSales);
router.patch('/flash-sales/:id/approve', approveFlashSale);
router.patch('/flash-sales/:id/reject', rejectFlashSale);

// ============================================================
// Orders
// ============================================================
// ============================================================
// Orders
// ============================================================
router.get('/orders', getAllOrdersAdmin);
router.get('/orders/pending-payment', getPendingPaymentOrders);
router.patch('/orders/:id/verify-payment', verifyOrderPayment);

// STK Push issues — NEW
router.get('/orders/stk-issues', getStkPaymentIssues);
router.patch('/orders/:id/stk-recheck', recheckStkPayment);
router.patch('/orders/:id/stk-cancel', forceCancelStkOrder);

// ============================================================
// Earnings
// ============================================================
router.get('/earnings/summary', getEarningsSummary);
router.get('/earnings/orders', getEarningsOrders);


// ============================================================
// Transaction Fees (seller-side payment-processing fee ladder)
// ============================================================



router.get('/transaction-fees', getAllTiersAdmin);
router.post('/transaction-fees', createTransactionFeeTier);
router.patch('/transaction-fees/:id', updateTransactionFeeTier);
router.delete('/transaction-fees/:id', deleteTransactionFeeTier);
// ============================================================
// Ads
// ============================================================
router.get('/ads', getAllAdsAdmin);

// ============================================================
// Users
// ============================================================
router.get('/users', getAllUsers);
router.patch('/users/:id/status', setUserStatus);

module.exports = router;