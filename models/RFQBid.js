const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * A seller's private offer against one RFQRequest.
 * Only the buyer and the bidding seller can ever see a given bid — the
 * public RFQ feed only ever shows the aggregate `bidCount` on the parent
 * RFQRequest, never this document.
 */
const rfqBidSchema = new Schema(
  {
    rfq: { type: Schema.Types.ObjectId, ref: 'RFQRequest', required: true, index: true },
    seller: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    unitPrice: { type: Number, required: [true, 'Unit price is required'], min: 0 },
    quantityAvailable: { type: Number, required: [true, 'Quantity available is required'], min: 1 },
    deliveryFee: { type: Number, default: 0 },
    deliveryTime: { type: String, trim: true }, // free text, e.g. "3 days"
    offerValidUntil: { type: Date },

    // Free-text note from the seller. Always passed through the contact
    // moderation filter before being saved — see utils/rfqModeration.js.
    // What's stored here is already the SAFE, masked version.
    message: { type: String, trim: true, maxlength: 1000, default: '' },
    messageFlagged: { type: Boolean, default: false },

    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected', 'withdrawn'],
      default: 'pending',
      index: true,
    },
  },
  { timestamps: true }
);

// One active bid per seller per RFQ. Sellers UPDATE their existing bid
// rather than stacking duplicates — this is what the report calls "a
// seller updates an offer" (section 4 / 10).
rfqBidSchema.index({ rfq: 1, seller: 1 }, { unique: true });

module.exports = mongoose.model('RFQBid', rfqBidSchema);