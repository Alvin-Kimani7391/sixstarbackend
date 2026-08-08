/* ============================================================
   SIX STAR SUPPLIERS — Flash Sale model
   ============================================================
   Kept as its own collection (rather than fields bolted onto
   Product) so that:
     - a product can have a full history of past Flash Sale runs
     - the review/approval pipeline (pending -> approved/rejected
       -> scheduled -> active -> ended/sold_out) doesn't clutter
       the Product schema
     - the daily 2:00 PM - midnight window is queryable directly

   Lifecycle:
     pending_review  -> seller just submitted, awaiting admin
     approved        -> admin approved, will flip to 'scheduled'
                        (or straight to 'active'/'ended' if the
                        window has already started/passed by the
                        time of approval)
     scheduled       -> approved, startAt is still in the future
     active          -> current time is inside [startAt, endAt]
     sold_out        -> stockSold reached stockAllocated early
     ended           -> endAt has passed (midnight hit)
     rejected        -> admin rejected with a reason
     cancelled       -> seller cancelled before it went active

   scheduled -> active -> ended/sold_out transitions are kept in
   sync by utils/flashSaleScheduler.js (a lightweight interval,
   no extra npm dependency needed) AND are re-derived defensively
   inside getActiveFlashSales() so the public storefront is
   correct even between scheduler ticks.
   ============================================================ */

const mongoose = require('mongoose');
const { Schema } = mongoose;

const FLASH_SALE_STATUSES = [
  'pending_review',
  'approved',
  'scheduled',
  'active',
  'sold_out',
  'ended',
  'rejected',
  'cancelled',
];

const flashSaleSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    seller: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    // Snapshot of the seller's normal selling price at submission time, so the
    // discount stays meaningful even if the seller edits their price later.
    originalPrice: { type: Number, required: true, min: 0 },
    flashSalePrice: { type: Number, required: true, min: 0 },
    discountPercent: { type: Number, required: true, min: 1, max: 99 },

    // Flash Sale stock is its own pool, separate from the product's regular
    // stock counter, so the seller can cap exactly how many units are sold at
    // the discounted price.
    stockAllocated: { type: Number, required: true, min: 1 },
    stockSold: { type: Number, default: 0, min: 0 },

    // saleDate = midnight of the calendar day the sale runs on.
    // startAt   = 2:00 PM that same day.
    // endAt     = 11:59:59.999 PM that same day (midnight).
    saleDate: { type: Date, required: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },

    status: {
      type: String,
      enum: FLASH_SALE_STATUSES,
      default: 'pending_review',
      index: true,
    },

    rejectionReason: { type: String, default: '' },
    submittedAt: { type: Date, default: Date.now },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
  },
  { timestamps: true }
);

// Fast lookups for the scheduler + public storefront query.
flashSaleSchema.index({ status: 1, startAt: 1, endAt: 1 });
flashSaleSchema.index({ product: 1, status: 1 });
flashSaleSchema.index({ seller: 1, createdAt: -1 });

flashSaleSchema.virtual('remainingStock').get(function () {
  return Math.max(0, (this.stockAllocated || 0) - (this.stockSold || 0));
});

flashSaleSchema.set('toJSON', { virtuals: true });
flashSaleSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('FlashSale', flashSaleSchema);
module.exports.FLASH_SALE_STATUSES = FLASH_SALE_STATUSES;