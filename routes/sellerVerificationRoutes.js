const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { uploadVerificationDocs } = require('../middleware/uploadMiddleware');
const { getMyVerification, submitVerification } = require('../controllers/sellerVerificationController');

router.get('/me', protect, getMyVerification);
router.post('/', protect, uploadVerificationDocs, submitVerification);

module.exports = router;