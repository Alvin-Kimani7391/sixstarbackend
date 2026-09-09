const express = require('express');
const router = express.Router();

const {
  createLead, getMyLeads, getLeadById, updateLead, addLeadNote, deleteLead, getFollowupReminders,
  getAllLeadsAdmin, getPipelineStatsAdmin,
} = require('../controllers2/recruitmentController');

const { protect, authorize } = require('../middleware/authMiddleware');
const { protectAgent, requireActiveAgent } = require('../middleware/agentAuthMiddleware');

router.get('/admin/leads', protect, authorize('admin'), getAllLeadsAdmin);
router.get('/admin/pipeline-stats', protect, authorize('admin'), getPipelineStatsAdmin);

router.use(protectAgent, requireActiveAgent);
router.get('/leads/followups', getFollowupReminders);
router.get('/leads', getMyLeads);
router.post('/leads', createLead);
router.get('/leads/:id', getLeadById);
router.patch('/leads/:id', updateLead);
router.post('/leads/:id/notes', addLeadNote);
router.delete('/leads/:id', deleteLead);

module.exports = router;