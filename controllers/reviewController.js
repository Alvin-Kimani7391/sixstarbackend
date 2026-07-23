const asyncHandler = require('express-async-handler');
const Review = require('../models/Review');
const Order = require('../models/Order');

// @desc    Buyer leaves a review + star rating on a product they purchased
// @route   POST /api/products/:productId/reviews
// @access  Private (buyer)
const createReview = asyncHandler(async (req, res) => {
  const { rating, comment } = req.body;
  const { productId } = req.params;

  if (!rating || rating < 1 || rating > 5) {
    res.status(400);
    throw new Error('Rating must be between 1 and 5');
  }

  // Verify the buyer actually purchased this product (confirmed order) before allowing a review
  const purchased = await Order.exists({
    buyer: req.user._id,
    paymentStatus: 'confirmed',
    'items.product': productId,
  });

  if (!purchased) {
    res.status(403);
    throw new Error('You can only review products you have purchased');
  }

  const existing = await Review.findOne({ product: productId, buyer: req.user._id });
  if (existing) {
    res.status(400);
    throw new Error('You have already reviewed this product');
  }

  const review = await Review.create({
    product: productId,
    buyer: req.user._id,
    rating,
    comment,
  });

  res.status(201).json({ success: true, review });
});

// @desc    Get all reviews for a product
// @route   GET /api/products/:productId/reviews
// @access  Public
const getProductReviews = asyncHandler(async (req, res) => {
  const reviews = await Review.find({ product: req.params.productId })
    .populate('buyer', 'name avatar')
    .sort('-createdAt');

  res.json({ success: true, count: reviews.length, reviews });
});

// @desc    Buyer deletes their own review
// @route   DELETE /api/reviews/:id
// @access  Private (owner only)
const deleteReview = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id);
  if (!review) {
    res.status(404);
    throw new Error('Review not found');
  }
  if (review.buyer.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error('Not authorized');
  }

  await Review.findOneAndDelete({ _id: req.params.id }); // triggers post(findOneAnd) rating recalculation
  res.json({ success: true, message: 'Review deleted' });
});

module.exports = { createReview, getProductReviews, deleteReview };
