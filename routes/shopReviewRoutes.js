const express = require('express');
const router = express.Router();
const { deleteShopReview } = require('../controllers/shopReviewController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.delete('/:id', protect, authorize('buyer'), deleteShopReview);

module.exports = router;