const express = require('express');
const router = express.Router();
const {
  createShop,
  getMyShop,
  updateMyShop,
  uploadShopThemeImage,
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
const { createShopReview, getShopReviews } = require('../controllers/shopReviewController');
const { protect, authorize } = require('../middleware/authMiddleware');
const { uploadShopImages, uploadThemeImage } = require('../middleware/uploadMiddleware');

// ---------------- Seller ----------------
router.post('/', protect, authorize('wholesaler', 'retailer'), uploadShopImages, createShop);
router.get('/my-shop', protect, authorize('wholesaler', 'retailer'), getMyShop);
router.put('/my-shop', protect, authorize('wholesaler', 'retailer'), uploadShopImages, updateMyShop);

// NEW — one-off image upload for the storefront customizer (hero slides etc).
// Must be declared before any other '/my-shop/:something' style route so it
// isn't accidentally shadowed.
router.post(
  '/my-shop/theme-image',
  protect,
  authorize('wholesaler', 'retailer'),
  uploadThemeImage,
  uploadShopThemeImage
);

router.patch('/my-shop/toggle-active', protect, authorize('wholesaler', 'retailer'), toggleMyShopActive);

// ---------------- Admin ----------------
router.get('/admin', protect, authorize('admin'), getAllShopsAdmin);
router.get('/admin/pending', protect, authorize('admin'), getPendingShops);

router.patch('/admin/:id/approve', protect, authorize('admin'), approveShop);
router.patch('/admin/:id/reject', protect, authorize('admin'), rejectShop);
router.patch('/admin/:id/suspend', protect, authorize('admin'), suspendShop);
router.patch('/admin/:id/reactivate', protect, authorize('admin'), reactivateShop);
router.patch('/admin/:id/verify', protect, authorize('admin'), setShopVerification);
router.patch('/admin/:id/feature', protect, authorize('admin'), setShopFeatured);
router.patch('/admin/:id', protect, authorize('admin'), uploadShopImages, adminUpdateShop);
router.delete('/admin/:id', protect, authorize('admin'), adminDeleteShop);

// ---------------- Public ----------------
router.get('/', getPublicShops);       // GET /api/shops

// ---------------- Shop reviews ----------------
router.post('/:shopId/reviews', protect, authorize('buyer'), createShopReview);
router.get('/:shopId/reviews', getShopReviews);

router.get('/:slug', getShopBySlug);   // GET /api/shops/:slug — keep LAST

module.exports = router;