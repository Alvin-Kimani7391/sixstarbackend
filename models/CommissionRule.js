const mongoose = require('mongoose');
const { Schema } = mongoose;

// Commission rules engine (spec §54) — admin configures rate by audience +
// badge instead of hard-coding percentages anywhere in code.
const commissionRuleSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    audience: { type: String, enum: ['buyer_referral', 'seller_referral'], required: true, index: true },
    // null = applies to every badge that doesn't have a more specific rule
    badge: { type: Schema.Types.ObjectId, ref: 'AgentBadge', default: null },
    commissionRate: { type: Number, required: true, min: 0, max: 100 },
    trigger: { type: String, enum: ['delivered'], default: 'delivered' },
    priority: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CommissionRule', commissionRuleSchema);