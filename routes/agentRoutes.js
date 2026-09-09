const express = require('express');
const router = express.Router();

const {
  getActiveAgents,
  getPublicAgentProfile,
  trackReferralClick,
  getAllAgentsAdmin,
  getPendingAgentApplications,
  createAgent,
  approveAgentApplication,
  markAgentUnderReview,
  rejectAgentApplication,
  suspendAgent,
  reactivateAgent,
  updateAgent,
  deleteAgent,
  getAgentOrders,
  getAgentReferralClicks,
  getAllBadgesAdmin,
  createBadge,
  updateBadge,
  deleteBadge,
} = require('../controllers2/agentController');

const {
  applyAsAgent,
  agentLogin,
  agentLogout,
  getMyAgentProfile,
  updateMyAgentProfile,
  changeAgentPassword,
  forgotAgentPassword,
  resetAgentPassword,
} = require('../controllers2/agentAuthController');

const { protect, authorize } = require('../middleware/authMiddleware');
const { protectAgent } = require('../middleware/agentAuthMiddleware');
const { uploadAgentAvatar } = require('../middleware/uploadMiddleware');

// ============================================================
// PUBLIC
// ============================================================
router.get('/', getActiveAgents); // checkout picker
router.get('/public/:slug', getPublicAgentProfile); // public agent page
router.post('/track/:code', trackReferralClick); // referral link click

// ============================================================
// AGENT SELF-SERVICE AUTH
// ============================================================
// FIX: /apply is submitted as multipart/form-data (it has an optional avatar
// file field), so it needs the same multer middleware as PATCH /me, or
// express.json()/urlencoded() never populate req.body and every application
// fails the "required fields" check before it can create the Agent doc.
router.post('/apply', uploadAgentAvatar, applyAsAgent);
router.post('/login', agentLogin);
router.post('/logout', protectAgent, agentLogout);
router.post('/forgot-password', forgotAgentPassword);
router.post('/reset-password', resetAgentPassword);

router.get('/me', protectAgent, getMyAgentProfile);
router.patch('/me', protectAgent, uploadAgentAvatar, updateMyAgentProfile);
router.put('/change-password', protectAgent, changeAgentPassword);

// ============================================================
// ADMIN
// ============================================================
router.get('/admin/all', protect, authorize('admin'), getAllAgentsAdmin);
router.get('/admin/pending', protect, authorize('admin'), getPendingAgentApplications);
router.post('/admin', protect, authorize('admin'), createAgent);
router.patch('/admin/:id/approve', protect, authorize('admin'), approveAgentApplication);
router.patch('/admin/:id/review', protect, authorize('admin'), markAgentUnderReview);
router.patch('/admin/:id/reject', protect, authorize('admin'), rejectAgentApplication);
router.patch('/admin/:id/suspend', protect, authorize('admin'), suspendAgent);
router.patch('/admin/:id/reactivate', protect, authorize('admin'), reactivateAgent);
router.put('/admin/:id', protect, authorize('admin'), updateAgent);
router.delete('/admin/:id', protect, authorize('admin'), deleteAgent);
router.get('/admin/:id/orders', protect, authorize('admin'), getAgentOrders);
router.get('/admin/:id/clicks', protect, authorize('admin'), getAgentReferralClicks);

// Badges
router.get('/admin/badges', protect, authorize('admin'), getAllBadgesAdmin);
router.post('/admin/badges', protect, authorize('admin'), createBadge);
router.patch('/admin/badges/:id', protect, authorize('admin'), updateBadge);
router.delete('/admin/badges/:id', protect, authorize('admin'), deleteBadge);

module.exports = router;