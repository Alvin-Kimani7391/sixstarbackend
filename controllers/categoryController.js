const asyncHandler = require('express-async-handler');
const Category = require('../models/Category');

// @desc    Get all active categories (for navbar, filters, product creation form)
// @route   GET /api/categories
// @access  Public
const getCategories = asyncHandler(async (req, res) => {
  const categories = await Category.find({ isActive: true }).sort('name');
  res.json({ success: true, count: categories.length, categories });
});

// @desc    Admin creates a category
// @route   POST /api/categories
// @access  Private (admin)
const createCategory = asyncHandler(async (req, res) => {
  const { name, parentCategory } = req.body;
  if (!name) {
    res.status(400);
    throw new Error('Category name is required');
  }

  const slug = name.toLowerCase().trim().replace(/\s+/g, '-');
  const image = req.file ? req.file.path : '';

  const category = await Category.create({ name, slug, image, parentCategory: parentCategory || null });
  res.status(201).json({ success: true, category });
});

// @desc    Admin updates a category
// @route   PUT /api/categories/:id
// @access  Private (admin)
const updateCategory = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) {
    res.status(404);
    throw new Error('Category not found');
  }

  if (req.body.name) {
    category.name = req.body.name;
    category.slug = req.body.name.toLowerCase().trim().replace(/\s+/g, '-');
  }
  if (req.file) category.image = req.file.path;
  if (req.body.isActive !== undefined) category.isActive = req.body.isActive;

  await category.save();
  res.json({ success: true, category });
});

// @desc    Admin deletes (deactivates) a category
// @route   DELETE /api/categories/:id
// @access  Private (admin)
const deleteCategory = asyncHandler(async (req, res) => {
  const category = await Category.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
  if (!category) {
    res.status(404);
    throw new Error('Category not found');
  }
  res.json({ success: true, message: 'Category removed' });
});

module.exports = { getCategories, createCategory, updateCategory, deleteCategory };
