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
  getCategoryShippingType,
  getCommissionOverview, // NEW
} = require('../controllers/categoryController');
const { getCategoryAttributes } = require('../controllers/categoryAttributeController');
const { getCategoryShippingCriteria } = require('../controllers/shippingCriteriaController');
const { protect, authorize } = require('../middleware/authMiddleware');
const { uploadSingleImage } = require('../middleware/uploadMiddleware');

// IMPORTANT: static paths (/tree, /commission-overview) must come before
// /:slug, or Express will treat them as a slug value.
router.get('/', getCategories);
router.get('/tree', getCategoryTree);

// NEW — full resolved commission tree, used by the seller dashboard's
// "Marketplace Commission" chart/table. Must stay above '/:slug'.
router.get(
  '/commission-overview',
  protect,
  authorize('wholesaler', 'retailer', 'admin'),
  getCommissionOverview
);

// Which attributes apply to this category (used by the seller product form + storefront filters).
router.get('/:id/attributes', getCategoryAttributes);

// Effective marketplace commission for this category (own rate, inherited, or platform default).
router.get('/:id/commission', getCategoryCommission);

// Effective shipping classification ('normal' | 'special') for this category.
router.get('/:id/shipping', getCategoryShippingType);

// The priced shipping-criteria option groups for this category (only
// meaningful when its effective shippingType is 'special', but safe to call
// regardless — simply returns an empty list otherwise).
router.get('/:id/shipping-criteria', getCategoryShippingCriteria);

router.get('/:slug', getCategoryBySlug);

router.post('/', protect, authorize('admin'), uploadSingleImage, createCategory);
router.put('/:id', protect, authorize('admin'), uploadSingleImage, updateCategory);
router.delete('/:id', protect, authorize('admin'), deleteCategory);

module.exports = router;