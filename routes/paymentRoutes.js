const express = require('express');
const router = express.Router();
const { initiateStkPush, handleCallback, checkPaymentStatus } = require('../controllers/paymentController');
const { protect, authorize } = require('../middleware/authMiddleware');

// Buyer-initiated — pushes the M-Pesa PIN prompt to their phone.
router.post('/initiate-stk', protect, authorize('buyer'), initiateStkPush);

// PayHero's own server calls this — intentionally NOT behind `protect`.
// PayHero has no way to send your app's auth cookie. Safety comes from
// idempotency + only trusting order state we already created ourselves
// (see handleCallback's "queued only" guard in paymentController.js).
router.post('/callback', handleCallback);

// Buyer polls this every few seconds while the STK prompt is on their phone.
router.get('/status/:orderId', protect, checkPaymentStatus);

module.exports = router;