const asyncHandler = require('express-async-handler');
const FraudEvent = require('../models/FraudEvent');
const AuditLog = require('../models/AuditLog');

const getAllFraudEvents = asyncHandler(async (req, res) => {
  const { status, severity, agentId } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (severity) filter.severity = severity;
  if (agentId) filter.agent = agentId;

  const events = await FraudEvent.find(filter).populate('agent', 'name code').sort('-createdAt');
  res.json({ success: true, count: events.length, events });
});

const reviewFraudEvent = asyncHandler(async (req, res) => {
  const { decision } = req.body; // 'reviewed' | 'dismissed'
  if (!['reviewed', 'dismissed'].includes(decision)) {
    res.status(400);
    throw new Error('decision must be reviewed or dismissed');
  }

  const event = await FraudEvent.findById(req.params.id);
  if (!event) {
    res.status(404);
    throw new Error('Fraud event not found');
  }

  event.status = decision;
  event.reviewedBy = req.user._id;
  event.reviewedAt = new Date();
  await event.save();

  res.json({ success: true, event });
});

const getAuditLogs = asyncHandler(async (req, res) => {
  const { targetType, targetId, action, page = 1, limit = 50 } = req.query;
  const filter = {};
  if (targetType) filter.targetType = targetType;
  if (targetId) filter.targetId = targetId;
  if (action) filter.action = action;

  const skip = (Number(page) - 1) * Number(limit);
  const [logs, total] = await Promise.all([
    AuditLog.find(filter).populate('actor', 'name email').sort('-createdAt').skip(skip).limit(Number(limit)),
    AuditLog.countDocuments(filter),
  ]);

  res.json({ success: true, count: logs.length, total, page: Number(page), logs });
});

module.exports = { getAllFraudEvents, reviewFraudEvent, getAuditLogs };