const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const { uploadVerificationDocs } = require('../middleware/uploadMiddleware');
const { getMyProfile, updateMyProfile } = require('../controllers/sellerProfileController');

router.get('/me', protect, authorize('wholesaler', 'retailer'), getMyProfile);
router.put('/me', protect, authorize('wholesaler', 'retailer'), uploadVerificationDocs, updateMyProfile);

module.exports = router;