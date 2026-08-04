const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { uploadVerificationDocs } = require('../middleware/uploadMiddleware');
const { getMyVerification, submitVerification } = require('../controllers/sellerVerificationController');
const { sendEmailOtp, verifyEmailOtp } = require('../controllers/emailVerificationController');

// ---- Email verification gate (must pass before documents can be submitted) ----
router.post('/email/send-code', protect, sendEmailOtp);
router.post('/email/verify-code', protect, verifyEmailOtp);

router.get('/me', protect, getMyVerification);
router.post('/', protect, uploadVerificationDocs, submitVerification);

module.exports = router;