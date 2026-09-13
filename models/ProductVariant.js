const mongoose = require('mongoose');
const { Schema } = mongoose;

const variantValueSchema = new Schema(
  {
    attribute: { type: Schema.Types.ObjectId, ref: 'Attribute', required: true },
    value: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const productVariantSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    sku: { type: String, default: '', trim: true },
    combination: {
      type: [variantValueSchema],
      validate: {
        validator: (arr) => arr.length > 0,
        message: 'A variant needs at least one attribute value (e.g. Size, Color)',
      },
    },
    stock: { type: Number, required: true, min: 0, default: 0 },
    priceAdjustment: { type: Number, default: 0 }, // added to (or subtracted from) the product's finalPrice

    // ============================================================
    // NEW — SPECIAL / CUSTOM VARIANT PRICING
    // Lets a seller give ONE specific variant combination its own fixed
    // selling price, completely independent of the product's base price
    // and independent of priceAdjustment. Useful when the admin's
    // attribute/price model doesn't anticipate a particular combination
    // that's specific to just this product (e.g. one oddball size that
    // costs meaningfully more/less than the rest).
    //
    // When useCustomPrice is true, the storefront (product-detail.js)
    // uses customPrice directly as the displayed/purchased price for that
    // variant and ignores priceAdjustment entirely. priceAdjustment is
    // always stored as 0 in that case (see productController.js).
    // ============================================================
    useCustomPrice: { type: Boolean, default: false },
    customPrice: { type: Number, default: null, min: 0 },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Human-readable label built from the combination, e.g. "42 / White"
productVariantSchema.virtual('label').get(function () {
  return (this.combination || []).map((c) => c.value).join(' / ');
});

productVariantSchema.set('toJSON', { virtuals: true });
productVariantSchema.set('toObject', { virtuals: true });

productVariantSchema.index({ product: 1, isActive: 1 });

module.exports = mongoose.model('ProductVariant', productVariantSchema);