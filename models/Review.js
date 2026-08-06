const mongoose = require('mongoose');
const { Schema } = mongoose;
const Product = require('./Product');

const reviewSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    buyer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true, maxlength: 1000 },
  },
  { timestamps: true }
);

// One review per buyer per product
reviewSchema.index({ product: 1, buyer: 1 }, { unique: true });

// Recalculate the product's average rating + count whenever a review is saved
reviewSchema.statics.recalculateProductRating = async function (productId) {
  const stats = await this.aggregate([
    { $match: { product: productId } },
    {
      $group: {
        _id: '$product',
        avgRating: { $avg: '$rating' },
        numRatings: { $sum: 1 },
      },
    },
  ]);

  if (stats.length > 0) {
    await Product.findByIdAndUpdate(productId, {
      ratingsAverage: Math.round(stats[0].avgRating * 10) / 10, // 1 decimal place
      ratingsCount: stats[0].numRatings,
    });
  } else {
    await Product.findByIdAndUpdate(productId, { ratingsAverage: 0, ratingsCount: 0 });
  }
};

// IMPORTANT: must be async + awaited, otherwise Mongoose doesn't wait for the
// recalculation to finish before create()/save() resolves in the controller —
// the API response (and any immediate re-fetch from the client) can race
// ahead of the updated ratingsAverage/ratingsCount actually being persisted.
reviewSchema.post('save', async function () {
  await this.constructor.recalculateProductRating(this.product);
});

// Also recalc after updates/deletes done via findOneAndX
reviewSchema.post(/findOneAnd/, async function (doc) {
  if (doc) await doc.constructor.recalculateProductRating(doc.product);
});

module.exports = mongoose.model('Review', reviewSchema);