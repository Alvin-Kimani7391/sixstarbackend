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
} = require('../controllers/productController');
const { createReview, getProductReviews } = require('../controllers/reviewController');
const { protect, authorize } = require('../middleware/authMiddleware');
const { uploadProductImages } = require('../middleware/uploadMiddleware');

// Public storefront
router.get('/', getProducts);

// Seller-only (wholesaler/retailer) - MUST be declared before '/:id' or Express will
// treat "my-products" as an :id value and route it to getProductById instead
router.get('/my-products', protect, authorize('wholesaler', 'retailer'), getMyProducts);
router.post('/', protect, authorize('wholesaler', 'retailer'), uploadProductImages, createProduct);

router.get('/:id', getProductById);
router.get('/:productId/reviews', getProductReviews);
router.put('/:id', protect, authorize('wholesaler', 'retailer'), uploadProductImages, updateProduct);
router.patch('/:id/submit', protect, authorize('wholesaler', 'retailer'), submitProductForReview);
router.delete('/:id', protect, authorize('wholesaler', 'retailer'), deleteProduct);

// Buyer reviews
router.post('/:productId/reviews', protect, authorize('buyer'), createReview);

module.exports = router;
