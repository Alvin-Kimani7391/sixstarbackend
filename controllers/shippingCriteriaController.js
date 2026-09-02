const asyncHandler = require('express-async-handler');
const Category = require('../models/Category');
const ShippingCriteria = require('../models/ShippingCriteria');
const { isLeafCategory } = require('./categoryAttributeController');

// GET /api/categories/:id/shipping-criteria (public — seller product form + checkout quote)
const getCategoryShippingCriteria = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) { res.status(404); throw new Error('Category not found'); }

  const groups = await ShippingCriteria.find({ category: category._id, isActive: true }).sort('displayOrder');
  res.json({
    success: true,
    criteria: groups.map((g) => ({
      _id: g._id,
      name: g.name,
      isRequired: g.isRequired,
      displayOrder: g.displayOrder,
      options: g.options.filter((o) => o.isActive).map((o) => ({ _id: o._id, label: o.label, price: o.price })),
    })),
  });
});

// GET /api/admin/shipping-criteria?category=:id
const getAllShippingCriteriaAdmin = asyncHandler(async (req, res) => {
  const filter = req.query.category ? { category: req.query.category } : {};
  const groups = await ShippingCriteria.find(filter).populate('category', 'name').sort('displayOrder');
  res.json({ success: true, count: groups.length, criteria: groups });
});

// POST /api/admin/shipping-criteria
const createShippingCriteria = asyncHandler(async (req, res) => {
  const { category, name, options, isRequired, displayOrder } = req.body;
  if (!category || !name || !Array.isArray(options) || options.length === 0) {
    res.status(400); throw new Error('category, name, and at least one option are required');
  }

  const categoryDoc = await Category.findById(category);
  if (!categoryDoc) { res.status(400); throw new Error('Category not found'); }
  if (!(await isLeafCategory(category))) {
    res.status(400);
    throw new Error('Shipping criteria can only be assigned to a category with no subcategories.');
  }

  for (const o of options) {
    if (!o.label || o.price === undefined || Number(o.price) < 0 || Number.isNaN(Number(o.price))) {
      res.status(400); throw new Error('Every option needs a label and a valid non-negative price');
    }
  }

  const group = await ShippingCriteria.create({
    category, name,
    options: options.map((o) => ({ label: o.label, price: Number(o.price), isActive: o.isActive !== false })),
    isRequired: isRequired !== false,
    displayOrder: displayOrder || 0,
  });
  res.status(201).json({ success: true, criteria: group });
});

// PATCH /api/admin/shipping-criteria/:id
const updateShippingCriteria = asyncHandler(async (req, res) => {
  const group = await ShippingCriteria.findById(req.params.id);
  if (!group) { res.status(404); throw new Error('Shipping criteria group not found'); }

  if (req.body.name !== undefined) group.name = req.body.name;
  if (req.body.isRequired !== undefined) group.isRequired = !!req.body.isRequired;
  if (req.body.displayOrder !== undefined) group.displayOrder = req.body.displayOrder;
  if (req.body.isActive !== undefined) group.isActive = !!req.body.isActive;

  if (req.body.options !== undefined) {
    if (!Array.isArray(req.body.options) || req.body.options.length === 0) {
      res.status(400); throw new Error('At least one option is required');
    }
    for (const o of req.body.options) {
      if (!o.label || o.price === undefined || Number(o.price) < 0 || Number.isNaN(Number(o.price))) {
        res.status(400); throw new Error('Every option needs a label and a valid non-negative price');
      }
    }
    // Preserve existing option _ids where possible so products referencing
    // them by id don't silently break — match by incoming _id when present.
    group.options = req.body.options.map((o) => ({
      _id: o._id || undefined,
      label: o.label,
      price: Number(o.price),
      isActive: o.isActive !== false,
    }));
  }

  await group.save();
  res.json({ success: true, criteria: group });
});

// DELETE /api/admin/shipping-criteria/:id
const deleteShippingCriteria = asyncHandler(async (req, res) => {
  // Block deletion if any active product actually references this group, so
  // we never silently zero-out someone's already-priced special shipping.
  const Product = require('../models/Product');
  const inUse = await Product.countDocuments({
    isActive: true,
    'shippingCriteriaSelections.criteria': req.params.id,
  });
  if (inUse > 0) {
    res.status(400);
    throw new Error('This shipping criteria is used by one or more products. Reassign or deactivate it instead.');
  }
  const group = await ShippingCriteria.findByIdAndDelete(req.params.id);
  if (!group) { res.status(404); throw new Error('Shipping criteria group not found'); }
  res.json({ success: true, message: 'Shipping criteria deleted' });
});

module.exports = {
  getCategoryShippingCriteria,
  getAllShippingCriteriaAdmin,
  createShippingCriteria,
  updateShippingCriteria,
  deleteShippingCriteria,
};