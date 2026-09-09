const mongoose = require('mongoose');
const { Schema } = mongoose;

const fraudEventSchema = new Schema(
  {
    agent: { type: Schema.Types.ObjectId, ref: 'Agent', default: null, index: true },
    type: {
      type: String,
      enum: ['self_referral', 'duplicate_account', 'suspicious_click', 'repeated_cancellation', 'commission_manipulation', 'other'],
      required: true,
    },
    description: { type: String, default: '' },
    relatedOrder: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
    relatedCommission: { type: Schema.Types.ObjectId, ref: 'Commission', default: null },
    severity: { type: String, enum: ['low', 'medium', 'high'], default: 'low' },
    status: { type: String, enum: ['open', 'reviewed', 'dismissed'], default: 'open', index: true },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('FraudEvent', fraudEventSchema);