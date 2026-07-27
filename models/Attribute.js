const mongoose = require('mongoose');
const { Schema } = mongoose;

const attributeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    type: {
      type: String,
      enum: ['text', 'number', 'select', 'multiselect', 'boolean'],
      required: true,
      default: 'select',
    },
    options: {
      type: [String], // only used when type is 'select' or 'multiselect', e.g. ["S","M","L","XL"]
      default: [],
    },
    unit: { type: String, default: '' }, // optional, purely for display e.g. "cm", "kg"

    // true  => this attribute creates separate stock-tracked variants (e.g. Size, Color)
    // false => this attribute is a single descriptive value stored directly on the product (e.g. Brand, Material)
    isVariantAttribute: { type: Boolean, default: false },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

attributeSchema.pre('validate', function (next) {
  if (this.name && !this.slug) {
    this.slug = this.name.toLowerCase().trim().replace(/\s+/g, '-');
  }
  if (['select', 'multiselect'].includes(this.type) && (!this.options || this.options.length === 0)) {
    this.invalidate('options', 'At least one option is required for select/multiselect attributes');
  }
  next();
});

module.exports = mongoose.model('Attribute', attributeSchema);