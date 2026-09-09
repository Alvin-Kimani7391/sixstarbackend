const asyncHandler = require('express-async-handler');
const AgentNotification = require('../models/AgentNotification');
const AgentAchievement = require('../models/AgentAchievement');
const Achievement = require('../models/Achievement');
const Agent = require('../models/Agent');
const MarketingAsset = require('../models/MarketingAsset');
const { ACHIEVEMENTS } = require('../services/achievementService');

// ---------- Notifications ----------
const getMyNotifications = asyncHandler(async (req, res) => {
  const { unreadOnly } = req.query;
  const filter = { agent: req.agent._id };
  if (unreadOnly === 'true') filter.isRead = false;
  const notifications = await AgentNotification.find(filter).sort('-createdAt').limit(100);
  res.json({ success: true, count: notifications.length, notifications });
});

const markNotificationRead = asyncHandler(async (req, res) => {
  const n = await AgentNotification.findOneAndUpdate({ _id: req.params.id, agent: req.agent._id }, { isRead: true }, { new: true });
  if (!n) {
    res.status(404);
    throw new Error('Notification not found');
  }
  res.json({ success: true, notification: n });
});

const markAllNotificationsRead = asyncHandler(async (req, res) => {
  await AgentNotification.updateMany({ agent: req.agent._id, isRead: false }, { isRead: true });
  res.json({ success: true });
});

// ---------- Leaderboard (spec §64) ----------
const getLeaderboard = asyncHandler(async (req, res) => {
  const { metric = 'totalCommission', limit = 20 } = req.query;
  const validMetrics = ['buyersReferred', 'sellersReferred', 'approvedSellersReferred', 'totalCommission', 'lifetimeMarketplaceProfit'];
  const sortField = validMetrics.includes(metric) ? metric : 'totalCommission';

  const agents = await Agent.find({ isActive: true })
    .select(`name code avatar badge ${sortField}`)
    .populate('badge', 'name color')
    .sort(`-${sortField}`)
    .limit(Number(limit));

  res.json({ success: true, metric: sortField, agents });
});

// ---------- Achievements (spec §65) ----------
const listAchievementDefinitions = asyncHandler(async (req, res) => {
  res.json({ success: true, achievements: ACHIEVEMENTS.map(({ key, name, description, icon }) => ({ key, name, description, icon })) });
});

const getMyAchievements = asyncHandler(async (req, res) => {
  const earned = await AgentAchievement.find({ agent: req.agent._id }).populate('achievement').sort('-earnedAt');
  res.json({ success: true, count: earned.length, achievements: earned });
});

// ---------- Academy (spec §66) — reuses MarketingAsset with isAcademyContent ----------
const getAcademyContent = asyncHandler(async (req, res) => {
  const assets = await MarketingAsset.find({ isAcademyContent: true, status: { $in: ['approved', 'published'] } }).sort('-createdAt');
  res.json({ success: true, count: assets.length, resources: assets });
});

module.exports = {
  getMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getLeaderboard,
  listAchievementDefinitions,
  getMyAchievements,
  getAcademyContent,
};