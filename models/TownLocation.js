const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * TownLocation
 * -------------------------------------------------------------------------
 * One row per deliverable town. Drives the checkout Region/Town dropdown
 * AND tells the order pipeline how to price + describe delivery for it.
 *
 * PRICING RULES (see orderController.createOrder):
 *  - isNairobi === true  -> the standard transport fee for the order is
 *    whatever the admin typed into nairobiManualFee for THIS town, instead
 *    of the normal weight-tier calculateDynamicShippingFee() result.
 *  - isNairobi === false -> transport fee is ALWAYS the normal dynamic
 *    weight-tier system, exactly as before this feature existed. This is
 *    true whether or not the town has a pickup station.
 *  - hasPickupStation/pickupStationAddress NEVER change the fee outside
 *    Nairobi — they only add an informational pickup note to the checkout
 *    preview, the saved order, admin views, and order emails.
 *  - A town with hasPickupStation === false behaves exactly like the
 *    system did before this feature existed ("Town — transport charged").
 */
const townLocationSchema = new Schema(
  {
    county: { type: String, required: true, trim: true },
    town: { type: String, required: true, trim: true },

    isNairobi: { type: Boolean, default: false },
    // Only meaningful/editable when isNairobi is true. Flat KSh fee the
    // admin sets by hand for this specific Nairobi town — replaces the
    // dynamic weight-tier quote entirely for standard-delivery items.
    nairobiManualFee: { type: Number, default: 0, min: 0 },

    // Estimated delivery window shown in the checkout preview — the same
    // role the old hardcoded DELIVERY_DATA.deliveryDays played.
    deliveryDays: { type: Number, default: 2, min: 1 },

    hasPickupStation: { type: Boolean, default: false },
    pickupStationAddress: { type: String, default: '', trim: true },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

townLocationSchema.index({ county: 1, town: 1 }, { unique: true });

// Keep data honest: a town that isn't flagged as having a pickup station
// shouldn't carry a stale address around, and a non-Nairobi town shouldn't
// carry a stale manual fee that someone might mistake for being live.
townLocationSchema.pre('save', function (next) {
  if (!this.hasPickupStation) this.pickupStationAddress = '';
  if (!this.isNairobi) this.nairobiManualFee = 0;
  next();
});

module.exports = mongoose.model('TownLocation', townLocationSchema);