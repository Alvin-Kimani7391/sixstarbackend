const express = require('express');
const router = express.Router();
const {
  getCategories,
  getCategoryTree,
  getCategoryBySlug,
  createCategory,
  updateCategory,
  deleteCategory,
  getCategoryCommission,
  getCategoryShippingType, // NEW
} = require('../controllers/categoryController');
const { getCategoryAttributes } = require('../controllers/categoryAttributeController');
const { getCategoryShippingCriteria } = require('../controllers/shippingCriteriaController'); // NEW
const { protect, authorize } = require('../middleware/authMiddleware');
const { uploadSingleImage } = require('../middleware/uploadMiddleware');

// IMPORTANT: /tree must come before /:slug, or Express will treat "tree" as a slug
router.get('/', getCategories);
router.get('/tree', getCategoryTree);

// Which attributes apply to this category (used by the seller product form + storefront filters).
router.get('/:id/attributes', getCategoryAttributes);

// Effective marketplace commission for this category (own rate, inherited, or platform default).
router.get('/:id/commission', getCategoryCommission);

// NEW — Effective shipping classification ('normal' | 'special') for this category.
router.get('/:id/shipping', getCategoryShippingType);

// NEW — The priced shipping-criteria option groups for this category (only
// meaningful when its effective shippingType is 'special', but safe to call
// regardless — simply returns an empty list otherwise).
router.get('/:id/shipping-criteria', getCategoryShippingCriteria);

router.get('/:slug', getCategoryBySlug);

router.post('/', protect, authorize('admin'), uploadSingleImage, createCategory);
router.put('/:id', protect, authorize('admin'), uploadSingleImage, updateCategory);
router.delete('/:id', protect, authorize('admin'), deleteCategory);

module.exports = router;