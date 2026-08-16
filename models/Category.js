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

    // ------------------------------------------------------------------
    // MARKETPLACE COMMISSION
    // ------------------------------------------------------------------
    // The percentage of the buyer-facing price that Six Star Suppliers keeps
    // for products attached to this category, e.g. 12 means 12%.
    //
    // null/undefined = "not set on this category" -> the effective rate is
    // INHERITED from the nearest ancestor category that does have a rate
    // set, and finally falls back to the platform default
    // (DEFAULT_COMMISSION_RATE in controllers/categoryController.js) if
    // nothing in the chain has one. This lets an admin set one commission
    // on a Parent Category (e.g. "Electronics: 10%") and have it apply to
    // every Category/Sub Category underneath unless a more specific one is
    // set lower down.
    //
    // See resolveCategoryCommissionRate() in categoryController.js for the
    // actual inheritance-walk logic, and orderController.js for where this
    // gets resolved and snapshotted onto each order line at purchase time.
    commissionRate: { type: Number, default: null, min: 0, max: 100 },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

categorySchema.index({ parentCategory: 1 });
categorySchema.index({ level: 1 });

module.exports = mongoose.model('Category', categorySchema);