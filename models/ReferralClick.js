const mongoose = require('mongoose');
const { Schema } = mongoose;

// Foundation for the full attribution chain (spec section 78). Phase 2-4
// will start populating targetId/targetModel (product/category/campaign)
// and convertedUser once Marketing Center + Recruitment exist — this model
// is built to hold that from day one so nothing has to be migrated later.
const referralClickSchema = new Schema(
  {
    agent: { type: Schema.Types.ObjectId, ref: 'Agent', required: true, index: true },
    agentCode: { type: String, required: true }, // snapshot, survives agent edits

    type: {
      type: String,
      enum: ['general', 'buyer', 'seller', 'product', 'category', 'campaign', 'agent_profile'],
      default: 'general',
    },
    targetId: { type: Schema.Types.ObjectId, default: null },
    targetModel: { type: String, default: '' }, // 'Product' | 'Category' | 'Campaign'

    channel: {
      type: String,
      enum: ['whatsapp', 'email', 'facebook', 'instagram', 'tiktok', 'linkedin', 'x', 'qr', 'direct', 'other'],
      default: 'direct',
    },

    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    referer: { type: String, default: '' },

    // Filled in later if this click leads to a registration
    convertedUser: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    convertedUserRole: { type: String, default: '' },
    convertedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

referralClickSchema.index({ agent: 1, createdAt: -1 });

module.exports = mongoose.model('ReferralClick', referralClickSchema);