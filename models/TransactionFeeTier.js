const mongoose = require('mongoose');
const { Schema } = mongoose;

// Admin-configurable tiered transaction-fee schedule, charged to the SELLER
// (not the buyer) on top of the marketplace commission, to cover payment
// processing costs (M-Pesa STK / PayHero fees scale with transaction size).
//
// Each tier is a flat KES fee for orders whose seller-subtotal (this seller's
// buyer-facing line-item total within ONE order — see resolveTransactionFee
// in transactionFeeController.js) falls within [amountFrom, amountTo].
// Leave amountTo null on the top tier to mean "and above", e.g.:
//   { amountFrom: 1,    amountTo: 49,   fee: 0 }
//   { amountFrom: 50,   amountTo: 499,  fee: 6 }
//   { amountFrom: 500,  amountTo: 999,  fee: 10 }
//   { amountFrom: 1000, amountTo: 1499, fee: 15 }
//   { amountFrom: 1500, amountTo: 2499, fee: 20 }
//   { amountFrom: 2500, amountTo: null, fee: 25 }   <- open-ended top tier
//
// Admin can add/edit/delete these any time via /api/admin/transaction-fees.
// Every new order re-resolves the fee against whichever tiers are active AT
// THE TIME the order is placed, and the exact tier + fee actually applied is
// snapshotted onto the order (Order.sellerFees) — so past orders/earnings
// never change retroactively when the admin edits the ladder later.
const transactionFeeTierSchema = new Schema(
  {
    amountFrom: { type: Number, required: true, min: 0 },
    amountTo: { type: Number, default: null, min: 0 }, // null = open-ended top tier
    fee: { type: Number, required: true, min: 0 },
    isActive: { type: Boolean, default: true },
    label: { type: String, default: '', trim: true }, // optional admin-facing note
  },
  { timestamps: true }
);

transactionFeeTierSchema.index({ amountFrom: 1 });

transactionFeeTierSchema.pre('validate', function (next) {
  if (this.amountTo != null && this.amountTo <= this.amountFrom) {
    return next(new Error('amountTo must be greater than amountFrom'));
  }
  next();
});

module.exports = mongoose.model('TransactionFeeTier', transactionFeeTierSchema);