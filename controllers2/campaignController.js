const asyncHandler = require('express-async-handler');
const Campaign = require('../models/Campaign');
const MarketingAsset = require('../models/MarketingAsset');
const ReferralClick = require('../models/ReferralClick');
const MarketingInteraction = require('../models/MarketingInteraction');
const { logAudit } = require('../services/auditService');
const Agent = require('../models/Agent');
const { notifyAgent } = require('../services/notificationService');

// ============================================================
// ADMIN
// ============================================================

const createCampaign = asyncHandler(async (req, res) => {
  const { name, description, startDate, endDate, targetAudience, eligibleBadges } = req.body;
  if (!name || !startDate || !endDate) {
    res.status(400);
    throw new Error('name, startDate and endDate are required');
  }

  const campaign = await Campaign.create({
    name,
    description: description || '',
    startDate,
    endDate,
    targetAudience: targetAudience || 'everyone',
    eligibleBadges: eligibleBadges || [],
    createdBy: req.user._id,
  });

  logAudit({ actor: req.user._id, action: 'campaign.created', targetType: 'Campaign', targetId: campaign._id });
  res.status(201).json({ success: true, campaign });
});

const getAllCampaignsAdmin = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const filter = status ? { status } : {};
  const campaigns = await Campaign.find(filter).sort('-createdAt');
  res.json({ success: true, count: campaigns.length, campaigns });
});

const updateCampaign = asyncHandler(async (req, res) => {
  const campaign = await Campaign.findById(req.params.id);
  if (!campaign) {
    res.status(404);
    throw new Error('Campaign not found');
  }
  const editable = ['name', 'description', 'startDate', 'endDate', 'targetAudience', 'eligibleBadges'];
  editable.forEach((f) => {
    if (req.body[f] !== undefined) campaign[f] = req.body[f];
  });
  await campaign.save();
  res.json({ success: true, campaign });
});

const setCampaignStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const valid = ['draft', 'scheduled', 'active', 'ended', 'archived'];
  if (!valid.includes(status)) {
    res.status(400);
    throw new Error('Invalid status');
  }
  const campaign = await Campaign.findByIdAndUpdate(req.params.id, { status }, { new: true });
  if (!campaign) {
    res.status(404);
    throw new Error('Campaign not found');
  }

  if (status === 'active') {
    const agents = await Agent.find({ isActive: true }).select('_id');
    agents.forEach((a) =>
      notifyAgent(a._id, { type: 'campaign_launched', title: '🔥 New campaign', message: `${campaign.name} is now live.` })
    );
  }

  res.json({ success: true, campaign });
});

const deleteCampaign = asyncHandler(async (req, res) => {
  const campaign = await Campaign.findByIdAndDelete(req.params.id);
  if (!campaign) {
    res.status(404);
    throw new Error('Campaign not found');
  }
  await MarketingAsset.updateMany({ campaign: campaign._id }, { $set: { campaign: null } });
  res.json({ success: true, message: 'Campaign deleted' });
});

// @desc    Campaign analytics — clicks, asset interactions (spec §58)
const getCampaignAnalyticsAdmin = asyncHandler(async (req, res) => {
  const campaign = await Campaign.findById(req.params.id);
  if (!campaign) {
    res.status(404);
    throw new Error('Campaign not found');
  }

  const [clicks, assets] = await Promise.all([
    ReferralClick.countDocuments({ type: 'campaign', targetId: campaign._id }),
    MarketingAsset.find({ campaign: campaign._id }).select('title downloadCount shareCount viewCount'),
  ]);

  const totalDownloads = assets.reduce((s, a) => s + a.downloadCount, 0);
  const totalShares = assets.reduce((s, a) => s + a.shareCount, 0);

  res.json({
    success: true,
    campaign: { id: campaign._id, name: campaign.name, status: campaign.computeStatus() },
    clicks,
    totalDownloads,
    totalShares,
    assets,
  });
});

// ============================================================
// AGENT / PUBLIC
// ============================================================

const listActiveCampaigns = asyncHandler(async (req, res) => {
  const now = new Date();
  const campaigns = await Campaign.find({
    status: { $in: ['active', 'scheduled'] },
    endDate: { $gte: now },
  }).sort('-isFeatured -startDate');

  res.json({ success: true, count: campaigns.length, campaigns });
});

const getCampaignDetail = asyncHandler(async (req, res) => {
  const campaign = await Campaign.findById(req.params.id);
  if (!campaign) {
    res.status(404);
    throw new Error('Campaign not found');
  }
  const assets = await MarketingAsset.find({ campaign: campaign._id, status: { $in: ['approved', 'published'] } });
  res.json({ success: true, campaign, assets });
});

// @desc    "Download Campaign Pack" (spec §19) — returns every asset URL in
//          the campaign; actual zipping is left to the frontend/CDN.
const downloadCampaignPack = asyncHandler(async (req, res) => {
  const assets = await MarketingAsset.find({ campaign: req.params.id, status: { $in: ['approved', 'published'] } });
  await MarketingAsset.updateMany({ _id: { $in: assets.map((a) => a._id) } }, { $inc: { downloadCount: 1 } });
  await MarketingInteraction.insertMany(
    assets.map((a) => ({ agent: req.agent._id, asset: a._id, campaign: req.params.id, type: 'download' }))
  );
  res.json({ success: true, files: assets.map((a) => ({ id: a._id, title: a.title, fileUrl: a.fileUrl, assetType: a.assetType })) });
});

module.exports = {
  createCampaign,
  getAllCampaignsAdmin,
  updateCampaign,
  setCampaignStatus,
  deleteCampaign,
  getCampaignAnalyticsAdmin,
  listActiveCampaigns,
  getCampaignDetail,
  downloadCampaignPack,
};