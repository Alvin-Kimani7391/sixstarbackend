const express = require('express');
const router = express.Router();
const {
  getAllProductsAdmin,
  adminUpdateProduct,
  reactivateProduct,
  adminDeleteProduct,
  getAllOrdersAdmin,
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
const { getAllCategoriesAdmin } = require('../controllers/categoryController');
const { getAllAgentsAdmin } = require('../controllers/agentcontroller');
const { protect, authorize } = require('../middleware/authMiddleware');
const { uploadProductImages } = require('../middleware/uploadMiddleware');

// Every route here is admin-only
router.use(protect, authorize('admin'));

// Categories (full list including inactive)
router.get('/categories', getAllCategoriesAdmin);

// Agents (full list including inactive, with commission stats)
router.get('/agents', getAllAgentsAdmin);

// Full product oversight - the dashboard's main product table
router.get('/products', getAllProductsAdmin);
router.patch('/products/:id', uploadProductImages, adminUpdateProduct); // full field edit, incl. images
router.patch('/products/:id/reactivate', reactivateProduct);
router.delete('/products/:id', adminDeleteProduct);

// Product review/pricing gate
router.get('/products/pending', getPendingProducts);
router.patch('/products/:id/approve', approveProduct);
router.patch('/products/:id/reject', rejectProduct);
router.patch('/products/:id/price', updateProductPricing);
router.patch('/products/:id/suspend', suspendProduct);

// Full order oversight + M-Pesa manual payment verification
router.get('/orders', getAllOrdersAdmin);
router.get('/orders/pending-payment', getPendingPaymentOrders);
router.patch('/orders/:id/verify-payment', verifyOrderPayment);

// Ads (full list including inactive)
router.get('/ads', getAllAdsAdmin);

// User management (view + suspend/reactivate wholesalers, retailers, buyers)
router.get('/users', getAllUsers);
router.patch('/users/:id/status', setUserStatus);

module.exports = router;