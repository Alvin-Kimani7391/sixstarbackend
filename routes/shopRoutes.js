const express = require('express');
const router = express.Router();
const {
  createShop,
  getMyShop,
  updateMyShop,
  getPendingShops,
  approveShop,
  rejectShop,
  suspendShop,
} = require('../controllers/shopController');
const { protect, authorize } = require('../middleware/authMiddleware');

// ---------------- Seller ----------------
router.post('/', protect, authorize('wholesaler', 'retailer'), createShop);
router.get('/my-shop', protect, authorize('wholesaler', 'retailer'), getMyShop);
router.put('/my-shop', protect, authorize('wholesaler', 'retailer'), updateMyShop);

// ---------------- Admin ----------------
// Namespaced under /admin here (rather than living in adminRoutes.js) so the
// whole Shop feature stays self-contained in one route file.
router.get('/admin/pending', protect, authorize('admin'), getPendingShops);
router.patch('/admin/:id/approve', protect, authorize('admin'), approveShop);
router.patch('/admin/:id/reject', protect, authorize('admin'), rejectShop);
router.patch('/admin/:id/suspend', protect, authorize('admin'), suspendShop);

module.exports = router;