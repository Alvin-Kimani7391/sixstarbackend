const express = require('express');
const router = express.Router();
const {
  createProduct,
  updateProduct,
  submitProductForReview,
  getMyProducts,
  deleteProduct,
  getProducts,
  getProductById,
  getProductSuggestions,
  trackProductViewCount,
  getMyProductAnalytics,
  getMyStockOverview,
  updateStockReminderSettings,
  bulkUpdateStockReminderSettings,
} = require('../controllers/productController');
const { createReview, getProductReviews } = require('../controllers/reviewController');
const { protect, authorize } = require('../middleware/authMiddleware');
const { uploadProductImages } = require('../middleware/uploadMiddleware');
const { requireApprovedSeller } = require('../middleware/verificationMiddleware');

// Public storefront
router.get('/', getProducts);

// Seller-only (wholesaler/retailer) — MUST be declared before '/:id' or
// Express will treat these static paths as an :id value.
router.get('/my-products', protect, authorize('wholesaler', 'retailer'), getMyProducts);
router.get('/analytics', protect, authorize('wholesaler', 'retailer'), getMyProductAnalytics);
router.get('/stock-overview', protect, authorize('wholesaler', 'retailer'), getMyStockOverview);
router.patch('/stock-reminder/bulk', protect, authorize('wholesaler', 'retailer'), bulkUpdateStockReminderSettings); // must stay before '/:id/stock-reminder'
router.get('/suggestions', getProductSuggestions);

// createProduct/updateProduct now also accept: weightKg (normal categories)
// or shippingCriteriaSelections (JSON string, special categories) — see
// productController's validateAndPrepareShipping().
router.post('/', protect, requireApprovedSeller, uploadProductImages, createProduct);

router.get('/:id', getProductById);
router.get('/:productId/reviews', getProductReviews);

router.put('/:id', protect, authorize('wholesaler', 'retailer'), uploadProductImages, updateProduct);
router.patch('/:id/submit', protect, requireApprovedSeller, submitProductForReview);
router.patch('/:id/stock-reminder', protect, authorize('wholesaler', 'retailer'), updateStockReminderSettings);
router.delete('/:id', protect, authorize('wholesaler', 'retailer'), deleteProduct);

// Public view-tracking ping
router.patch('/:id/view', trackProductViewCount);

// Buyer reviews
router.post('/:productId/reviews', protect, authorize('buyer'), createReview);

module.exports = router;