const asyncHandler = require('express-async-handler');
const Category = require('../models/Category');
const Product = require('../models/Product');

const MAX_LEVEL = 2; // 0 = Parent Category, 1 = Category, 2 = Sub Category

// @desc    Get all active categories (flat list — for navbar, filters, product creation form)
// @route   GET /api/categories
// @access  Public
const getCategories = asyncHandler(async (req, res) => {
  const categories = await Category.find({ isActive: true }).sort('name');
  res.json({ success: true, count: categories.length, categories });
});

// @desc    Get ALL categories including inactive ones - for the admin dashboard
// @route   GET /api/admin/categories
// @access  Private (admin)
const getAllCategoriesAdmin = asyncHandler(async (req, res) => {
  const categories = await Category.find().sort('name');
  res.json({ success: true, count: categories.length, categories });
});

// @desc    Get full category tree (nested) — used by mega-menu, seller category picker
// @route   GET /api/categories/tree
// @access  Public
const getCategoryTree = asyncHandler(async (req, res) => {
  const categories = await Category.find({ isActive: true }).sort('name').lean();
  const byId = {};
  categories.forEach((c) => {
    c.children = [];
    byId[c._id.toString()] = c;
  });

  const roots = [];
  categories.forEach((c) => {
    if (c.parentCategory && byId[c.parentCategory.toString()]) {
      byId[c.parentCategory.toString()].children.push(c);
    } else if (!c.parentCategory) {
      roots.push(c);
    }
  });

  res.json({ success: true, tree: roots });
});

// @desc    Get one category by slug, with its direct children + breadcrumb trail
// @route   GET /api/categories/:slug
// @access  Public
const getCategoryBySlug = asyncHandler(async (req, res) => {
  const category = await Category.findOne({ slug: req.params.slug, isActive: true });
  if (!category) {
    res.status(404);
    throw new Error('Category not found');
  }

  const children = await Category.find({ parentCategory: category._id, isActive: true }).sort('name');

  // walk up the parentCategory chain to build the breadcrumb trail
  const breadcrumb = [category];
  let current = category;
  while (current.parentCategory) {
    current = await Category.findById(current.parentCategory);
    if (!current) break;
    breadcrumb.unshift(current);
  }

  res.json({ success: true, category, children, breadcrumb });
});

// Max depth below `categoryId` among its existing descendants (0 if it has no children)
const getMaxDescendantDepth = async (categoryId, currentDepth = 0) => {
  const children = await Category.find({ parentCategory: categoryId }).select('_id');
  if (children.length === 0) return currentDepth;
  const depths = await Promise.all(
    children.map((c) => getMaxDescendantDepth(c._id, currentDepth + 1))
  );
  return Math.max(...depths);
};

// Recompute .level for every descendant after a subtree gets moved
const cascadeLevelUpdate = async (categoryId, newLevel) => {
  const children = await Category.find({ parentCategory: categoryId }).select('_id');
  await Promise.all(
    children.map(async (c) => {
      await Category.findByIdAndUpdate(c._id, { level: newLevel });
      await cascadeLevelUpdate(c._id, newLevel + 1);
    })
  );
};

// @desc    Admin creates a category (optionally nested under a parent)
// @route   POST /api/categories
// @access  Private (admin)
const createCategory = asyncHandler(async (req, res) => {
  const { name, parentCategory } = req.body;
  if (!name) {
    res.status(400);
    throw new Error('Category name is required');
  }

  let level = 0;
  if (parentCategory) {
    const parent = await Category.findById(parentCategory);
    if (!parent) {
      res.status(400);
      throw new Error('Parent category not found');
    }
    if (parent.level >= MAX_LEVEL) {
      res.status(400);
      throw new Error(
        'Maximum category depth reached (Parent Category → Category → Sub Category). Products should be assigned directly to this category instead of adding another level.'
      );
    }
    level = parent.level + 1;
  }

  const slug = name.toLowerCase().trim().replace(/\s+/g, '-');
  const image = req.file ? req.file.path : '';

  const category = await Category.create({
    name,
    slug,
    image,
    parentCategory: parentCategory || null,
    level,
  });
  res.status(201).json({ success: true, category });
});

// @desc    Admin updates a category, including moving it under a different parent
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

  if (req.body.parentCategory !== undefined) {
    const newParentId = req.body.parentCategory || null;

    if (newParentId && newParentId === String(category._id)) {
      res.status(400);
      throw new Error('A category cannot be its own parent');
    }

    // prevent creating a cycle (assigning a descendant as the parent)
    let newLevel = 0;
    if (newParentId) {
      let cursor = await Category.findById(newParentId);
      if (!cursor) {
        res.status(400);
        throw new Error('Parent category not found');
      }
      let walker = cursor;
      while (walker) {
        if (String(walker._id) === String(category._id)) {
          res.status(400);
          throw new Error('Cannot move a category under one of its own descendants');
        }
        walker = walker.parentCategory ? await Category.findById(walker.parentCategory) : null;
      }
      newLevel = cursor.level + 1;
    }

    // reject the move if it would push any existing subcategory below this one past the max depth
    const descendantDepth = await getMaxDescendantDepth(category._id);
    if (newLevel + descendantDepth > MAX_LEVEL) {
      res.status(400);
      throw new Error(
        'This move would push one of its subcategories beyond the maximum depth (Parent Category → Category → Sub Category).'
      );
    }

    category.parentCategory = newParentId;
    category.level = newLevel;

    await category.save();
    await cascadeLevelUpdate(category._id, newLevel + 1);
    res.json({ success: true, category });
    return;
  }

  await category.save();
  res.json({ success: true, category });
});

// @desc    Admin deletes (deactivates) a category — blocked if it still has active
//          subcategories or active products, so nothing gets orphaned.
// @route   DELETE /api/categories/:id
// @access  Private (admin)
const deleteCategory = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) {
    res.status(404);
    throw new Error('Category not found');
  }

  const childCount = await Category.countDocuments({ parentCategory: category._id, isActive: true });
  if (childCount > 0) {
    res.status(400);
    throw new Error('This category still has active subcategories. Remove or reassign them first.');
  }

  const productCount = await Product.countDocuments({ category: category._id, isActive: true });
  if (productCount > 0) {
    res.status(400);
    throw new Error('This category still has products assigned to it. Reassign them first.');
  }

  category.isActive = false;
  await category.save();
  res.json({ success: true, message: 'Category removed' });
});

module.exports = {
  getCategories,
  getAllCategoriesAdmin,
  getCategoryTree,
  getCategoryBySlug,
  createCategory,
  updateCategory,
  deleteCategory,
};