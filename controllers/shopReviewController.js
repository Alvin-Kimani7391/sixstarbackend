const asyncHandler = require('express-async-handler');
const ShopReview = require('../models/ShopReview');
const Order = require('../models/Order');

// @desc    Buyer leaves a review + star rating on a shop they've bought from
// @route   POST /api/shops/:shopId/reviews
// @access  Private (buyer)
const createShopReview = asyncHandler(async (req, res) => {
  const { rating, comment } = req.body;
  const { shopId } = req.params;

  if (!rating || rating < 1 || rating > 5) {
    res.status(400);
    throw new Error('Rating must be between 1 and 5');
  }

  // Verify the buyer has at least one confirmed order containing a product from this shop.
  // Same purchase-gating pattern as reviewController.createReview, just checked
  // against product.shop instead of product._id directly.
  const orders = await Order.find({ buyer: req.user._id, paymentStatus: 'confirmed' })
    .populate({ path: 'items.product', select: 'shop' });

  const purchasedFromShop = orders.some((order) =>
    order.items.some((item) => item.product && String(item.product.shop) === String(shopId))
  );

  if (!purchasedFromShop) {
    res.status(403);
    throw new Error('You can only review shops you have bought from');
  }

  const existing = await ShopReview.findOne({ shop: shopId, buyer: req.user._id });
  if (existing) {
    res.status(400);
    throw new Error('You have already reviewed this shop');
  }

  const review = await ShopReview.create({
    shop: shopId,
    buyer: req.user._id,
    rating,
    comment,
  });

  res.status(201).json({ success: true, review });
});

// @desc    Get all reviews for a shop
// @route   GET /api/shops/:shopId/reviews
// @access  Public
const getShopReviews = asyncHandler(async (req, res) => {
  const reviews = await ShopReview.find({ shop: req.params.shopId })
    .populate('buyer', 'name avatar')
    .sort('-createdAt');

  res.json({ success: true, count: reviews.length, reviews });
});

// @desc    Buyer deletes their own shop review
// @route   DELETE /api/shop-reviews/:id
// @access  Private (owner only)
const deleteShopReview = asyncHandler(async (req, res) => {
  const review = await ShopReview.findById(req.params.id);
  if (!review) {
    res.status(404);
    throw new Error('Review not found');
  }
  if (review.buyer.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error('Not authorized');
  }

  await ShopReview.findOneAndDelete({ _id: req.params.id }); // triggers post(findOneAnd) rating recalculation
  res.json({ success: true, message: 'Review deleted' });
});

module.exports = { createShopReview, getShopReviews, deleteShopReview };