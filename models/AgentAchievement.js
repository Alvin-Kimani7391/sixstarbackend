const mongoose = require('mongoose');
const { Schema } = mongoose;

const agentAchievementSchema = new Schema(
  {
    agent: { type: Schema.Types.ObjectId, ref: 'Agent', required: true, index: true },
    achievement: { type: Schema.Types.ObjectId, ref: 'Achievement', required: true },
    earnedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

agentAchievementSchema.index({ agent: 1, achievement: 1 }, { unique: true });

module.exports = mongoose.model('AgentAchievement', agentAchievementSchema);