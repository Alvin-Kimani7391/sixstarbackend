const express = require('express');
const router = express.Router();

const { getMyAnalytics, getMyChannelAnalytics, getAgentAnalyticsAdmin, getChannelAnalyticsAdmin } = require('../controllers2/analyticsController');
const { protect, authorize } = require('../middleware/authMiddleware');
const { protectAgent, requireActiveAgent } = require('../middleware/agentAuthMiddleware');

router.get('/admin/agents/:id', protect, authorize('admin'), getAgentAnalyticsAdmin);
router.get('/admin/channels', protect, authorize('admin'), getChannelAnalyticsAdmin);

router.get('/my', protectAgent, requireActiveAgent, getMyAnalytics);
router.get('/my/channels', protectAgent, requireActiveAgent, getMyChannelAnalytics);

module.exports = router;