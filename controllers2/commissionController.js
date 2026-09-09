const asyncHandler = require('express-async-handler');
const Commission = require('../models/Commission');
const CommissionRule = require('../models/CommissionRule');
const CommissionAdjustment = require('../models/CommissionAdjustment');
const Agent = require('../models/Agent');
const { applyManualAdjustment } = require('../services/commissionService');
const { logAudit } = require('../services/auditService');
const { notifyAgent } = require('../services/notificationService');

// ============================================================
// ADMIN
// ============================================================

const getAllCommissionsAdmin = asyncHandler(async (req, res) => {
  const { agentId, status, referralType, page = 1, limit = 50 } = req.query;
  const filter = {};
  if (agentId) filter.agent = agentId;
  if (status) filter.status = status;
  if (referralType) filter.referralType = referralType;

  const skip = (Number(page) - 1) * Number(limit);
  const [commissions, total] = await Promise.all([
    Commission.find(filter)
      .populate('agent', 'name code')
      .populate('buyer', 'name email')
      .populate('seller', 'name businessName shopName')
      .populate('order', 'orderNumber totalAmount')
      .sort('-createdAt')
      .skip(skip)
      .limit(Number(limit)),
    Commission.countDocuments(filter),
  ]);

  res.json({ success: true, count: commissions.length, total, page: Number(page), commissions });
});

// @desc    Admin ledger-wide overview (spec §70)
const getLedgerSummaryAdmin = asyncHandler(async (req, res) => {
  const [totals] = await Commission.aggregate([
    {
      $group: {
        _id: null,
        totalGenerated: { $sum: '$commissionAmount' },
        pending: { $sum: { $cond: [{ $in: ['$status', ['pending', 'processing']] }, '$commissionAmount', 0] } },
        confirmed: { $sum: { $cond: [{ $eq: ['$status', 'confirmed'] }, '$commissionAmount', 0] } },
      },
    },
  ]);

  res.json({ success: true, totals: totals || { totalGenerated: 0, pending: 0, confirmed: 0 } });
});

// @desc    Reverse a specific commission manually (e.g. discovered fraud)
const reverseCommissionAdmin = asyncHandler(async (req, res) => {
  const commission = await Commission.findById(req.params.id);
  if (!commission) {
    res.status(404);
    throw new Error('Commission not found');
  }
  if (commission.status !== 'confirmed') {
    res.status(400);
    throw new Error('Only confirmed commissions can be reversed');
  }

  commission.status = 'reversed';
  await commission.save();

  await Agent.findByIdAndUpdate(commission.agent, { $inc: { totalCommission: -commission.commissionAmount } });

  logAudit({ actor: req.user._id, action: 'commission.reversed', targetType: 'Commission', targetId: commission._id });
  notifyAgent(commission.agent, { type: 'commission_reversed', title: 'Commission reversed', message: `A commission of KES ${commission.commissionAmount.toLocaleString()} was reversed by admin.` });

  res.json({ success: true, commission });
});

// @desc    Manual adjustment / bonus (spec §69)
const createManualAdjustment = asyncHandler(async (req, res) => {
  const { agentId, amount, reason } = req.body;
  if (!agentId || amount === undefined || !reason) {
    res.status(400);
    throw new Error('agentId, amount and reason are required');
  }

  const adjustment = await applyManualAdjustment({ agentId, amount: Number(amount), reason, adminId: req.user._id });
  logAudit({ actor: req.user._id, action: 'commission.adjusted', targetType: 'Agent', targetId: agentId, metadata: { amount, reason } });

  res.status(201).json({ success: true, adjustment });
});

const getAdjustmentsAdmin = asyncHandler(async (req, res) => {
  const { agentId } = req.query;
  const filter = agentId ? { agent: agentId } : {};
  const adjustments = await CommissionAdjustment.find(filter).populate('agent', 'name code').populate('addedBy', 'name').sort('-createdAt');
  res.json({ success: true, count: adjustments.length, adjustments });
});

// ---------- Commission Rules ----------
const getAllRulesAdmin = asyncHandler(async (req, res) => {
  const rules = await CommissionRule.find().populate('badge', 'name').sort('-priority');
  res.json({ success: true, count: rules.length, rules });
});

const createRule = asyncHandler(async (req, res) => {
  const { name, audience, badge, commissionRate, priority, isActive } = req.body;
  if (!name || !audience || commissionRate === undefined) {
    res.status(400);
    throw new Error('name, audience and commissionRate are required');
  }
  const rule = await CommissionRule.create({ name, audience, badge: badge || null, commissionRate, priority: priority || 0, isActive: isActive !== undefined ? isActive : true });
  res.status(201).json({ success: true, rule });
});

const updateRule = asyncHandler(async (req, res) => {
  const rule = await CommissionRule.findById(req.params.id);
  if (!rule) {
    res.status(404);
    throw new Error('Rule not found');
  }
  const editable = ['name', 'audience', 'badge', 'commissionRate', 'priority', 'isActive'];
  editable.forEach((f) => {
    if (req.body[f] !== undefined) rule[f] = req.body[f];
  });
  await rule.save();
  res.json({ success: true, rule });
});

const deleteRule = asyncHandler(async (req, res) => {
  const rule = await CommissionRule.findByIdAndDelete(req.params.id);
  if (!rule) {
    res.status(404);
    throw new Error('Rule not found');
  }
  res.json({ success: true, message: 'Rule deleted' });
});

// ============================================================
// AGENT
// ============================================================

const getMyCommissions = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 50 } = req.query;
  const filter = { agent: req.agent._id };
  if (status) filter.status = status;

  const skip = (Number(page) - 1) * Number(limit);
  const [commissions, total] = await Promise.all([
    Commission.find(filter).populate('order', 'orderNumber totalAmount').sort('-createdAt').skip(skip).limit(Number(limit)),
    Commission.countDocuments(filter),
  ]);

  res.json({ success: true, count: commissions.length, total, page: Number(page), commissions });
});

const getMyCommissionSummary = asyncHandler(async (req, res) => {
  const agg = await Commission.aggregate([
    { $match: { agent: req.agent._id } },
    { $group: { _id: '$status', total: { $sum: '$commissionAmount' }, count: { $sum: 1 } } },
  ]);

  const summary = { pending: 0, processing: 0, eligible: 0, confirmed: 0, cancelled: 0, reversed: 0 };
  agg.forEach((row) => {
    summary[row._id] = row.total;
  });

  res.json({
    success: true,
    summary: {
      ...summary,
      lifetime: summary.confirmed,
    },
  });
});

const getMyCommissionDetail = asyncHandler(async (req, res) => {
  const commission = await Commission.findOne({ _id: req.params.id, agent: req.agent._id })
    .populate('order', 'orderNumber totalAmount createdAt')
    .populate('buyer', 'name')
    .populate('seller', 'name businessName shopName')
    .populate('badge', 'name');
  if (!commission) {
    res.status(404);
    throw new Error('Commission not found');
  }
  res.json({ success: true, commission });
});

module.exports = {
  getAllCommissionsAdmin,
  getLedgerSummaryAdmin,
  reverseCommissionAdmin,
  createManualAdjustment,
  getAdjustmentsAdmin,
  getAllRulesAdmin,
  createRule,
  updateRule,
  deleteRule,
  getMyCommissions,
  getMyCommissionSummary,
  getMyCommissionDetail,
};