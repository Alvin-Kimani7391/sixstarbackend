const mongoose = require('mongoose');
const { Schema } = mongoose;

const requirementsSchema = new Schema(
  {
    minBuyerReferrals: { type: Number, default: 0 },
    minSellerReferrals: { type: Number, default: 0 },
    minApprovedSellers: { type: Number, default: 0 },
    minMarketplaceProfit: { type: Number, default: 0 }, // KES, lifetime unless periodDays set
    minConfirmedCommission: { type: Number, default: 0 }, // KES
    periodDays: { type: Number, default: 0 }, // 0 = lifetime / all-time
  },
  { _id: false }
);

const agentBadgeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true }, // "Bronze", "Silver", "Gold"
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    color: { type: String, default: '#c9791f' }, // for UI chips
    commissionRate: { type: Number, required: true, min: 0, max: 100 }, // % of marketplace profit
    requirements: { type: requirementsSchema, default: () => ({}) },
    sortOrder: { type: Number, default: 0 }, // lowest -> highest tier
    isDefault: { type: Boolean, default: false }, // auto-assigned to newly approved agents
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Only one default badge at a time — whichever save sets isDefault:true wins.
agentBadgeSchema.pre('save', async function (next) {
  if (this.isDefault) {
    await this.constructor.updateMany({ _id: { $ne: this._id } }, { $set: { isDefault: false } });
  }
  next();
});

module.exports = mongoose.model('AgentBadge', agentBadgeSchema);