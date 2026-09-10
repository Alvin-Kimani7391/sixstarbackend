const mongoose = require('mongoose');
const crypto = require('crypto');
const { Schema } = mongoose;

// One row per (campaign, recipient) — powers open/click tracking and lets
// the admin see exactly who got a given campaign and what they did with it.
const emailSendLogSchema = new Schema(
  {
    campaign: { type: Schema.Types.ObjectId, ref: 'EmailCampaign', required: true, index: true },
    subscriber: { type: Schema.Types.ObjectId, ref: 'EmailSubscriber', required: true, index: true },
    email: { type: String, required: true }, // snapshot, in case the subscriber record changes later

    status: {
      type: String,
      enum: ['queued', 'sent', 'failed', 'opened', 'clicked'],
      default: 'queued',
      index: true,
    },
    error: { type: String, default: '' },

    // Used by the 1x1 open-tracking pixel and the click-redirect route —
    // unique per send so we can't be spoofed into crediting the wrong email.
    trackingToken: { type: String, unique: true, default: () => crypto.randomBytes(16).toString('hex') },

    sentAt: { type: Date, default: null },
    openedAt: { type: Date, default: null },
    clickedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

emailSendLogSchema.index({ campaign: 1, status: 1 });

module.exports = mongoose.model('EmailSendLog', emailSendLogSchema);