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
  getMyStockOverview,            // NEW
  updateStockReminderSettings,   // NEW
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
router.get('/stock-overview', protect, authorize('wholesaler', 'retailer'), getMyStockOverview); // NEW
router.get('/suggestions', getProductSuggestions);

router.post('/', protect, requireApprovedSeller, uploadProductImages, createProduct);

router.get('/:id', getProductById);
router.get('/:productId/reviews', getProductReviews);

router.put('/:id', protect, authorize('wholesaler', 'retailer'), uploadProductImages, updateProduct);
router.patch('/:id/submit', protect, requireApprovedSeller, submitProductForReview);
router.patch('/:id/stock-reminder', protect, authorize('wholesaler', 'retailer'), updateStockReminderSettings); // NEW
router.delete('/:id', protect, authorize('wholesaler', 'retailer'), deleteProduct);

// Public view-tracking ping
router.patch('/:id/view', trackProductViewCount);

// Buyer reviews
router.post('/:productId/reviews', protect, authorize('buyer'), createReview);

module.exports = router;