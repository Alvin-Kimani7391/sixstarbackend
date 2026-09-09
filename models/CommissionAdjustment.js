const mongoose = require('mongoose');
const { Schema } = mongoose;

// Manual admin corrections/bonuses (spec §69) — always additive to the
// ledger, never edits a Commission doc directly.
const commissionAdjustmentSchema = new Schema(
  {
    agent: { type: Schema.Types.ObjectId, ref: 'Agent', required: true, index: true },
    amount: { type: Number, required: true }, // can be negative
    reason: { type: String, required: true },
    addedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    relatedCommission: { type: Schema.Types.ObjectId, ref: 'Commission', default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CommissionAdjustment', commissionAdjustmentSchema);