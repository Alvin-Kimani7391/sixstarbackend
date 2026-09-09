const mongoose = require('mongoose');
const { Schema } = mongoose;

const campaignSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    targetAudience: { type: String, enum: ['buyer', 'seller', 'agent', 'everyone'], default: 'everyone' },
    status: { type: String, enum: ['draft', 'scheduled', 'active', 'ended', 'archived'], default: 'draft', index: true },
    isFeatured: { type: Boolean, default: false },
    // Empty array = every badge tier is eligible for this campaign.
    eligibleBadges: [{ type: Schema.Types.ObjectId, ref: 'AgentBadge' }],
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

campaignSchema.methods.computeStatus = function () {
  const now = new Date();
  if (this.status === 'archived') return 'archived';
  if (now < this.startDate) return 'scheduled';
  if (now > this.endDate) return 'ended';
  return 'active';
};

module.exports = mongoose.model('Campaign', campaignSchema);