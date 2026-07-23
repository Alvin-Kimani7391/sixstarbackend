const express = require('express');
const router = express.Router();
const {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} = require('../controllers/categoryController');
const { protect, authorize } = require('../middleware/authMiddleware');
const { uploadSingleImage } = require('../middleware/uploadMiddleware');

router.get('/', getCategories);
router.post('/', protect, authorize('admin'), uploadSingleImage, createCategory);
router.put('/:id', protect, authorize('admin'), uploadSingleImage, updateCategory);
router.delete('/:id', protect, authorize('admin'), deleteCategory);

module.exports = router;
