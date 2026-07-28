const mongoose = require('mongoose');
const { Schema } = mongoose;
const Counter = require('./Counter');

const orderItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },

    // Which specific variant (e.g. Color: Red / Size: 42) was purchased, if the
    // product's category has variant-defining attributes. Null for products with
    // no variant attributes at all.
    variant: { type: Schema.Types.ObjectId, ref: 'ProductVariant', default: null },
    variantLabel: { type: String, default: '' }, // snapshot, e.g. "Red / 42"

    seller: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sellerRole: { type: String, enum: ['wholesaler', 'retailer'], required: true }, // snapshot

    name: String, // snapshot at time of purchase
    image: String,
    quantity: { type: Number, required: true, min: 1 },
    priceAtPurchase: { type: Number, required: true }, // snapshot of tier-resolved BUYER-facing unit price

    // Snapshot of the SELLER's own asking price (+ variant adjustment) at time of
    // purchase, independent of whatever admin markup/discount was applied to
    // priceAtPurchase above. This is what the seller dashboard displays — it never
    // drifts even if the seller later edits their product's sellerPrice.
    sellerPriceAtPurchase: { type: Number, required: true },

    // This line's contribution to delivery cost (wholesale only — 0 for retailer
    // lines, which are covered by the order-level transportFee instead).
    deliveryFee: { type: Number, default: 0 },
  },
  { _id: false }
);

const orderSchema = new Schema(
  {
    // Human-friendly sequential reference, e.g. "ORD-100", "ORD-101", ...
    // Assigned automatically in the pre('save') hook below.
    orderNumber: { type: String, unique: true, index: true },

    buyer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    items: { type: [orderItemSchema], required: true },
    totalAmount: { type: Number, required: true }, // items + deliveryFee

    // --- Delivery breakdown ---
    deliveryFee: { type: Number, default: 0 }, // transportFee + wholesaleDeliveryFee
    deliveryDetails: {
      transportFee: { type: Number, default: 0 }, // retail region/town transport
      wholesaleDeliveryFee: { type: Number, default: 0 }, // sum of per-product wholesale delivery
      notes: { type: [String], default: [] }, // e.g. negotiated-delivery terms per product
    },

    shippingAddress: {
      fullName: String,
      phone: String,
      address: String,
      city: String,
      notes: String,
    },

    // --- M-Pesa manual confirmation ---
    mpesaMessage: { type: String, required: true }, // raw pasted confirmation SMS
    mpesaCode: { type: String, default: '' }, // parsed transaction code, e.g. "QWE1XYZ23"
    paymentStatus: {
      type: String,
      enum: ['pending_verification', 'confirmed', 'rejected'],
      default: 'pending_verification',
      index: true,
    },
    verifiedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    verifiedAt: { type: Date, default: null },

    orderStatus: {
      type: String,
      enum: ['processing', 'shipped', 'delivered', 'cancelled'],
      default: 'processing',
    },

    // --- Agent attribution ---
    agent: { type: Schema.Types.ObjectId, ref: 'Agent', default: null, index: true },
    agentCode: { type: String, default: '' },
    commissionAmount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Try to auto-extract the M-Pesa transaction code (e.g. "SFH3K2LMNO Confirmed...")
orderSchema.pre('validate', function (next) {
  if (this.mpesaMessage && !this.mpesaCode) {
    const match = this.mpesaMessage.match(/\b[A-Z0-9]{10}\b/);
    if (match) this.mpesaCode = match[0];
  }
  next();
});

// Assign a sequential ORD-### number the first time this order is saved.
orderSchema.pre('save', async function (next) {
  if (this.isNew && !this.orderNumber) {
    try {
      const counter = await Counter.findByIdAndUpdate(
        'orderNumber',
        { $inc: { seq: 1 } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
      this.orderNumber = `ORD-${counter.seq}`;
    } catch (err) {
      return next(err);
    }
  }
  next();
});

module.exports = mongoose.model('Order', orderSchema);