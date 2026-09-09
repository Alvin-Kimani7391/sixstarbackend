const asyncHandler = require('express-async-handler');
const MarketingAsset = require('../models/MarketingAsset');
const MarketingInteraction = require('../models/MarketingInteraction');
const AgentFavorite = require('../models/AgentFavorite');
const BrandKit = require('../models/BrandKit');
const { logAudit } = require('../services/auditService');
const { notifyAgent } = require('../services/notificationService');
const Agent = require('../models/Agent');

function assetFileFromReq(req) {
  const file = req.files?.file?.[0];
  const thumb = req.files?.thumbnail?.[0];
  return { fileUrl: file ? file.path : null, thumbnailUrl: thumb ? thumb.path : '' };
}

// ============================================================
// ADMIN — Assets
// ============================================================

// @desc    Upload a new marketing asset
// @route   POST /api/marketing/admin/assets
// @access  Private (admin)
const createAsset = asyncHandler(async (req, res) => {
  const { fileUrl, thumbnailUrl } = assetFileFromReq(req);
  if (!fileUrl) {
    res.status(400);
    throw new Error('A file is required');
  }

  const { title, description, assetType, audience, campaign, cta, publishAt, expiryAt, isAcademyContent } = req.body;
  if (!title || !assetType) {
    res.status(400);
    throw new Error('title and assetType are required');
  }

  let channels = [];
  if (req.body.channels) {
    try {
      channels = typeof req.body.channels === 'string' ? JSON.parse(req.body.channels) : req.body.channels;
    } catch {
      channels = [];
    }
  }

  const asset = await MarketingAsset.create({
    title,
    description: description || '',
    assetType,
    fileUrl,
    thumbnailUrl,
    audience: audience || 'everyone',
    campaign: campaign || null,
    channels,
    cta: cta || 'Shop Now',
    publishAt: publishAt || null,
    expiryAt: expiryAt || null,
    isAcademyContent: isAcademyContent === true || isAcademyContent === 'true',
    status: 'draft',
    createdBy: req.user._id,
  });

  logAudit({ actor: req.user._id, action: 'marketing_asset.created', targetType: 'MarketingAsset', targetId: asset._id });

  res.status(201).json({ success: true, asset });
});

// @desc    List all assets (any status) for the admin screen
// @route   GET /api/marketing/admin/assets?status=&assetType=&audience=&campaign=&search=
// @access  Private (admin)
const getAllAssetsAdmin = asyncHandler(async (req, res) => {
  const { status, assetType, audience, campaign, search } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (assetType) filter.assetType = assetType;
  if (audience) filter.audience = audience;
  if (campaign) filter.campaign = campaign;
  if (search && search.trim()) filter.$text = { $search: search.trim() };

  const assets = await MarketingAsset.find(filter).populate('campaign', 'name').sort('-createdAt');
  res.json({ success: true, count: assets.length, assets });
});

// @desc    Edit an asset's metadata (title/desc/audience/campaign/cta/dates/channels)
// @route   PATCH /api/marketing/admin/assets/:id
// @access  Private (admin)
const updateAssetMeta = asyncHandler(async (req, res) => {
  const asset = await MarketingAsset.findById(req.params.id);
  if (!asset) {
    res.status(404);
    throw new Error('Asset not found');
  }

  const editable = ['title', 'description', 'audience', 'campaign', 'cta', 'publishAt', 'expiryAt'];
  editable.forEach((f) => {
    if (req.body[f] !== undefined) asset[f] = req.body[f];
  });
  if (req.body.channels !== undefined) {
    try {
      asset.channels = typeof req.body.channels === 'string' ? JSON.parse(req.body.channels) : req.body.channels;
    } catch {
      /* ignore malformed */
    }
  }
  if (req.body.isAcademyContent !== undefined) {
    asset.isAcademyContent = req.body.isAcademyContent === true || req.body.isAcademyContent === 'true';
  }

  await asset.save();
  res.json({ success: true, asset });
});

// @desc    Replace an asset's file — creates a new version, archives the old one (spec §74)
// @route   POST /api/marketing/admin/assets/:id/replace
// @access  Private (admin)
const replaceAssetVersion = asyncHandler(async (req, res) => {
  const old = await MarketingAsset.findById(req.params.id);
  if (!old) {
    res.status(404);
    throw new Error('Asset not found');
  }

  const { fileUrl, thumbnailUrl } = assetFileFromReq(req);
  if (!fileUrl) {
    res.status(400);
    throw new Error('A replacement file is required');
  }

  const next = await MarketingAsset.create({
    title: old.title,
    description: old.description,
    assetType: old.assetType,
    fileUrl,
    thumbnailUrl: thumbnailUrl || old.thumbnailUrl,
    audience: old.audience,
    campaign: old.campaign,
    channels: old.channels,
    cta: old.cta,
    publishAt: old.publishAt,
    expiryAt: old.expiryAt,
    isAcademyContent: old.isAcademyContent,
    status: 'draft',
    version: old.version + 1,
    previousVersion: old._id,
    createdBy: req.user._id,
  });

  old.status = 'archived';
  await old.save();

  logAudit({ actor: req.user._id, action: 'marketing_asset.versioned', targetType: 'MarketingAsset', targetId: next._id, metadata: { previousVersion: old._id } });

  res.status(201).json({ success: true, asset: next });
});

// @desc    Change an asset's status (approve/publish/schedule/archive/expire)
// @route   PATCH /api/marketing/admin/assets/:id/status
// @access  Private (admin)
const setAssetStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const valid = ['draft', 'pending_review', 'approved', 'scheduled', 'published', 'expired', 'archived'];
  if (!valid.includes(status)) {
    res.status(400);
    throw new Error('Invalid status');
  }

  const asset = await MarketingAsset.findByIdAndUpdate(req.params.id, { status }, { new: true });
  if (!asset) {
    res.status(404);
    throw new Error('Asset not found');
  }

  // Announce new material to every active agent (spec §62-63) when it goes live.
  if (status === 'published') {
    const agents = await Agent.find({ isActive: true }).select('_id');
    agents.forEach((a) =>
      notifyAgent(a._id, {
        type: 'new_marketing_asset',
        title: '📣 New marketing material available',
        message: `"${asset.title}" is now available in the Marketing Center.`,
      })
    );
  }

  logAudit({ actor: req.user._id, action: 'marketing_asset.status_changed', targetType: 'MarketingAsset', targetId: asset._id, metadata: { status } });

  res.json({ success: true, asset });
});

// @desc    Toggle featured flag
// @route   PATCH /api/marketing/admin/assets/:id/feature
// @access  Private (admin)
const toggleFeatureAsset = asyncHandler(async (req, res) => {
  const asset = await MarketingAsset.findById(req.params.id);
  if (!asset) {
    res.status(404);
    throw new Error('Asset not found');
  }
  asset.isFeatured = !asset.isFeatured;
  await asset.save();
  res.json({ success: true, asset });
});

// @desc    Delete an asset entirely
// @route   DELETE /api/marketing/admin/assets/:id
// @access  Private (admin)
const deleteAsset = asyncHandler(async (req, res) => {
  const asset = await MarketingAsset.findByIdAndDelete(req.params.id);
  if (!asset) {
    res.status(404);
    throw new Error('Asset not found');
  }
  logAudit({ actor: req.user._id, action: 'marketing_asset.deleted', targetType: 'MarketingAsset', targetId: asset._id });
  res.json({ success: true, message: 'Asset deleted' });
});

// @desc    Per-asset analytics (spec §17, §59)
// @route   GET /api/marketing/admin/assets/:id/analytics
// @access  Private (admin)
const getAssetAnalytics = asyncHandler(async (req, res) => {
  const asset = await MarketingAsset.findById(req.params.id);
  if (!asset) {
    res.status(404);
    throw new Error('Asset not found');
  }

  const channelBreakdown = await MarketingInteraction.aggregate([
    { $match: { asset: asset._id, type: 'share' } },
    { $group: { _id: '$channel', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  res.json({
    success: true,
    asset: { id: asset._id, title: asset.title, views: asset.viewCount, downloads: asset.downloadCount, shares: asset.shareCount },
    channelBreakdown,
  });
});

// ============================================================
// ADMIN — Brand Kit
// ============================================================

const getBrandKitAdmin = asyncHandler(async (req, res) => {
  const kit = await BrandKit.getOrCreate();
  res.json({ success: true, brandKit: kit });
});

const updateBrandKit = asyncHandler(async (req, res) => {
  const kit = await BrandKit.getOrCreate();
  const editable = ['siteName', 'siteUrl', 'contactEmail', 'contactPhone', 'legalText', 'defaultCta', 'primaryColor', 'secondaryColor', 'fontFamily'];
  editable.forEach((f) => {
    if (req.body[f] !== undefined) kit[f] = req.body[f];
  });
  if (req.body.socialAccounts) {
    try {
      const sa = typeof req.body.socialAccounts === 'string' ? JSON.parse(req.body.socialAccounts) : req.body.socialAccounts;
      kit.socialAccounts = { ...kit.socialAccounts.toObject(), ...sa };
    } catch {
      /* ignore */
    }
  }
  if (req.files?.logo?.[0]) kit.logo = req.files.logo[0].path;
  if (req.files?.altLogo?.[0]) kit.altLogo = req.files.altLogo[0].path;

  await kit.save();
  res.json({ success: true, brandKit: kit });
});

// ============================================================
// AGENT — Marketing Center
// ============================================================

// @desc    Browse the Marketing Center (spec §8-15)
// @route   GET /api/marketing/assets?type=&audience=&campaign=&channel=&q=&featured=&sort=
// @access  Private (agent)
const browseAssets = asyncHandler(async (req, res) => {
  const { type, audience, campaign, channel, q, featured, sort } = req.query;
  const now = new Date();

  const filter = {
    status: { $in: ['approved', 'published'] },
    $and: [
      { $or: [{ expiryAt: null }, { expiryAt: { $gte: now } }] },
      { $or: [{ audience: 'everyone' }, { audience: 'agent' }, ...(audience ? [{ audience }] : [])] },
    ],
  };
  if (type) filter.assetType = type;
  if (campaign) filter.campaign = campaign;
  if (channel) filter.channels = channel;
  if (featured === 'true') filter.isFeatured = true;
  if (q && q.trim()) filter.$text = { $search: q.trim() };

  const sortMap = { newest: '-createdAt', popular: '-downloadCount', featured: '-isFeatured' };
  const assets = await MarketingAsset.find(filter)
    .populate('campaign', 'name')
    .sort(sortMap[sort] || '-isFeatured -createdAt')
    .limit(100);

  res.json({ success: true, count: assets.length, assets });
});

// @desc    Get one asset (also bumps its view count)
// @route   GET /api/marketing/assets/:id
// @access  Private (agent)
const getAssetForAgent = asyncHandler(async (req, res) => {
  const asset = await MarketingAsset.findById(req.params.id).populate('campaign', 'name');
  if (!asset) {
    res.status(404);
    throw new Error('Asset not found');
  }

  MarketingAsset.findByIdAndUpdate(asset._id, { $inc: { viewCount: 1 } }).catch(() => {});
  MarketingInteraction.create({ agent: req.agent._id, asset: asset._id, campaign: asset.campaign, type: 'view' }).catch(() => {});

  res.json({ success: true, asset });
});

// @desc    Download an asset — records the download (spec §16)
// @route   POST /api/marketing/assets/:id/download
// @access  Private (agent)
const downloadAsset = asyncHandler(async (req, res) => {
  const asset = await MarketingAsset.findById(req.params.id);
  if (!asset) {
    res.status(404);
    throw new Error('Asset not found');
  }

  await MarketingAsset.findByIdAndUpdate(asset._id, { $inc: { downloadCount: 1 } });
  await MarketingInteraction.create({ agent: req.agent._id, asset: asset._id, campaign: asset.campaign, type: 'download' });

  res.json({ success: true, fileUrl: asset.fileUrl });
});

// @desc    Share an asset — records the share and returns ready-to-send content
// @route   POST /api/marketing/assets/:id/share
// @access  Private (agent)
const shareAsset = asyncHandler(async (req, res) => {
  const { buildReferralLink, buildProductCaption } = require('../services/shareMessageService');
  const { channel = 'other' } = req.body;

  const asset = await MarketingAsset.findById(req.params.id);
  if (!asset) {
    res.status(404);
    throw new Error('Asset not found');
  }

  await MarketingAsset.findByIdAndUpdate(asset._id, { $inc: { shareCount: 1 } });
  await MarketingInteraction.create({ agent: req.agent._id, asset: asset._id, campaign: asset.campaign, type: 'share', channel });

  const link = buildReferralLink({ agentCode: req.agent.code, type: 'general' });
  const caption = buildProductCaption({ agentName: req.agent.name, productName: asset.title, link });

  res.json({ success: true, asset: { id: asset._id, fileUrl: asset.fileUrl, title: asset.title }, link, caption });
});

// @desc    Favorite / unfavorite (spec §61)
// @route   POST /api/marketing/assets/:id/favorite
// @access  Private (agent)
const toggleFavorite = asyncHandler(async (req, res) => {
  const existing = await AgentFavorite.findOne({ agent: req.agent._id, asset: req.params.id });
  if (existing) {
    await existing.deleteOne();
    return res.json({ success: true, favorited: false });
  }
  await AgentFavorite.create({ agent: req.agent._id, asset: req.params.id });
  res.json({ success: true, favorited: true });
});

// @desc    "My Marketing" — favorites, recent downloads/shares (spec §60)
// @route   GET /api/marketing/my-marketing
// @access  Private (agent)
const getMyMarketing = asyncHandler(async (req, res) => {
  const [favorites, recentDownloads, recentShares] = await Promise.all([
    AgentFavorite.find({ agent: req.agent._id }).populate('asset').sort('-createdAt'),
    MarketingInteraction.find({ agent: req.agent._id, type: 'download' }).populate('asset', 'title fileUrl assetType').sort('-createdAt').limit(20),
    MarketingInteraction.find({ agent: req.agent._id, type: 'share' }).populate('asset', 'title fileUrl assetType').sort('-createdAt').limit(20),
  ]);

  res.json({
    success: true,
    favorites: favorites.map((f) => f.asset),
    recentDownloads,
    recentShares,
  });
});

// @desc    Public/agent-facing brand kit read (for building personalized materials)
// @route   GET /api/marketing/brand-kit
// @access  Private (agent)
const getBrandKit = asyncHandler(async (req, res) => {
  const kit = await BrandKit.getOrCreate();
  res.json({ success: true, brandKit: kit });
});

module.exports = {
  // admin
  createAsset,
  getAllAssetsAdmin,
  updateAssetMeta,
  replaceAssetVersion,
  setAssetStatus,
  toggleFeatureAsset,
  deleteAsset,
  getAssetAnalytics,
  getBrandKitAdmin,
  updateBrandKit,
  // agent
  browseAssets,
  getAssetForAgent,
  downloadAsset,
  shareAsset,
  toggleFavorite,
  getMyMarketing,
  getBrandKit,
};