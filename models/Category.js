const mongoose = require('mongoose');
const { Schema } = mongoose;

const categorySchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    image: { type: String, default: '' },
    parentCategory: { type: Schema.Types.ObjectId, ref: 'Category', default: null },

    // 0 = Parent Category, 1 = Category, 2 = Sub Category.
    // Products attach to whichever level has no children below it (the leaf) -
    // that leaf is the "Actual Item" level from the spec, not a 4th category tier.
    level: { type: Number, default: 0, min: 0, max: 2 },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

categorySchema.index({ parentCategory: 1 });
categorySchema.index({ level: 1 });

module.exports = mongoose.model('Category', categorySchema);