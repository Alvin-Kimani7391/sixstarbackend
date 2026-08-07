const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  registerUser,
  loginUser,
  verifyLoginOtp,
  resendLoginOtp,
  googleAuth,
  forgotPassword,
  resetPassword,
  logoutUser,
  getMe,
  updateMe,
} = require('../controllers/authController');
const { sendEmailOtp, verifyEmailOtp } = require('../controllers/emailVerificationController');

router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/login/verify-otp', verifyLoginOtp);
router.post('/login/resend-otp', resendLoginOtp);
router.post('/google', googleAuth);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password/:token', resetPassword);
router.post('/logout', protect, logoutUser);
router.get('/me', protect, getMe);
router.put('/me', protect, updateMe);

// ---- Email verification (buyers + sellers — anyone who registered locally) ----
router.post('/email/send-code', protect, sendEmailOtp);
router.post('/email/verify-code', protect, verifyEmailOtp);

module.exports = router;