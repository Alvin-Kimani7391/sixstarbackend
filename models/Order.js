const mongoose = require('mongoose');
const { Schema } = mongoose;
const Counter = require('./Counter');

const orderItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    variant: { type: Schema.Types.ObjectId, ref: 'ProductVariant', default: null },
    variantLabel: { type: String, default: '' },

    seller: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sellerRole: { type: String, enum: ['wholesaler', 'retailer'], required: true },

    name: String,
    image: String,
    quantity: { type: Number, required: true, min: 1 },
    priceAtPurchase: { type: Number, required: true },
    sellerPriceAtPurchase: { type: Number, required: true },

    commissionRate: { type: Number, default: 0 },
    commissionAmount: { type: Number, default: 0 },
    sellerPayout: { type: Number, default: 0 },

    isFlashDeal: { type: Boolean, default: false },
    flashSale: { type: Schema.Types.ObjectId, ref: 'FlashSale', default: null },

    deliveryFee: { type: Number, default: 0 },
  },
  { _id: false }
);

// One entry per seller present in this order — the tiered transaction fee
// charged against THAT seller's own buyer-facing subtotal within this order
// (a real payment-processor fee scales per settlement, not per line item).
// Snapshotted at order-creation time off whatever TransactionFeeTier ladder
// is active at that moment, so later admin edits to the ladder never rewrite
// historical orders/earnings. See controllers/transactionFeeController.js.
const sellerFeeSchema = new Schema(
  {
    seller: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    subtotal: { type: Number, required: true, default: 0 }, // this seller's buyer-facing subtotal in this order
    transactionFee: { type: Number, required: true, default: 0 },
    tier: {
      id: { type: Schema.Types.ObjectId, ref: 'TransactionFeeTier', default: null },
      amountFrom: { type: Number, default: null },
      amountTo: { type: Number, default: null },
      label: { type: String, default: '' },
    },
  },
  { _id: false }
);

const orderSchema = new Schema(
  {
    orderNumber: { type: String, unique: true, index: true },

    buyer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    items: { type: [orderItemSchema], required: true },
    totalAmount: { type: Number, required: true },

    deliveryFee: { type: Number, default: 0 },
        deliveryDetails: {
      transportFee: { type: Number, default: 0 },
      wholesaleDeliveryFee: { type: Number, default: 0 },
      notes: { type: [String], default: [] },

      // NEW — dynamic shipping breakdown snapshot (see utils/shippingFeeCalculator.js).
      // transportFee above IS the resolved calculateDynamicShippingFee() total
      // (normal-weight tier price + special-criteria fees) for every
      // non-heavy-wholesale line in this order. These extra fields just keep
      // the human-readable "why" alongside it for admin/support/email use.
      normalWeightTotalKg: { type: Number, default: 0 },
      normalTierApplied: {
        id: { type: Schema.Types.ObjectId, default: null },
        label: { type: String, default: '' },
        weightFrom: { type: Number, default: null },
        weightTo: { type: Number, default: null },
        price: { type: Number, default: 0 },
      },
      specialShippingBreakdown: {
        type: [
          {
            productId: { type: Schema.Types.ObjectId, ref: 'Product' },
            productName: String,
            criteriaName: String,
            optionLabel: String,
            unitPrice: Number,
            quantity: Number,
            lineTotal: Number,
          },
        ],
        default: [],
      },
    },

    shippingAddress: {
      fullName: String,
      phone: String,
      address: String,
      city: String,
      notes: String,
    },

    // --- Payment method: how this order's payment is collected/verified ---
    // 'manual' = buyer pastes their M-Pesa SMS, admin verifies by eye (original flow).
    // 'stk'    = PayHero STK Push, PayHero's webhook verifies automatically.
    paymentMethod: { type: String, enum: ['manual', 'stk'], default: 'manual' },

    // --- M-Pesa confirmation ---
    // Required for 'manual' orders only. STK orders start with this empty and
    // it gets filled in automatically (as a receipt-number summary string) the
    // moment the PayHero webhook confirms payment — see paymentController.js.
    mpesaMessage: {
      type: String,
      default: '',
      required: function () {
        return this.paymentMethod !== 'stk';
      },
    },
    mpesaCode: { type: String, default: '' }, // parsed (manual) or PayHero MpesaReceiptNumber (stk)
    paymentStatus: {
      type: String,
      enum: ['pending_verification', 'confirmed', 'rejected'],
      default: 'pending_verification',
      index: true,
    },
    verifiedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null }, // null for STK = system-verified, not an admin
    verifiedAt: { type: Date, default: null },
    // Why payment didn't go through — set by admin (manual reject) or by the
    // STK failure callback (wrong PIN, cancelled, timed out, etc).
    rejectionReason: { type: String, default: '' },

    // --- STK Push tracking — only meaningful when paymentMethod === 'stk' ---
    // Full attempt history lives in the Payment collection (models/Payment.js);
    // this is just a fast-read snapshot of the MOST RECENT attempt, so the
    // checkout page can poll a single lightweight endpoint instead of joining
    // against Payment on every poll.
    stk: {
      reference: { type: String, default: '' },        // PayHero's own reference
      checkoutRequestId: { type: String, default: '' }, // ws_CO_...
      status: { type: String, enum: ['', 'queued', 'success', 'failed'], default: '' },
      phone: { type: String, default: '' },
      lastAttemptAt: { type: Date, default: null },
      failureType: { type: String, default: '' }, // NEW — machine-readable reason for UI logic
    },

    orderStatus: {
      type: String,
      enum: ['processing', 'shipped', 'delivered', 'cancelled'],
      default: 'processing',
    },

    agent: { type: Schema.Types.ObjectId, ref: 'Agent', default: null, index: true },
    agentCode: { type: String, default: '' },
    commissionAmount: { type: Number, default: 0 },

    // Per-seller tiered transaction fees for this order — see sellerFeeSchema
    // above. One entry per distinct seller whose products appear in this
    // order, each fee resolved against that seller's own subtotal here.
    sellerFees: { type: [sellerFeeSchema], default: [] },
  },
  { timestamps: true }
);

// Auto-extract the M-Pesa transaction code from a pasted (manual) SMS only —
// STK orders get mpesaCode set directly from PayHero's MpesaReceiptNumber in
// the webhook handler, so this just no-ops for them (mpesaMessage is empty).
orderSchema.pre('validate', function (next) {
  if (this.mpesaMessage && !this.mpesaCode) {
    const match = this.mpesaMessage.match(/\b[A-Z0-9]{10}\b/);
    if (match) this.mpesaCode = match[0];
  }
  next();
});

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

orderSchema.virtual('totalCommission').get(function () {
  return (this.items || []).reduce((sum, i) => sum + (i.commissionAmount || 0), 0);
});

orderSchema.virtual('totalSellerPayout').get(function () {
  return (this.items || []).reduce((sum, i) => sum + (i.sellerPayout || 0), 0);
});

// Virtual: sum of every seller's transaction fee on this order (handy for a
// single "total fees charged on this order" figure in admin views).
orderSchema.virtual('totalTransactionFees').get(function () {
  return (this.sellerFees || []).reduce((sum, f) => sum + (f.transactionFee || 0), 0);
});

orderSchema.set('toJSON', { virtuals: true });
orderSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Order', orderSchema);