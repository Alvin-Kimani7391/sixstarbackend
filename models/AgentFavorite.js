const mongoose = require('mongoose');
const { Schema } = mongoose;

const agentFavoriteSchema = new Schema(
  {
    agent: { type: Schema.Types.ObjectId, ref: 'Agent', required: true, index: true },
    asset: { type: Schema.Types.ObjectId, ref: 'MarketingAsset', required: true },
  },
  { timestamps: true }
);

agentFavoriteSchema.index({ agent: 1, asset: 1 }, { unique: true });

module.exports = mongoose.model('AgentFavorite', agentFavoriteSchema);