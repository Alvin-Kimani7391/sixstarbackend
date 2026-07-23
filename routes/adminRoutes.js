const express = require('express');
const router = express.Router();
const {
  getPendingProducts,
  approveProduct,
  rejectProduct,
  updateProductPricing,
  suspendProduct,
  getPendingPaymentOrders,
  verifyOrderPayment,
  getAllUsers,
  setUserStatus,
} = require('../controllers/adminController');
const { getAllAdsAdmin } = require('../controllers/adController');
const { protect, authorize } = require('../middleware/authMiddleware');

// Every route here is admin-only
router.use(protect, authorize('admin'));

// Product review/pricing gate
router.get('/products/pending', getPendingProducts);
router.patch('/products/:id/approve', approveProduct);
router.patch('/products/:id/reject', rejectProduct);
router.patch('/products/:id/price', updateProductPricing);
router.patch('/products/:id/suspend', suspendProduct);

// M-Pesa manual payment verification
router.get('/orders/pending-payment', getPendingPaymentOrders);
router.patch('/orders/:id/verify-payment', verifyOrderPayment);

// Ads (full list including inactive)
router.get('/ads', getAllAdsAdmin);

// User management
router.get('/users', getAllUsers);
router.patch('/users/:id/status', setUserStatus);

module.exports = router;
