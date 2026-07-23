const express = require('express');
const router = express.Router();
const {
  createOrder,
  getMyOrders,
  getOrderById,
  getSellerOrders,
  updateOrderStatus,
} = require('../controllers/orderController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.post('/', protect, authorize('buyer'), createOrder);
router.get('/my-orders', protect, authorize('buyer'), getMyOrders);
router.get('/seller-orders', protect, authorize('wholesaler', 'retailer'), getSellerOrders);
router.get('/:id', protect, getOrderById);
router.patch('/:id/status', protect, authorize('wholesaler', 'retailer', 'admin'), updateOrderStatus);

module.exports = router;
