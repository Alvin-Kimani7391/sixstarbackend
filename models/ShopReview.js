const mongoose = require('mongoose');
const { Schema } = mongoose;
const Shop = require('./Shop');

const shopReviewSchema = new Schema(
  {
    shop: { type: Schema.Types.ObjectId, ref: 'Shop', required: true, index: true },
    buyer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true, maxlength: 1000 },
  },
  { timestamps: true }
);

// One review per buyer per shop
shopReviewSchema.index({ shop: 1, buyer: 1 }, { unique: true });

// Recalculate the shop's average rating + count whenever a review is saved
shopReviewSchema.statics.recalculateShopRating = async function (shopId) {
  const stats = await this.aggregate([
    { $match: { shop: shopId } },
    {
      $group: {
        _id: '$shop',
        avgRating: { $avg: '$rating' },
        numRatings: { $sum: 1 },
      },
    },
  ]);

  if (stats.length > 0) {
    await Shop.findByIdAndUpdate(shopId, {
      ratingsAverage: Math.round(stats[0].avgRating * 10) / 10, // 1 decimal place
      ratingsCount: stats[0].numRatings,
    });
  } else {
    await Shop.findByIdAndUpdate(shopId, { ratingsAverage: 0, ratingsCount: 0 });
  }
};

shopReviewSchema.post('save', function () {
  this.constructor.recalculateShopRating(this.shop);
});

// Also recalc after updates/deletes done via findOneAndX
shopReviewSchema.post(/findOneAnd/, async function (doc) {
  if (doc) await doc.constructor.recalculateShopRating(doc.shop);
});

module.exports = mongoose.model('ShopReview', shopReviewSchema);