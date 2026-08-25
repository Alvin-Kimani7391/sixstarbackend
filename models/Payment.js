// models/Payment.js
//
// One document per STK Push attempt. Manual M-Pesa-SMS orders never create a
// Payment doc — that flow lives entirely on Order.mpesaMessage, unchanged.
// A buyer retrying a failed STK attempt on the same order creates a NEW
// Payment doc rather than mutating the old one, so you keep a full audit
// trail of every attempt against an order.

const mongoose = require('mongoose');
const { Schema } = mongoose;

const paymentSchema = new Schema(
  {
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    buyer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    provider: { type: String, default: 'payhero' },
    method: { type: String, enum: ['stk'], default: 'stk' },

    amount: { type: Number, required: true },
    phone: { type: String, required: true }, // number the STK prompt was pushed to

    // --- PayHero identifiers ---
    externalReference: { type: String, required: true, index: true }, // ours: Order.orderNumber
    payheroReference: { type: String, default: '', index: true },     // PayHero's "reference" from the initiate response
    checkoutRequestId: { type: String, default: '', index: true },    // ws_CO_... — matches the webhook back to this attempt
    merchantRequestId: { type: String, default: '' },

    status: {
      type: String,
      enum: ['queued', 'success', 'failed'],
      default: 'queued',
      index: true,
    },

    // --- Snapshot of PayHero's callback payload once it arrives ---
    resultCode: { type: Number, default: null },
    resultDesc: { type: String, default: '' },
    mpesaReceiptNumber: { type: String, default: '' },

    rawInitiateResponse: { type: Schema.Types.Mixed, default: null },
    failureType: { type: String, default: '' }, // 'wrong_pin' | 'insufficient_funds' | 'cancelled' | 'timeout' | ...
    rawCallbackPayload: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Payment', paymentSchema);