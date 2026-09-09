const asyncHandler = require('express-async-handler');
const ReferralClick = require('../models/ReferralClick');
const MarketingInteraction = require('../models/MarketingInteraction');
const Commission = require('../models/Commission');
const AgentLead = require('../models/AgentLead');
const Agent = require('../models/Agent');

// ============================================================
// AGENT — own analytics (spec §56-57)
// ============================================================

const getMyAnalytics = asyncHandler(async (req, res) => {
  const agentId = req.agent._id;

  const [assetsDownloaded, assetsShared, referralClicks, commissionAgg, leadStats] = await Promise.all([
    MarketingInteraction.countDocuments({ agent: agentId, type: 'download' }),
    MarketingInteraction.countDocuments({ agent: agentId, type: 'share' }),
    ReferralClick.countDocuments({ agent: agentId }),
    Commission.aggregate([
      { $match: { agent: agentId } },
      { $group: { _id: '$status', total: { $sum: '$commissionAmount' } } },
    ]),
    AgentLead.aggregate([{ $match: { agent: agentId } }, { $group: { _id: { leadType: '$leadType', status: '$status' }, count: { $sum: 1 } } }]),
  ]);

  const commissionByStatus = { pending: 0, confirmed: 0, cancelled: 0, reversed: 0 };
  commissionAgg.forEach((r) => {
    commissionByStatus[r._id] = r.total;
  });

  res.json({
    success: true,
    marketing: { assetsDownloaded, assetsShared, referralClicks },
    commissions: commissionByStatus,
    leads: leadStats,
    agentTotals: {
      buyersReferred: req.agent.buyersReferred,
      sellersReferred: req.agent.sellersReferred,
      approvedSellersReferred: req.agent.approvedSellersReferred,
      totalOrders: req.agent.totalOrders,
      totalCommission: req.agent.totalCommission,
    },
  });
});

const getMyChannelAnalytics = asyncHandler(async (req, res) => {
  const channels = await ReferralClick.aggregate([
    { $match: { agent: req.agent._id } },
    { $group: { _id: '$channel', clicks: { $sum: 1 } } },
    { $sort: { clicks: -1 } },
  ]);
  res.json({ success: true, channels });
});

// ============================================================
// ADMIN
// ============================================================

const getAgentAnalyticsAdmin = asyncHandler(async (req, res) => {
  const agent = await Agent.findById(req.params.id);
  if (!agent) {
    res.status(404);
    throw new Error('Agent not found');
  }

  const [clicks, downloads, shares, commissionTotal] = await Promise.all([
    ReferralClick.countDocuments({ agent: agent._id }),
    MarketingInteraction.countDocuments({ agent: agent._id, type: 'download' }),
    MarketingInteraction.countDocuments({ agent: agent._id, type: 'share' }),
    Commission.aggregate([{ $match: { agent: agent._id, status: 'confirmed' } }, { $group: { _id: null, total: { $sum: '$commissionAmount' } } }]),
  ]);

  res.json({
    success: true,
    agent: { id: agent._id, name: agent.name, code: agent.code },
    clicks,
    downloads,
    shares,
    confirmedCommission: commissionTotal[0]?.total || 0,
  });
});

const getChannelAnalyticsAdmin = asyncHandler(async (req, res) => {
  const channels = await ReferralClick.aggregate([
    { $group: { _id: '$channel', clicks: { $sum: 1 } } },
    { $sort: { clicks: -1 } },
  ]);
  res.json({ success: true, channels });
});

module.exports = { getMyAnalytics, getMyChannelAnalytics, getAgentAnalyticsAdmin, getChannelAnalyticsAdmin };