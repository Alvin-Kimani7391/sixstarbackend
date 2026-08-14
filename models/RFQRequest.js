const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * RFQ Request (Request for Quote)
 * Buyer posts a structured request; sellers submit private bids on it.
 * See: Six Star Suppliers — RFQ, Bidding & Private Chat feature report.
 */
const rfqRequestSchema = new Schema(
  {
    buyer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    productName: { type: String, required: [true, 'Product name is required'], trim: true },
    productImage: { type: String, default: '' }, // Cloudinary secure_url
    category: { type: Schema.Types.ObjectId, ref: 'Category' },

    quantity: { type: Number, required: [true, 'Quantity is required'], min: 1 },
    unit: { type: String, required: [true, 'Unit of measurement is required'], trim: true }, // e.g. "pairs", "kg", "cartons"

    minBudget: { type: Number, required: true, min: 0 },
    maxBudget: { type: Number, required: true, min: 0 },
    budgetType: { type: String, enum: ['per_unit', 'total'], default: 'per_unit' },

    location: { type: String, required: [true, 'Location is required'], trim: true },
    deliveryRequired: { type: Boolean, default: true },
    deliveryBudget: { type: Number, default: 0 },

    requiredDate: { type: Date, required: [true, 'Required-by date is required'] },
    description: { type: String, required: [true, 'Description is required'], trim: true, maxlength: 2000 },

    status: {
      type: String,
      enum: ['OPEN', 'BIDDING', 'SELLER_SELECTED', 'CLOSED', 'EXPIRED', 'CANCELLED'],
      default: 'OPEN',
      index: true,
    },

    // Denormalized so the public list never has to run a bid-count aggregate
    // on every page load. Kept in sync from rfqBidController.
    bidCount: { type: Number, default: 0 },

    expiresAt: { type: Date, required: true, index: true },
    // Guards against the deadline-reminder email going out more than once
    // per RFQ — see utils/rfqScheduler.js.
    deadlineReminderSentAt: { type: Date },

    selectedSeller: { type: Schema.Types.ObjectId, ref: 'User' },
    selectedBid: { type: Schema.Types.ObjectId, ref: 'RFQBid' },

    closedAt: { type: Date },
    cancelReason: { type: String },

    // --- Admin monitoring (report section 16/17) ---
    isSuspended: { type: Boolean, default: false },
    suspendReason: { type: String },
    flaggedForReview: { type: Boolean, default: false },
  },
  { timestamps: true }
);

rfqRequestSchema.index({ status: 1, expiresAt: 1 });
rfqRequestSchema.index({ productName: 'text', description: 'text' });

// Buyer identity must NEVER leak on the public RFQ feed (report section 12).
// Controllers should already .select() carefully, but this method is a
// safety net for anywhere a raw document might get serialized to a public
// response — it deliberately omits `buyer` entirely.
rfqRequestSchema.methods.toPublicJSON = function () {
  return {
    _id: this._id,
    productName: this.productName,
    productImage: this.productImage,
    category: this.category,
    quantity: this.quantity,
    unit: this.unit,
    minBudget: this.minBudget,
    maxBudget: this.maxBudget,
    budgetType: this.budgetType,
    location: this.location,
    deliveryRequired: this.deliveryRequired,
    deliveryBudget: this.deliveryBudget,
    requiredDate: this.requiredDate,
    description: this.description,
    status: this.status,
    bidCount: this.bidCount,
    expiresAt: this.expiresAt,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('RFQRequest', rfqRequestSchema);