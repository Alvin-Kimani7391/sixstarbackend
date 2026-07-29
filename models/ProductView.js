const mongoose = require('mongoose');
const { Schema } = mongoose;

/* ============================================================
   PRODUCT VIEW LOG
   One document per product-detail-page view. Kept separate from
   Product itself (which just holds a running `viewCount` total)
   so we can build a day-by-day trend chart for the seller
   analytics dashboard without bloating the product document.

   Written best-effort (fire-and-forget) from
   trackProductViewCount in productController.js — a failure here
   should never block or fail the page view itself.
   ============================================================ */

const productViewSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    seller: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    viewer: { type: Schema.Types.ObjectId, ref: 'User', default: null }, // null for guests
    viewedAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

productViewSchema.index({ product: 1, viewedAt: -1 });
productViewSchema.index({ seller: 1, viewedAt: -1 });

// Auto-expire raw view logs after 90 days — the running Product.viewCount total
// keeps the lifetime number forever, this collection only needs to cover the
// dashboard's rolling trend window.
productViewSchema.index({ viewedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

module.exports = mongoose.model('ProductView', productViewSchema);