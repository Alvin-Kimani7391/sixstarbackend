// agentRoutes.js
const express = require('express');
const router = express.Router();
const {
  getActiveAgents,
  getAllAgentsAdmin,
  getAgentOrders, // NEW - see controllers2/agentController.js
  createAgent,
  updateAgent,
  deleteAgent,
} = require('../controllers2/agentController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.get('/', getActiveAgents);
router.get('/admin/all', protect, authorize('admin'), getAllAgentsAdmin);
router.get('/admin/:id/orders', protect, authorize('admin'), getAgentOrders); // NEW
router.post('/', protect, authorize('admin'), createAgent);
router.put('/:id', protect, authorize('admin'), updateAgent);
router.delete('/:id', protect, authorize('admin'), deleteAgent);

module.exports = router;