const mongoose = require('mongoose');
const { Schema } = mongoose;

// Records every view/download/share/favorite an agent performs on a
// MarketingAsset — this is the raw data Phase 6 analytics aggregates.
const marketingInteractionSchema = new Schema(
  {
    agent: { type: Schema.Types.ObjectId, ref: 'Agent', required: true, index: true },
    asset: { type: Schema.Types.ObjectId, ref: 'MarketingAsset', required: true, index: true },
    campaign: { type: Schema.Types.ObjectId, ref: 'Campaign', default: null },
    type: { type: String, enum: ['view', 'download', 'share', 'favorite', 'unfavorite'], required: true },
    channel: {
      type: String,
      enum: ['whatsapp', 'email', 'facebook', 'instagram', 'tiktok', 'linkedin', 'x', 'qr', 'direct', 'other'],
      default: 'direct',
    },
  },
  { timestamps: true }
);

marketingInteractionSchema.index({ asset: 1, type: 1, createdAt: -1 });
marketingInteractionSchema.index({ agent: 1, type: 1, createdAt: -1 });

module.exports = mongoose.model('MarketingInteraction', marketingInteractionSchema);