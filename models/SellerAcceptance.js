const mongoose = require('mongoose');
const { Schema } = mongoose;

const sellerAcceptanceSchema = new Schema(
  {
    seller: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    document: { type: Schema.Types.ObjectId, ref: 'LegalDocument', required: true },
    documentType: { type: String, required: true },
    version: { type: String, required: true },
    acceptedAt: { type: Date, default: Date.now },
    ipAddress: String,
    userAgent: String,
  },
  { timestamps: true }
);

// One acceptance per seller per document — resubmitting a form doesn't duplicate it.
sellerAcceptanceSchema.index({ seller: 1, document: 1 }, { unique: true });

module.exports = mongoose.model('SellerAcceptance', sellerAcceptanceSchema);