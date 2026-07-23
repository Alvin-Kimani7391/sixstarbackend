const mongoose = require('mongoose');
const { Schema } = mongoose;

const orderItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    seller: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: String, // snapshot at time of purchase
    image: String,
    quantity: { type: Number, required: true, min: 1 },
    priceAtPurchase: { type: Number, required: true }, // snapshot of displayPrice
  },
  { _id: false }
);

const orderSchema = new Schema(
  {
    buyer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    items: { type: [orderItemSchema], required: true },
    totalAmount: { type: Number, required: true },

    shippingAddress: {
      fullName: String,
      phone: String,
      address: String,
      city: String,
      notes: String,
    },

    // --- M-Pesa manual confirmation ---
    mpesaMessage: { type: String, required: true }, // raw pasted confirmation SMS
    mpesaCode: { type: String, default: '' }, // parsed transaction code, e.g. "QWE1XYZ23"
    paymentStatus: {
      type: String,
      enum: ['pending_verification', 'confirmed', 'rejected'],
      default: 'pending_verification',
      index: true,
    },
    verifiedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    verifiedAt: { type: Date, default: null },

    orderStatus: {
      type: String,
      enum: ['processing', 'shipped', 'delivered', 'cancelled'],
      default: 'processing',
    },
  },
  { timestamps: true }
);

// Try to auto-extract the M-Pesa transaction code (e.g. "SFH3K2LMNO Confirmed...")
orderSchema.pre('validate', function (next) {
  if (this.mpesaMessage && !this.mpesaCode) {
    const match = this.mpesaMessage.match(/\b[A-Z0-9]{10}\b/);
    if (match) this.mpesaCode = match[0];
  }
  next();
});

module.exports = mongoose.model('Order', orderSchema);
