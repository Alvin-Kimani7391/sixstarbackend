const express = require('express');
const router = express.Router();

const {
  getAllCommissionsAdmin, getLedgerSummaryAdmin, reverseCommissionAdmin, createManualAdjustment, getAdjustmentsAdmin,
  getAllRulesAdmin, createRule, updateRule, deleteRule,
  getMyCommissions, getMyCommissionSummary, getMyCommissionDetail,
} = require('../controllers2/commissionController');

const { protect, authorize } = require('../middleware/authMiddleware');
const { protectAgent, requireActiveAgent } = require('../middleware/agentAuthMiddleware');

// ---------- Admin ----------
router.get('/admin', protect, authorize('admin'), getAllCommissionsAdmin);
router.get('/admin/summary', protect, authorize('admin'), getLedgerSummaryAdmin);
router.patch('/admin/:id/reverse', protect, authorize('admin'), reverseCommissionAdmin);

router.post('/admin/adjustments', protect, authorize('admin'), createManualAdjustment);
router.get('/admin/adjustments', protect, authorize('admin'), getAdjustmentsAdmin);

router.get('/admin/rules', protect, authorize('admin'), getAllRulesAdmin);
router.post('/admin/rules', protect, authorize('admin'), createRule);
router.patch('/admin/rules/:id', protect, authorize('admin'), updateRule);
router.delete('/admin/rules/:id', protect, authorize('admin'), deleteRule);

// ---------- Agent ----------
router.get('/my', protectAgent, requireActiveAgent, getMyCommissions);
router.get('/my/summary', protectAgent, requireActiveAgent, getMyCommissionSummary);
router.get('/my/:id', protectAgent, requireActiveAgent, getMyCommissionDetail);

module.exports = router;