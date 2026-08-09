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
  getProductSuggestions,   // <-- add
  trackProductViewCount,
  getMyProductAnalytics,
} = require('../controllers/productController');
const { createReview, getProductReviews } = require('../controllers/reviewController');
const { protect, authorize } = require('../middleware/authMiddleware');
const { uploadProductImages } = require('../middleware/uploadMiddleware');
const{ requireApprovedSeller } = require('../middleware/verificationMiddleware');
// Public storefront
router.get('/', getProducts);

// Seller-only (wholesaler/retailer) - MUST be declared before '/:id' or Express will
// treat "my-products" / "analytics" as an :id value and route it to getProductById instead
router.get('/my-products', protect, authorize('wholesaler', 'retailer'), getMyProducts);
router.get('/analytics', protect, authorize('wholesaler', 'retailer'), getMyProductAnalytics);
router.get('/suggestions', getProductSuggestions);   // <-- add this line here
router.post('/', protect, authorize('wholesaler', 'retailer'), uploadProductImages, createProduct);

router.get('/:id', getProductById);
router.get('/:productId/reviews', getProductReviews);

router.post('/', protect, requireApprovedSeller, uploadProductImages, createProduct);
router.patch('/:id/submit', protect, requireApprovedSeller, submitProductForReview);

// Public view-tracking ping fired once per product-detail-page load (guests included —
// no `protect` here, req.user is simply undefined for them and the view still counts).
router.patch('/:id/view', trackProductViewCount);

router.put('/:id', protect, authorize('wholesaler', 'retailer'), uploadProductImages, updateProduct);
router.patch('/:id/submit', protect, authorize('wholesaler', 'retailer'), submitProductForReview);
router.delete('/:id', protect, authorize('wholesaler', 'retailer'), deleteProduct);

// Buyer reviews
router.post('/:productId/reviews', protect, authorize('buyer'), createReview);

module.exports = router;