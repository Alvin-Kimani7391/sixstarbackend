const mongoose = require('mongoose');
const { Schema } = mongoose;

// ============================================================
// WEIGHT TIER — admin-managed ladder used to price shipping for every
// product whose category resolves to shippingType 'normal'.
//
// At checkout, ALL normal-shipping cart items (excluding wholesalers with
// their own 'heavy' transport terms) have their weightKg * quantity summed
// into a single total, and that total is matched against exactly one tier
// here to produce ONE flat fee for the whole bucket — not per item.
//
// Ranges must not overlap between active tiers. Leave weightTo blank on
// your top tier for an open-ended range (e.g. "20kg and above").
//
// Mirrors TransactionFeeTier's shape/validation pattern exactly.
// ============================================================
const weightTierSchema = new Schema(
  {
    weightFrom: { type: Number, required: true, min: 0 }, // kg, inclusive
    weightTo: { type: Number, default: null, min: 0 },    // kg, inclusive; null = open-ended top tier
    price: { type: Number, required: true, min: 0 },       // flat KSh charged for the whole order's normal-shipping weight falling in this band
    label: { type: String, default: '', trim: true },       // optional internal note, e.g. "Tier 1 - Light"
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

weightTierSchema.index({ weightFrom: 1 });
weightTierSchema.index({ isActive: 1 });

module.exports = mongoose.model('WeightTier', weightTierSchema);