const mongoose = require('mongoose');
const { Schema } = mongoose;

const productAttributeValueSchema = new Schema(
  {
    attribute: { type: Schema.Types.ObjectId, ref: 'Attribute', required: true },
    value: { type: Schema.Types.Mixed, required: true }, // string, number, boolean, or array (multiselect)
  },
  { _id: false }
);

const productSchema = new Schema(
  {
    seller: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    sellerRole: {
      type: String,
      enum: ['wholesaler', 'retailer'],
      required: true,
    },

    name: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    images: {
      type: [String], // Cloudinary URLs
      validate: {
        validator: (arr) => arr.length > 0 && arr.length <= 8,
        message: 'A product must have between 1 and 8 images',
      },
      required: true,
    },

    category: { type: Schema.Types.ObjectId, ref: 'Category', required: true },

    // Product-level attribute values (e.g. Brand: "Nike", Gender: "Unisex").
    // Attributes flagged isVariantAttribute never appear here - they live on ProductVariant instead.
    attributes: {
      type: [productAttributeValueSchema],
      default: [],
    },

    // If the category has variant-defining attributes (e.g. Size/Color), this is the
    // SUM of all variant stock and is kept in sync whenever variants are written.
    // If the category has none, this is the plain, directly-editable stock count.
    stock: { type: Number, required: true, min: 0, default: 0 },

    // --- Pricing / monetization gate ---
    sellerPrice: { type: Number, required: true }, // what the seller proposes
    finalPrice: { type: Number, default: null }, // what admin sets — this is the real selling price
    discountPercent: { type: Number, default: 0, min: 0, max: 90 },

    // --- Approval workflow ---
    status: {
      type: String,
      enum: ['draft', 'pending_review', 'active', 'rejected', 'suspended'],
      default: 'draft',
      index: true,
    },
    rejectionReason: { type: String, default: '' },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },

    isHotDeal: { type: Boolean, default: false }, // toggled only by admin

    // --- Ratings (auto-calculated from Review collection) ---
    ratingsAverage: { type: Number, default: 0, min: 0, max: 5 },
    ratingsCount: { type: Number, default: 0 },

    isActive: { type: Boolean, default: true }, // seller/admin can soft-delete
  },
  { timestamps: true }
);

// Virtual: the effective displayed price after discount, only meaningful once finalPrice is set
productSchema.virtual('displayPrice').get(function () {
  if (this.finalPrice == null) return null;
  if (!this.discountPercent) return this.finalPrice;
  return Math.round(this.finalPrice * (1 - this.discountPercent / 100));
});

// Virtual populate: lets us do Product.find().populate('variants') without embedding them
productSchema.virtual('variants', {
  ref: 'ProductVariant',
  localField: '_id',
  foreignField: 'product',
});

productSchema.set('toJSON', { virtuals: true });
productSchema.set('toObject', { virtuals: true });

// Helpful compound index for the public storefront query
productSchema.index({ status: 1, isActive: 1, category: 1 });
productSchema.index({ status: 1, isHotDeal: 1 });
productSchema.index({ name: 'text', description: 'text' }); // for search

module.exports = mongoose.model('Product', productSchema);