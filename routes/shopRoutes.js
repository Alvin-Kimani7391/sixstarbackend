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
  getAllShopsAdmin,
  reactivateShop,
  setShopVerification,
  setShopFeatured,
  adminUpdateShop,
  adminDeleteShop,
  toggleMyShopActive,
  getPublicShops,
     getShopBySlug,
} = require('../controllers/shopController');
const { protect, authorize } = require('../middleware/authMiddleware');
const { uploadShopImages } = require('../middleware/uploadMiddleware');

// ---------------- Seller ----------------
// uploadShopImages parses multipart/form-data (logo + banner files, up to one
// each) and streams them straight to Cloudinary via the shop storage config.
// If the request isn't multipart (e.g. the Settings tab's plain JSON PUT),
// multer just passes through without touching req.body/req.files.
router.post('/', protect, authorize('wholesaler', 'retailer'), uploadShopImages, createShop);
router.get('/my-shop', protect, authorize('wholesaler', 'retailer'), getMyShop);
router.put('/my-shop', protect, authorize('wholesaler', 'retailer'), uploadShopImages, updateMyShop);

// ---------------- Admin ----------------
// Namespaced under /admin here (rather than living in adminRoutes.js) so the
// whole Shop feature stays self-contained in one route file.
router.get('/admin', protect, authorize('admin'), getAllShopsAdmin); // full table, any status/search
router.get('/admin/pending', protect, authorize('admin'), getPendingShops);

router.patch('/my-shop/toggle-active', protect, authorize('wholesaler', 'retailer'), toggleMyShopActive);

router.patch('/admin/:id/approve', protect, authorize('admin'), approveShop);
router.patch('/admin/:id/reject', protect, authorize('admin'), rejectShop);
router.patch('/admin/:id/suspend', protect, authorize('admin'), suspendShop);
router.patch('/admin/:id/reactivate', protect, authorize('admin'), reactivateShop);
router.patch('/admin/:id/verify', protect, authorize('admin'), setShopVerification);
router.patch('/admin/:id/feature', protect, authorize('admin'), setShopFeatured);
router.patch('/admin/:id', protect, authorize('admin'), uploadShopImages, adminUpdateShop);
router.delete('/admin/:id', protect, authorize('admin'), adminDeleteShop);
router.get('/', getPublicShops);       // GET /api/shops
router.get('/:slug', getShopBySlug);   // GET /api/shops/:slug


module.exports = router;