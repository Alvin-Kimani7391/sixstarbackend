const express = require('express');
const router = express.Router();

const {
  createCampaign, getAllCampaignsAdmin, updateCampaign, setCampaignStatus, deleteCampaign, getCampaignAnalyticsAdmin,
  listActiveCampaigns, getCampaignDetail, downloadCampaignPack,
} = require('../controllers2/campaignController');

const { protect, authorize } = require('../middleware/authMiddleware');
const { protectAgent, requireActiveAgent } = require('../middleware/agentAuthMiddleware');

router.get('/admin', protect, authorize('admin'), getAllCampaignsAdmin);
router.post('/admin', protect, authorize('admin'), createCampaign);
router.patch('/admin/:id', protect, authorize('admin'), updateCampaign);
router.patch('/admin/:id/status', protect, authorize('admin'), setCampaignStatus);
router.delete('/admin/:id', protect, authorize('admin'), deleteCampaign);
router.get('/admin/:id/analytics', protect, authorize('admin'), getCampaignAnalyticsAdmin);

router.get('/', protectAgent, requireActiveAgent, listActiveCampaigns);
router.get('/:id', protectAgent, requireActiveAgent, getCampaignDetail);
router.get('/:id/download-pack', protectAgent, requireActiveAgent, downloadCampaignPack);

module.exports = router;