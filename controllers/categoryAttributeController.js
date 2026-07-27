const asyncHandler = require('express-async-handler');
const Category = require('../models/Category');
const CategoryAttribute = require('../models/CategoryAttribute');
const Attribute = require('../models/Attribute');

// A category qualifies to hold products/attributes only if it has no active children.
const isLeafCategory = async (categoryId) => {
  const childCount = await Category.countDocuments({ parentCategory: categoryId, isActive: true });
  return childCount === 0;
};

// Shared fetch+shape used by both the public GET route and productController's validation.
const getCategoryAttributeDefs = async (categoryId) => {
  const links = await CategoryAttribute.find({ category: categoryId })
    .populate('attribute')
    .sort('displayOrder');

  return links
    .filter((link) => link.attribute && link.attribute.isActive)
    .map((link) => ({
      _id: link.attribute._id,
      name: link.attribute.name,
      slug: link.attribute.slug,
      type: link.attribute.type,
      options: link.attribute.options,
      unit: link.attribute.unit,
      isVariantAttribute: link.attribute.isVariantAttribute,
      isRequired: link.isRequired,
      displayOrder: link.displayOrder,
    }));
};

// @desc    Get the attributes assigned to a category — used by the seller product form
//          to know which fields to render, and by the storefront to build filters.
// @route   GET /api/categories/:id/attributes
// @access  Public
const getCategoryAttributes = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) {
    res.status(404);
    throw new Error('Category not found');
  }

  const attributes = await getCategoryAttributeDefs(category._id);
  res.json({ success: true, count: attributes.length, attributes });
});

// @desc    Admin sets the full attribute list for a category (replaces existing links)
// @route   PUT /api/admin/categories/:id/attributes
// @access  Private (admin)
const setCategoryAttributes = asyncHandler(async (req, res) => {
  const { attributes } = req.body; // [{ attribute: id, isRequired: bool, displayOrder: n }]

  const category = await Category.findById(req.params.id);
  if (!category) {
    res.status(404);
    throw new Error('Category not found');
  }

  const leaf = await isLeafCategory(category._id);
  if (!leaf) {
    res.status(400);
    throw new Error(
      'Attributes can only be assigned to a category with no subcategories, since that is where products get attached.'
    );
  }

  if (!Array.isArray(attributes)) {
    res.status(400);
    throw new Error('attributes must be an array');
  }

  if (attributes.length > 0) {
    const attributeIds = attributes.map((a) => a.attribute);
    const uniqueIds = new Set(attributeIds.map(String));
    if (uniqueIds.size !== attributeIds.length) {
      res.status(400);
      throw new Error('The same attribute was listed more than once');
    }

    const found = await Attribute.countDocuments({ _id: { $in: attributeIds } });
    if (found !== uniqueIds.size) {
      res.status(400);
      throw new Error('One or more attribute IDs are invalid');
    }
  }

  await CategoryAttribute.deleteMany({ category: category._id });

  if (attributes.length > 0) {
    const docs = attributes.map((a, i) => ({
      category: category._id,
      attribute: a.attribute,
      isRequired: !!a.isRequired,
      displayOrder: a.displayOrder ?? i,
    }));
    await CategoryAttribute.insertMany(docs);
  }

  const result = await getCategoryAttributeDefs(category._id);
  res.json({ success: true, attributes: result });
});

module.exports = {
  getCategoryAttributes,
  setCategoryAttributes,
  isLeafCategory,
  getCategoryAttributeDefs,
};