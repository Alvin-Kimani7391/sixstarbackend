const mongoose = require('mongoose');
const { Schema } = mongoose;

// ============================================================
// SHIPPING CRITERIA — admin-managed, per-category priced option groups
// used to price shipping for every product whose category resolves to
// shippingType 'special' (see Category.shippingType / resolveCategoryShippingType).
//
// A category can have multiple criteria GROUPS (e.g. "Size Class" AND
// "Fragility"), each with several priced OPTIONS (e.g. Small/Medium/Large).
// Sellers creating a product in a 'special' category must pick exactly one
// option per required group; the price is NEVER cached on the product —
// only the (criteria, option) reference is stored, so admin can retune
// prices later and it applies retroactively/dynamically at every future
// checkout quote.
//
// At checkout, each special-shipping line item's total = sum of its
// selected options' prices * quantity. Every special item contributes
// independently (unlike 'normal' items, which are pooled by weight first).
// ============================================================
const shippingCriteriaOptionSchema = new Schema(
  {
    label: { type: String, required: true, trim: true }, // e.g. "Small", "Large", "Fragile"
    price: { type: Number, required: true, min: 0 },       // flat KSh charged per unit when this option is selected
    isActive: { type: Boolean, default: true },
  },
  { timestamps: false }
);

const shippingCriteriaSchema = new Schema(
  {
    category: { type: Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
    name: { type: String, required: true, trim: true }, // e.g. "Size Class"
    options: {
      type: [shippingCriteriaOptionSchema],
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length > 0,
        message: 'At least one priced option is required',
      },
    },
    isRequired: { type: Boolean, default: true },
    displayOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

shippingCriteriaSchema.index({ category: 1, isActive: 1 });
shippingCriteriaSchema.index({ category: 1, displayOrder: 1 });

module.exports = mongoose.model('ShippingCriteria', shippingCriteriaSchema);