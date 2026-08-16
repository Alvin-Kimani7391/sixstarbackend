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
} = require('../controllers/categoryController');
const { getCategoryAttributes } = require('../controllers/categoryAttributeController');
const { protect, authorize } = require('../middleware/authMiddleware');
const { uploadSingleImage } = require('../middleware/uploadMiddleware');

// IMPORTANT: /tree must come before /:slug, or Express will treat "tree" as a slug
router.get('/', getCategories);
router.get('/tree', getCategoryTree);

// Which attributes apply to this category (used by the seller product form + storefront filters).
// Safe ahead of /:slug since it's a two-segment path ("/:id/attributes"), not a single slug.
router.get('/:id/attributes', getCategoryAttributes);

// Effective marketplace commission for this category (own rate, inherited, or
// platform default). Also a two-segment path, safe ahead of /:slug. Public so
// sellers can see it live while picking a category on the product form.
router.get('/:id/commission', getCategoryCommission);

router.get('/:slug', getCategoryBySlug);

router.post('/', protect, authorize('admin'), uploadSingleImage, createCategory);
router.put('/:id', protect, authorize('admin'), uploadSingleImage, updateCategory);
router.delete('/:id', protect, authorize('admin'), deleteCategory);

module.exports = router;