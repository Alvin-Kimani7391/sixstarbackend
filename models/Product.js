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

// ============================================================
// NEW — per-product shipping-criteria selection (only meaningful when
// shippingType === 'special'). Stores ONLY references to the admin-managed
// ShippingCriteria/option — price and label are always resolved live at
// quote/order time via utils/shippingFeeCalculator.js, never cached here,
// so admin price edits apply to every future checkout immediately.
// ============================================================
const shippingCriteriaSelectionSchema = new Schema(
  {
    criteria: { type: Schema.Types.ObjectId, ref: 'ShippingCriteria', required: true },
    option: { type: Schema.Types.ObjectId, required: true }, // subdocument _id inside ShippingCriteria.options
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
    // NEW — DYNAMIC SHIPPING (replaces the old region/town-only transport
    // model for anything that isn't a self-delivering 'heavy' wholesaler).
    //
    // shippingType is a SNAPSHOT of the category's resolved classification
    // at the moment the product was last saved (see
    // resolveCategoryShippingType() in categoryController.js, called from
    // productController on create/update whenever the category changes).
    // It exists on the product purely so we know which of the two fields
    // below to expect/validate/render — the AUTHORITATIVE shipping-type
    // check at quote/order time always re-resolves live from the category,
    // never trusts this snapshot alone (an admin re-specializing a category
    // must retroactively affect every product in it).
    //
        //   'normal'  -> weightKg is required, used against WeightTier
        //   'special' -> shippingCriteriaSelections is required (per the
        //                category's ShippingCriteria groups), used against
        //                each selected option's live price
        //
        // A seller with deliveryType 'heavy' (their own transport terms) is
        // ALWAYS excluded from this system entirely, exactly like they're
        // excluded from the old standard Transport fee — see
        // utils/shippingFeeCalculator.js.
    // ---------------------------------------------------------------
    shippingType: {
      type: String,
      enum: ['normal', 'special'],
      default: 'normal',
    },
    weightKg: { type: Number, default: null, min: 0 },
    shippingCriteriaSelections: {
      type: [shippingCriteriaSelectionSchema],
      default: [],
    },

    // ---------------------------------------------------------------
    // Low-stock reminder settings (seller-configurable, drives the
    // "Manage Stock" panel on the seller dashboard's Analytics page).
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
// used by the scheduler's recheckAllLowStockProducts() sweep
productSchema.index({ stockReminderEnabled: 1, isActive: 1, lastStockReminderSentAt: 1 });
// NEW — used by dashboards/reporting that need to split normal vs special shipping products
productSchema.index({ shippingType: 1, status: 1, isActive: 1 });

module.exports = mongoose.model('Product', productSchema);