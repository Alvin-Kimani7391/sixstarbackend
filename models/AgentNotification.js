const mongoose = require('mongoose');
const { Schema } = mongoose;

const agentNotificationSchema = new Schema(
  {
    agent: { type: Schema.Types.ObjectId, ref: 'Agent', required: true, index: true },
    type: { type: String, default: 'general' },
    title: { type: String, required: true },
    message: { type: String, required: true },
    link: { type: String, default: '' },
    isRead: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

agentNotificationSchema.index({ agent: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model('AgentNotification', agentNotificationSchema);