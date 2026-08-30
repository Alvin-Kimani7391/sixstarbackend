const express = require('express');
const router = express.Router();
const {
  createOrder,
  getMyOrders,
  trackOrderPublic,
  getOrderById,
  getSellerOrders,
  getMyEarnings,
  getMyEarningsTransactions,
  updateOrderStatus,
  cancelOrder,
} = require('../controllers/orderController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.post('/', protect, authorize('buyer'), createOrder);
router.get('/my-orders', protect, authorize('buyer'), getMyOrders);
router.get('/seller-orders', protect, authorize('wholesaler', 'retailer'), getSellerOrders);

// Seller earnings dashboard — static paths, MUST be declared before '/:id'.
router.get('/my-earnings', protect, authorize('wholesaler', 'retailer'), getMyEarnings);
router.get('/my-earnings/transactions', protect, authorize('wholesaler', 'retailer'), getMyEarningsTransactions);

// Public tracking - MUST come before '/:id' or Express would treat "track" as an :id value
router.get('/track', trackOrderPublic);

router.get('/:id', protect, getOrderById);
router.patch('/:id/status', protect, authorize('wholesaler', 'retailer', 'admin'), updateOrderStatus);
router.patch('/:id/cancel', protect, cancelOrder);

module.exports = router;