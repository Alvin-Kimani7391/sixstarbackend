const mongoose = require('mongoose');
const { Schema } = mongoose;

const productAttributeValueSchema = new Schema(
  {
    attribute: { type: Schema.Types.ObjectId, ref: 'Attribute', required: true },
    value: { type: Schema.Types.Mixed, required: true }, // string, number, boolean, or array (multiselect)
  },
  { _id: false }
);

// ---------------------------------------------------------------------------
// Wholesale-only sub-schemas
// ---------------------------------------------------------------------------

// A single "buy N or more, pay this price" tier, e.g. { minQty: 100, price: 450 }
const pricingTierSchema = new Schema(
  {
    minQty: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

// Wholesale delivery terms. Only meaningful when sellerRole === 'wholesaler'
// AND deliveryType === 'heavy' (see below).
//  - freeDelivery = true  -> the rest of this object is ignored, product gets the
//    "Free Delivery" tag on the frontend.
//  - freeDelivery = false -> chargeType decides which of the amount fields applies:
//      fixed          -> flat `amount` regardless of quantity ordered
//      quantity_based -> `perUnitAmount` x quantity ordered
//      negotiated     -> no fixed figure, `notes` explains how it's agreed (e.g. "Contact
//                         seller for a delivery quote based on destination and volume")
const deliveryChargeSchema = new Schema(
  {
    chargeType: {
      type: String,
      enum: ['fixed', 'quantity_based', 'negotiated'],
      default: 'fixed',
    },
    amount: { type: Number, default: 0, min: 0 }, // used when chargeType === 'fixed'
    perUnitAmount: { type: Number, default: 0, min: 0 }, // used when chargeType === 'quantity_based'
    notes: { type: String, default: '', trim: true }, // used when chargeType === 'negotiated'
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

    // --- Wholesaler-only fields (ignored/validated-away for retailers) ---

    // Whether this wholesale product needs its own negotiated/bulky transport terms
    // ('heavy' — the classic wholesale delivery panel below applies), or is light
    // enough to just ship like a normal retail item at checkout ('simple' — buyer
    // pays the regular regional transport fee, no MOQ-style delivery math at all).
    // Always 'simple' for retailers (irrelevant to them).
    deliveryType: {
      type: String,
      enum: ['simple', 'heavy'],
      default: 'heavy',
    },
    minOrderQuantity: {
      type: Number,
      default: 1,
      min: 1,
    }, // smallest quantity a buyer may order of THIS product
    pricingTiers: {
      type: [pricingTierSchema],
      default: [],
    }, // quantity-based bulk pricing, e.g. 50 units @ X, 100 units @ Y, 500 units @ Z
    freeDelivery: { type: Boolean, default: false }, // only meaningful when deliveryType === 'heavy'
    deliveryCharge: {
      type: deliveryChargeSchema,
      default: () => ({}),
    }, // only meaningful when deliveryType === 'heavy'

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

    // --- Analytics ---
    // Lifetime total of product-detail-page views. Incremented via $inc on every
    // public view (see trackProductViewCount) — cheap to read for dashboard cards.
    // Day-by-day trend data lives in the separate ProductView collection.
    viewCount: { type: Number, default: 0, index: true },

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

// Virtual: the free-delivery tag used to group/filter on the frontend
// (e.g. "Free Delivery Wholesale Products" section). Always false for retailers
// and for 'simple' wholesale products (those ship like retail, no tag).
productSchema.virtual('hasFreeDeliveryTag').get(function () {
  return this.sellerRole === 'wholesaler' && this.deliveryType === 'heavy' && this.freeDelivery === true;
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
productSchema.index({ status: 1, sellerRole: 1, freeDelivery: 1 }); // "Free Delivery Wholesale Products" section
productSchema.index({ name: 'text', description: 'text' }); // for search

module.exports = mongoose.model('Product', productSchema);