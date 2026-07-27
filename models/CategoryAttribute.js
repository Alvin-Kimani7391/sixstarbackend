const mongoose = require('mongoose');
const { Schema } = mongoose;

const categoryAttributeSchema = new Schema(
  {
    category: { type: Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
    attribute: { type: Schema.Types.ObjectId, ref: 'Attribute', required: true },
    isRequired: { type: Boolean, default: false },
    displayOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// A given attribute can only be linked to a category once
categoryAttributeSchema.index({ category: 1, attribute: 1 }, { unique: true });

module.exports = mongoose.model('CategoryAttribute', categoryAttributeSchema);