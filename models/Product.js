const mongoose = require('mongoose');
const { Schema } = mongoose;

const productAttributeValueSchema = new Schema(
  {
    attribute: { type: Schema.Types.ObjectId, ref: 'Attribute', required: true },
    value: { type: Schema.Types.Mixed, required: true },
  },
  { _id: false }
);

const pricingTierSchema = new Schema(
  {
    minQty: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const deliveryChargeSchema = new Schema(
  {
    chargeType: {
      type: String,
      enum: ['fixed', 'quantity_based', 'negotiated'],
      default: 'fixed',
    },
    amount: { type: Number, default: 0, min: 0 },
    perUnitAmount: { type: Number, default: 0, min: 0 },
    notes: { type: String, default: '', trim: true },
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

    shop: { type: Schema.Types.ObjectId, ref: 'Shop', default: null, index: true },

    name: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    images: {
      type: [String],
      validate: {
        validator: (arr) => arr.length > 0 && arr.length <= 8,
        message: 'A product must have between 1 and 8 images',
      },
      required: true,
    },

    category: { type: Schema.Types.ObjectId, ref: 'Category', required: true },

    attributes: {
      type: [productAttributeValueSchema],
      default: [],
    },

    stock: { type: Number, required: true, min: 0, default: 0 },

    sellerPrice: { type: Number, required: true },
    finalPrice: { type: Number, default: null },
    discountPercent: { type: Number, default: 0, min: 0, max: 90 },

    deliveryType: {
      type: String,
      enum: ['simple', 'heavy'],
      default: 'heavy',
    },
    minOrderQuantity: {
      type: Number,
      default: 1,
      min: 1,
    },
    pricingTiers: {
      type: [pricingTierSchema],
      default: [],
    },
    freeDelivery: { type: Boolean, default: false },
    deliveryCharge: {
      type: deliveryChargeSchema,
      default: () => ({}),
    },

    // ---------------------------------------------------------------
    // NEW — Low-stock reminder settings (seller-configurable, drives the
    // "Manage Stock" panel on the seller dashboard's Analytics page).
    //   - stockReminderEnabled:  whether this product's stock is being watched at all
    //   - stockReminderThreshold: the seller-chosen quantity ("remind me at <= X")
    //   - lastStockReminderSentAt: bookkeeping only — null means "not currently
    //     in a low-stock alert state" (either never dropped below threshold, or
    //     it dropped and has since been restocked above it, re-arming future
    //     alerts). Non-null means an email has already gone out for the CURRENT
    //     dip and is still being periodically re-sent by the scheduler until
    //     the seller restocks (see utils/stockReminderService.js).
    // ---------------------------------------------------------------
    stockReminderEnabled: { type: Boolean, default: false },
    stockReminderThreshold: { type: Number, default: 5, min: 0 },
    lastStockReminderSentAt: { type: Date, default: null },

    status: {
      type: String,
      enum: ['draft', 'pending_review', 'active', 'rejected', 'suspended'],
      default: 'draft',
      index: true,
    },
    rejectionReason: { type: String, default: '' },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },

    isHotDeal: { type: Boolean, default: false },

    ratingsAverage: { type: Number, default: 0, min: 0, max: 5 },
    ratingsCount: { type: Number, default: 0 },

    viewCount: { type: Number, default: 0, index: true },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

productSchema.virtual('displayPrice').get(function () {
  if (this.finalPrice == null) return null;
  if (!this.discountPercent) return this.finalPrice;
  return Math.round(this.finalPrice * (1 - this.discountPercent / 100));
});

productSchema.virtual('hasFreeDeliveryTag').get(function () {
  return this.sellerRole === 'wholesaler' && this.deliveryType === 'heavy' && this.freeDelivery === true;
});

productSchema.virtual('variants', {
  ref: 'ProductVariant',
  localField: '_id',
  foreignField: 'product',
});

productSchema.set('toJSON', { virtuals: true });
productSchema.set('toObject', { virtuals: true });

productSchema.index({ status: 1, isActive: 1, category: 1 });
productSchema.index({ status: 1, isHotDeal: 1 });
productSchema.index({ status: 1, sellerRole: 1, freeDelivery: 1 });
productSchema.index({ name: 'text', description: 'text' });
// NEW — used by the scheduler's recheckAllLowStockProducts() sweep
productSchema.index({ stockReminderEnabled: 1, isActive: 1, lastStockReminderSentAt: 1 });

module.exports = mongoose.model('Product', productSchema);