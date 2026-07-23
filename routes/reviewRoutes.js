const express = require('express');
const router = express.Router();
const { deleteReview } = require('../controllers/reviewController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.delete('/:id', protect, authorize('buyer'), deleteReview);

module.exports = router;
