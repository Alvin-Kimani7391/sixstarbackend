const express = require('express');
const router = express.Router();

const {
  createAsset, getAllAssetsAdmin, updateAssetMeta, replaceAssetVersion, setAssetStatus,
  toggleFeatureAsset, deleteAsset, getAssetAnalytics, getBrandKitAdmin, updateBrandKit,
  browseAssets, getAssetForAgent, downloadAsset, shareAsset, toggleFavorite, getMyMarketing, getBrandKit,
} = require('../controllers2/marketingController');

const { protect, authorize } = require('../middleware/authMiddleware');
const { protectAgent, requireActiveAgent } = require('../middleware/agentAuthMiddleware');
const { uploadMarketingAsset, uploadBrandAsset } = require('../middleware/uploadMiddleware');

// ---------- Admin ----------
router.get('/admin/assets', protect, authorize('admin'), getAllAssetsAdmin);
router.post('/admin/assets', protect, authorize('admin'), uploadMarketingAsset, createAsset);
router.patch('/admin/assets/:id', protect, authorize('admin'), updateAssetMeta);
router.post('/admin/assets/:id/replace', protect, authorize('admin'), uploadMarketingAsset, replaceAssetVersion);
router.patch('/admin/assets/:id/status', protect, authorize('admin'), setAssetStatus);
router.patch('/admin/assets/:id/feature', protect, authorize('admin'), toggleFeatureAsset);
router.delete('/admin/assets/:id', protect, authorize('admin'), deleteAsset);
router.get('/admin/assets/:id/analytics', protect, authorize('admin'), getAssetAnalytics);

router.get('/admin/brand-kit', protect, authorize('admin'), getBrandKitAdmin);
router.patch('/admin/brand-kit', protect, authorize('admin'), uploadBrandAsset, updateBrandKit);

// ---------- Agent ----------
router.get('/assets', protectAgent, requireActiveAgent, browseAssets);
router.get('/assets/:id', protectAgent, requireActiveAgent, getAssetForAgent);
router.post('/assets/:id/download', protectAgent, requireActiveAgent, downloadAsset);
router.post('/assets/:id/share', protectAgent, requireActiveAgent, shareAsset);
router.post('/assets/:id/favorite', protectAgent, requireActiveAgent, toggleFavorite);
router.get('/my-marketing', protectAgent, requireActiveAgent, getMyMarketing);
router.get('/brand-kit', protectAgent, requireActiveAgent, getBrandKit);

module.exports = router;