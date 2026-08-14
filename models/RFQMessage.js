const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * A single chat message inside a private buyer<->seller conversation on
 * one RFQ. Each seller who has bid on an RFQ has their OWN private thread
 * with the buyer — sellers never see each other's threads (report section 5).
 */
const rfqMessageSchema = new Schema(
  {
    rfq: { type: Schema.Types.ObjectId, ref: 'RFQRequest', required: true, index: true },
    sender: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    receiver: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    messageType: { type: String, enum: ['text', 'image', 'system'], default: 'text' },

    // This is always the SAFE-TO-DISPLAY text — if contact info was
    // detected, it has already been masked before this document is ever
    // saved. The raw original input is never persisted anywhere.
    message: { type: String, trim: true, maxlength: 2000 },

    // Cloudinary secure_url, only present when messageType === 'image'.
    imageUrl: { type: String },

    moderationAction: { type: String, enum: ['none', 'masked', 'blocked'], default: 'none' },
    moderationFlags: [{ type: String }], // e.g. ['phone_number', 'whatsapp']

    read: { type: Boolean, default: false },
    readAt: { type: Date },
  },
  { timestamps: true }
);

// Powers the in-RFQ chat thread (chronological within one rfq+pair)...
rfqMessageSchema.index({ rfq: 1, createdAt: 1 });
// ...and the "recent messages" widget on the profile page, which needs the
// latest messages across ALL of a user's RFQ threads regardless of which
// RFQ they belong to.
rfqMessageSchema.index({ sender: 1, createdAt: -1 });
rfqMessageSchema.index({ receiver: 1, createdAt: -1 });

module.exports = mongoose.model('RFQMessage', rfqMessageSchema);