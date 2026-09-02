const asyncHandler = require('express-async-handler');
const Category = require('../models/Category');
const Product = require('../models/Product');

const MAX_LEVEL = 2; // 0 = Parent Category, 1 = Category, 2 = Sub Category

// ---------------------------------------------------------------------------
// MARKETPLACE COMMISSION
// ---------------------------------------------------------------------------
const getDefaultCommissionRate = () => {
  const fromEnv = Number(process.env.DEFAULT_COMMISSION_RATE);
  return Number.isFinite(fromEnv) ? fromEnv : 10;
};

const resolveCategoryCommissionRate = async (categoryIdOrDoc) => {
  let current =
    categoryIdOrDoc && categoryIdOrDoc.commissionRate !== undefined && categoryIdOrDoc._id
      ? categoryIdOrDoc
      : await Category.findById(categoryIdOrDoc).select('commissionRate parentCategory name');

  const visited = new Set();
  while (current) {
    const idStr = String(current._id);
    if (visited.has(idStr)) break;
    visited.add(idStr);

    if (current.commissionRate !== null && current.commissionRate !== undefined) {
      return { rate: current.commissionRate, source: current._id, sourceName: current.name };
    }

    current = current.parentCategory
      ? await Category.findById(current.parentCategory).select('commissionRate parentCategory name')
      : null;
  }

  return { rate: getDefaultCommissionRate(), source: 'default', sourceName: 'Platform default' };
};

// ---------------------------------------------------------------------------
// SHIPPING CLASSIFICATION (NEW) — 'normal' (weight-based) vs 'special'
// (criteria-based). Same ancestor-inheritance walk as commission, above.
// Platform default is always 'normal' — every category ships as a normal,
// weight-priced item unless an admin explicitly specializes it or one of
// its ancestors.
// ---------------------------------------------------------------------------
const resolveCategoryShippingType = async (categoryIdOrDoc) => {
  let current =
    categoryIdOrDoc && categoryIdOrDoc.shippingType !== undefined && categoryIdOrDoc._id
      ? categoryIdOrDoc
      : await Category.findById(categoryIdOrDoc).select('shippingType parentCategory name');

  const visited = new Set();
  while (current) {
    const idStr = String(current._id);
    if (visited.has(idStr)) break;
    visited.add(idStr);

    if (current.shippingType) {
      return { shippingType: current.shippingType, source: current._id, sourceName: current.name };
    }

    current = current.parentCategory
      ? await Category.findById(current.parentCategory).select('shippingType parentCategory name')
      : null;
  }

  return { shippingType: 'normal', source: 'default', sourceName: 'Platform default' };
};

// Parses/validates a raw shippingType value coming from the request body.
// Accepts: undefined (leave alone), '' / 'null' (clear -> inherit), or
// exactly 'normal' / 'special'.
const parseShippingTypeInput = (raw) => {
  if (raw === '' || raw === 'null' || raw === null) return null;
  if (!['normal', 'special'].includes(raw)) {
    const err = new Error("shippingType must be 'normal' or 'special'");
    err.status = 400;
    throw err;
  }
  return raw;
};

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

// Parses/validates a raw commissionRate value coming from the request body.
const parseCommissionRateInput = (raw) => {
  if (raw === '' || raw === 'null' || raw === null) return null;
  const parsed = Number(raw);
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 100) {
    const err = new Error('Commission rate must be a number between 0 and 100');
    err.status = 400;
    throw err;
  }
  return parsed;
};

// @desc    Admin creates a category (optionally nested under a parent)
// @route   POST /api/categories
// @access  Private (admin)
const createCategory = asyncHandler(async (req, res) => {
  const { name, parentCategory, commissionRate, shippingType } = req.body;
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

  let parsedCommission = null;
  if (commissionRate !== undefined) {
    try {
      parsedCommission = parseCommissionRateInput(commissionRate);
    } catch (err) {
      res.status(err.status || 400);
      throw err;
    }
  }

  let parsedShippingType = null;
  if (shippingType !== undefined) {
    try {
      parsedShippingType = parseShippingTypeInput(shippingType);
    } catch (err) {
      res.status(err.status || 400);
      throw err;
    }
  }

  const category = await Category.create({
    name,
    slug,
    image,
    parentCategory: parentCategory || null,
    level,
    commissionRate: parsedCommission,
    shippingType: parsedShippingType,
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

  // Marketplace commission — applied here so it's picked up regardless of
  // whether this request also happens to move the category under a new
  // parent (that branch returns early further down).
  if (req.body.commissionRate !== undefined) {
    try {
      category.commissionRate = parseCommissionRateInput(req.body.commissionRate);
    } catch (err) {
      res.status(err.status || 400);
      throw err;
    }
  }

  // Shipping classification — same "apply before the early-return move
  // branch" treatment as commission above.
  if (req.body.shippingType !== undefined) {
    try {
      category.shippingType = parseShippingTypeInput(req.body.shippingType);
    } catch (err) {
      res.status(err.status || 400);
      throw err;
    }
  }

  if (req.body.parentCategory !== undefined) {
    const newParentId = req.body.parentCategory || null;

    if (newParentId && newParentId === String(category._id)) {
      res.status(400);
      throw new Error('A category cannot be its own parent');
    }

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

// @desc    Resolve the EFFECTIVE marketplace commission rate for a category.
// @route   GET /api/categories/:id/commission
// @access  Public
const getCategoryCommission = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id).select('_id');
  if (!category) {
    res.status(404);
    throw new Error('Category not found');
  }
  const { rate, source, sourceName } = await resolveCategoryCommissionRate(req.params.id);
  res.json({
    success: true,
    commissionRate: rate,
    inherited: source !== String(req.params.id),
    source,
    sourceName,
  });
});

// @desc    Resolve the EFFECTIVE shipping classification for a category —
//          its own setting if set, otherwise inherited from the nearest
//          ancestor, otherwise 'normal'. Powers the seller product wizard's
//          weight-field vs shipping-criteria-picker branch, and the admin
//          category form's live preview.
// @route   GET /api/categories/:id/shipping
// @access  Public
const getCategoryShippingType = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id).select('_id');
  if (!category) {
    res.status(404);
    throw new Error('Category not found');
  }
  const { shippingType, source, sourceName } = await resolveCategoryShippingType(req.params.id);
  res.json({
    success: true,
    shippingType,
    inherited: source !== String(req.params.id),
    source,
    sourceName,
  });
});

module.exports = {
  getCategories,
  getAllCategoriesAdmin,
  getCategoryTree,
  getCategoryBySlug,
  createCategory,
  updateCategory,
  deleteCategory,
  getCategoryCommission,
  getCategoryShippingType,
  resolveCategoryCommissionRate, // used by orderController.js
  resolveCategoryShippingType,   // used by productController.js + shippingFeeCalculator.js
  getDefaultCommissionRate,
};