const express = require('express');
const router = express.Router();
const { getActiveAgents, createAgent, updateAgent, deleteAgent } = require('../controllers/agentController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.get('/', getActiveAgents);
router.post('/', protect, authorize('admin'), createAgent);
router.put('/:id', protect, authorize('admin'), updateAgent);
router.delete('/:id', protect, authorize('admin'), deleteAgent);

module.exports = router;