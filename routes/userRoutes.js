const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getProfile,
  updateProfile,
  changePassword,
  getRecentlyViewed,
  trackProductView,
} = require('../controllers/userController');

router.get('/profile', protect, getProfile);
router.put('/profile', protect, updateProfile);
router.put('/change-password', protect, changePassword);
router.get('/recently-viewed', protect, getRecentlyViewed);
router.post('/recently-viewed/:productId', protect, trackProductView);

module.exports = router;