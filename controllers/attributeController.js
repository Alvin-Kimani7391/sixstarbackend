const asyncHandler = require('express-async-handler');
const Attribute = require('../models/Attribute');
const CategoryAttribute = require('../models/CategoryAttribute');

// @desc    Get all attributes (admin management list)
// @route   GET /api/admin/attributes
// @access  Private (admin)
const getAttributes = asyncHandler(async (req, res) => {
  const attributes = await Attribute.find().sort('name');
  res.json({ success: true, count: attributes.length, attributes });
});

// @desc    Create a reusable attribute definition (e.g. "Brand", "Size", "Color")
// @route   POST /api/admin/attributes
// @access  Private (admin)
const createAttribute = asyncHandler(async (req, res) => {
  const { name, type, options, unit, isVariantAttribute } = req.body;
  if (!name || !type) {
    res.status(400);
    throw new Error('Name and type are required');
  }

  const attribute = await Attribute.create({
    name,
    type,
    options: Array.isArray(options) ? options : [],
    unit: unit || '',
    isVariantAttribute: !!isVariantAttribute,
  });

  res.status(201).json({ success: true, attribute });
});

// @desc    Update an attribute definition
// @route   PUT /api/admin/attributes/:id
// @access  Private (admin)
const updateAttribute = asyncHandler(async (req, res) => {
  const attribute = await Attribute.findById(req.params.id);
  if (!attribute) {
    res.status(404);
    throw new Error('Attribute not found');
  }

  const fields = ['name', 'type', 'options', 'unit', 'isVariantAttribute', 'isActive'];
  fields.forEach((f) => {
    if (req.body[f] !== undefined) attribute[f] = req.body[f];
  });

  // Changing an attribute's slug isn't allowed via name edits after creation,
  // to avoid silently breaking existing CategoryAttribute/Product references.
  await attribute.save();
  res.json({ success: true, attribute });
});

// @desc    Delete an attribute definition (blocked if assigned to any category)
// @route   DELETE /api/admin/attributes/:id
// @access  Private (admin)
const deleteAttribute = asyncHandler(async (req, res) => {
  const inUse = await CategoryAttribute.countDocuments({ attribute: req.params.id });
  if (inUse > 0) {
    res.status(400);
    throw new Error('This attribute is assigned to one or more categories. Remove those assignments first.');
  }

  const attribute = await Attribute.findByIdAndDelete(req.params.id);
  if (!attribute) {
    res.status(404);
    throw new Error('Attribute not found');
  }

  res.json({ success: true, message: 'Attribute deleted' });
});

module.exports = { getAttributes, createAttribute, updateAttribute, deleteAttribute };