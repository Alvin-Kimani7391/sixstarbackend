const express = require('express');
const router = express.Router();

const { getAllFraudEvents, reviewFraudEvent, getAuditLogs } = require('../controllers2/fraudController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.use(protect, authorize('admin'));

router.get('/events', getAllFraudEvents);
router.patch('/events/:id/review', reviewFraudEvent);
router.get('/audit-logs', getAuditLogs);

module.exports = router;