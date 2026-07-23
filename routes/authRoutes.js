const express = require('express');
const router = express.Router();
const { registerUser, loginUser, logoutUser, getMe, updateMe } = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/logout', protect, logoutUser);
router.get('/me', protect, getMe);
router.put('/me', protect, updateMe);

module.exports = router;
