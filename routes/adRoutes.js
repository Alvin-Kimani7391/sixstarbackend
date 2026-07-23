const express = require('express');
const router = express.Router();
const { getActiveAds, createAd, updateAd, deleteAd, trackAdClick } = require('../controllers/adController');
const { protect, authorize } = require('../middleware/authMiddleware');
const { uploadSingleImage } = require('../middleware/uploadMiddleware');

router.get('/', getActiveAds);
router.patch('/:id/click', trackAdClick);
router.post('/', protect, authorize('admin'), uploadSingleImage, createAd);
router.put('/:id', protect, authorize('admin'), uploadSingleImage, updateAd);
router.delete('/:id', protect, authorize('admin'), deleteAd);

module.exports = router;
