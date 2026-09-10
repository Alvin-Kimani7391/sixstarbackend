const asyncHandler = require('express-async-handler');
const EmailCampaign = require('../models/EmailCampaign');
const EmailSubscriber = require('../models/EmailSubscriber');
const EmailSendLog = require('../models/EmailSendLog');
const WhatsappPromo = require('../models/WhatsappPromo');
const Product = require('../models/Product');
const {
  resolveSegmentRecipients,
  estimateSegmentCount,
  renderForRecipient,
  sendCampaign,
  scheduleCampaign,
  cancelScheduledCampaign,
} = require('../services/emailCampaignService');
const { ensureSubscriberForRecipient, unsubscribeByToken } = require('../services/subscriberService');
const { unsubscribeConfirmedPageHtml } = require('../utils/marketingEmailTemplates');
const { FRONTEND_URL, BRAND_NAME } = require('../services/shareMessageService');

// ============================================================
// CAMPAIGNS (admin)
// ============================================================

// @desc    List all campaigns
// @route   GET /api/marketing/email/campaigns?status=
const getAllCampaigns = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const filter = {};
  if (status) filter.status = status;
  const campaigns = await EmailCampaign.find(filter).sort('-createdAt');
  res.json({ success: true, count: campaigns.length, campaigns });
});

const getCampaignById = asyncHandler(async (req, res) => {
  const campaign = await EmailCampaign.findById(req.params.id);
  if (!campaign) {
    res.status(404);
    throw new Error('Campaign not found');
  }
  res.json({ success: true, campaign });
});

// @desc    Create a draft campaign
// @route   POST /api/marketing/email/campaigns
const createCampaign = asyncHandler(async (req, res) => {
  const {
    name, subject, previewText, fromName, contentType, heroImageUrl, bodyHtml,
    ctaText, ctaUrl, recommendedProductCount, segment,
  } = req.body;

  if (!name || !subject || !segment || !segment.type) {
    res.status(400);
    throw new Error('name, subject, and a segment are required');
  }

  const campaign = await EmailCampaign.create({
    name, subject,
    previewText: previewText || '',
    fromName: fromName || BRAND_NAME,
    contentType: contentType || 'custom',
    heroImageUrl: heroImageUrl || '',
    bodyHtml: bodyHtml || '',
    ctaText: ctaText || 'Shop Now',
    ctaUrl: ctaUrl || '',
    recommendedProductCount: recommendedProductCount ?? 4,
    segment,
    createdBy: req.user._id,
  });

  res.status(201).json({ success: true, campaign });
});

const updateCampaign = asyncHandler(async (req, res) => {
  const campaign = await EmailCampaign.findById(req.params.id);
  if (!campaign) {
    res.status(404);
    throw new Error('Campaign not found');
  }
  if (!['draft', 'scheduled'].includes(campaign.status)) {
    res.status(400);
    throw new Error('Only draft or scheduled campaigns can be edited');
  }

  const editable = [
    'name', 'subject', 'previewText', 'fromName', 'contentType', 'heroImageUrl',
    'bodyHtml', 'ctaText', 'ctaUrl', 'recommendedProductCount', 'segment',
  ];
  editable.forEach((f) => {
    if (req.body[f] !== undefined) campaign[f] = req.body[f];
  });

  await campaign.save();
  res.json({ success: true, campaign });
});

const deleteCampaign = asyncHandler(async (req, res) => {
  const campaign = await EmailCampaign.findById(req.params.id);
  if (!campaign) {
    res.status(404);
    throw new Error('Campaign not found');
  }
  if (campaign.status === 'sending') {
    res.status(400);
    throw new Error('Cannot delete a campaign that is currently sending');
  }
  await campaign.deleteOne();
  await EmailSendLog.deleteMany({ campaign: campaign._id });
  res.json({ success: true, message: 'Campaign deleted' });
});

// @desc    Live recipient-count estimate while building a campaign
// @route   POST /api/marketing/email/campaigns/estimate-segment
const estimateSegment = asyncHandler(async (req, res) => {
  const { segment } = req.body;
  if (!segment || !segment.type) {
    res.status(400);
    throw new Error('segment is required');
  }
  const count = await estimateSegmentCount(segment);
  res.json({ success: true, count });
});

// @desc    Render a real preview of the email, using a real or synthetic subscriber
// @route   GET /api/marketing/email/campaigns/:id/preview
const previewCampaign = asyncHandler(async (req, res) => {
  const campaign = await EmailCampaign.findById(req.params.id);
  if (!campaign) {
    res.status(404);
    throw new Error('Campaign not found');
  }

  // Prefer a real subscriber with some history so the preview shows real
  // recommended products; fall back to a synthetic one otherwise.
  let subscriber =
    (await EmailSubscriber.findOne({ 'viewedProducts.0': { $exists: true } })) ||
    (await EmailSubscriber.findOne({ 'searchHistory.0': { $exists: true } })) ||
    (await EmailSubscriber.findOne());

  if (!subscriber) {
    subscriber = new EmailSubscriber({
      email: req.user.email || 'preview@example.com',
      name: req.user.name || 'Preview User',
      unsubscribeToken: 'preview-token',
    });
  }

  const html = await renderForRecipient(campaign, subscriber);
  res.set('Content-Type', 'text/html');
  res.send(html);
});

// @desc    Send a campaign immediately
// @route   POST /api/marketing/email/campaigns/:id/send-now
const sendNow = asyncHandler(async (req, res) => {
  // Kick off in the background so the request returns immediately — bulk
  // sends of thousands of recipients could otherwise time out the request.
  sendCampaign(req.params.id).catch((err) => console.error('Campaign send failed:', err.message));
  res.json({ success: true, message: 'Campaign is sending now — refresh in a moment to see live stats.' });
});

// @desc    Schedule a campaign for a future date/time
// @route   PATCH /api/marketing/email/campaigns/:id/schedule
const scheduleCampaignRoute = asyncHandler(async (req, res) => {
  const { scheduledAt } = req.body;
  if (!scheduledAt) {
    res.status(400);
    throw new Error('scheduledAt is required');
  }
  if (new Date(scheduledAt).getTime() <= Date.now()) {
    res.status(400);
    throw new Error('scheduledAt must be in the future');
  }
  const campaign = await scheduleCampaign(req.params.id, scheduledAt);
  res.json({ success: true, campaign });
});

const cancelScheduled = asyncHandler(async (req, res) => {
  const campaign = await cancelScheduledCampaign(req.params.id);
  res.json({ success: true, campaign });
});

const duplicateCampaign = asyncHandler(async (req, res) => {
  const source = await EmailCampaign.findById(req.params.id);
  if (!source) {
    res.status(404);
    throw new Error('Campaign not found');
  }
  const copy = await EmailCampaign.create({
    name: `${source.name} (copy)`,
    subject: source.subject,
    previewText: source.previewText,
    fromName: source.fromName,
    contentType: source.contentType,
    heroImageUrl: source.heroImageUrl,
    bodyHtml: source.bodyHtml,
    ctaText: source.ctaText,
    ctaUrl: source.ctaUrl,
    recommendedProductCount: source.recommendedProductCount,
    segment: source.segment,
    createdBy: req.user._id,
  });
  res.status(201).json({ success: true, campaign: copy });
});

// @desc    Per-recipient send log for a campaign
// @route   GET /api/marketing/email/campaigns/:id/logs
const getCampaignLogs = asyncHandler(async (req, res) => {
  const logs = await EmailSendLog.find({ campaign: req.params.id })
    .populate('subscriber', 'email name status')
    .sort('-createdAt')
    .limit(500);
  res.json({ success: true, count: logs.length, logs });
});

// ============================================================
// SUBSCRIBERS / CRM (admin)
// ============================================================

// @desc    List/search subscribers with their behavioural signal
// @route   GET /api/marketing/email/subscribers?search=&status=&role=&page=&limit=
const getAllSubscribers = asyncHandler(async (req, res) => {
  const { search, status, role, page = 1, limit = 25 } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (role) filter.role = role;
  if (search && search.trim()) {
    const regex = new RegExp(search.trim(), 'i');
    filter.$or = [{ email: regex }, { name: regex }];
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [subscribers, total] = await Promise.all([
    EmailSubscriber.find(filter).sort('-createdAt').skip(skip).limit(Number(limit)),
    EmailSubscriber.countDocuments(filter),
  ]);

  res.json({
    success: true,
    count: subscribers.length,
    total,
    page: Number(page),
    pages: Math.ceil(total / Number(limit)),
    subscribers,
  });
});

const getSubscriberById = asyncHandler(async (req, res) => {
  const subscriber = await EmailSubscriber.findById(req.params.id).populate('viewedProducts.product', 'name images finalPrice discountPercent');
  if (!subscriber) {
    res.status(404);
    throw new Error('Subscriber not found');
  }
  res.json({ success: true, subscriber });
});

const updateSubscriberTags = asyncHandler(async (req, res) => {
  const subscriber = await EmailSubscriber.findById(req.params.id);
  if (!subscriber) {
    res.status(404);
    throw new Error('Subscriber not found');
  }
  if (req.body.tags !== undefined) subscriber.tags = req.body.tags;
  if (req.body.status !== undefined) subscriber.status = req.body.status;
  await subscriber.save();
  res.json({ success: true, subscriber });
});

const deleteSubscriber = asyncHandler(async (req, res) => {
  const subscriber = await EmailSubscriber.findByIdAndDelete(req.params.id);
  if (!subscriber) {
    res.status(404);
    throw new Error('Subscriber not found');
  }
  res.json({ success: true, message: 'Subscriber deleted' });
});

// @desc    Overview stats for the CRM dashboard
// @route   GET /api/marketing/email/subscribers/stats
const getSubscriberStats = asyncHandler(async (req, res) => {
  const [total, subscribed, guests, withSearchHistory, withViewHistory] = await Promise.all([
    EmailSubscriber.countDocuments(),
    EmailSubscriber.countDocuments({ status: 'subscribed' }),
    EmailSubscriber.countDocuments({ userId: null }),
    EmailSubscriber.countDocuments({ 'searchHistory.0': { $exists: true } }),
    EmailSubscriber.countDocuments({ 'viewedProducts.0': { $exists: true } }),
  ]);
  res.json({ success: true, total, subscribed, guests, withSearchHistory, withViewHistory });
});

// @desc    Top searched terms across all subscribers — feeds the "target by
//          search term" segment picker with real, currently-relevant terms.
// @route   GET /api/marketing/email/subscribers/top-searches
const getTopSearchTerms = asyncHandler(async (req, res) => {
  const results = await EmailSubscriber.aggregate([
    { $unwind: '$searchHistory' },
    { $group: { _id: '$searchHistory.term', totalCount: { $sum: '$searchHistory.count' }, subscribers: { $sum: 1 } } },
    { $sort: { subscribers: -1 } },
    { $limit: 25 },
  ]);
  res.json({ success: true, terms: results });
});

// ============================================================
// WHATSAPP STATUS / GROUP PROMO GENERATOR (admin)
// ============================================================

// @desc    Generate ready-to-post WhatsApp Status/group promo content
//          (multiple caption variants + an image), optionally tied to a product.
// @route   POST /api/marketing/email/whatsapp-promo/generate
const generateWhatsappPromo = asyncHandler(async (req, res) => {
  const { productId, customMessage, imageUrl } = req.body;

  let product = null;
  if (productId) {
    product = await Product.findById(productId).select('name images finalPrice discountPercent');
  }

  const link = product ? `${FRONTEND_URL}/product-detail.html?id=${product._id}` : FRONTEND_URL;
  const image = imageUrl || product?.images?.[0] || '';

  const price = product?.finalPrice
    ? (product.discountPercent
        ? Math.round(product.finalPrice * (1 - product.discountPercent / 100))
        : product.finalPrice)
    : null;

  const variants = [];

  if (customMessage) {
    variants.push(`${customMessage}\n\n${link}`);
  }

  if (product) {
    variants.push(
      `🔥 *${product.name}*${price ? ` — now KSh ${price.toLocaleString()}` : ''}\n` +
      `${product.discountPercent ? `🏷️ ${product.discountPercent}% OFF — limited stock!\n` : ''}` +
      `Shop now on ${BRAND_NAME} 👇\n${link}`
    );
    variants.push(
      `✨ Just landed on ${BRAND_NAME}: *${product.name}*\n` +
      `${price ? `Only KSh ${price.toLocaleString()}. ` : ''}Tap to grab yours before it's gone!\n${link}`
    );
    variants.push(
      `📦 Deal of the day!\n*${product.name}*${price ? ` — KSh ${price.toLocaleString()}` : ''}\n` +
      `Order directly here: ${link}`
    );
  } else {
    variants.push(`🛍️ Discover great deals on ${BRAND_NAME}! Shop quality products with fast delivery.\n${link}`);
    variants.push(`✨ New arrivals just dropped on ${BRAND_NAME}. Come take a look 👇\n${link}`);
  }

  const promo = await WhatsappPromo.create({
    title: product ? product.name : (customMessage || 'General promo'),
    imageUrl: image,
    captions: variants,
    product: product ? product._id : null,
    link,
    createdBy: req.user._id,
  });

  res.status(201).json({ success: true, promo });
});

const getWhatsappPromos = asyncHandler(async (req, res) => {
  const promos = await WhatsappPromo.find().populate('product', 'name images').sort('-createdAt').limit(50);
  res.json({ success: true, count: promos.length, promos });
});

const deleteWhatsappPromo = asyncHandler(async (req, res) => {
  await WhatsappPromo.findByIdAndDelete(req.params.id);
  res.json({ success: true, message: 'Promo removed' });
});

// ============================================================
// PUBLIC — unsubscribe / open-tracking / click-tracking
// (No auth: these links are clicked directly from an email inbox.)
// ============================================================

// @route   GET /api/marketing/email/unsubscribe/:token
const unsubscribe = asyncHandler(async (req, res) => {
  const subscriber = await unsubscribeByToken(req.params.token);
  res.set('Content-Type', 'text/html');
  res.send(unsubscribeConfirmedPageHtml({ email: subscriber?.email }));
});

// @route   GET /api/marketing/email/open/:token.png  (1x1 tracking pixel)
const trackOpen = asyncHandler(async (req, res) => {
  const token = (req.params.token || '').replace(/\.png$/i, '');
  EmailSendLog.findOne({ trackingToken: token }).then(async (log) => {
    if (log && log.status !== 'opened' && log.status !== 'clicked') {
      log.status = 'opened';
      log.openedAt = new Date();
      await log.save();
      await EmailCampaign.findByIdAndUpdate(log.campaign, { $inc: { 'stats.opened': 1 } });
      await EmailSubscriber.findByIdAndUpdate(log.subscriber, { $inc: { emailsOpenedCount: 1 } });
    }
  }).catch(() => {});

  const pixel = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7',
    'base64'
  );
  res.set('Content-Type', 'image/gif');
  res.send(pixel);
});

// @route   GET /api/marketing/email/click/:token?redirect=<url>
const trackClick = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const redirectUrl = req.query.redirect || FRONTEND_URL;

  const log = await EmailSendLog.findOne({ trackingToken: token });
  if (log && log.status !== 'clicked') {
    log.status = 'clicked';
    log.clickedAt = new Date();
    await log.save();
    await EmailCampaign.findByIdAndUpdate(log.campaign, { $inc: { 'stats.clicked': 1 } });
    await EmailSubscriber.findByIdAndUpdate(log.subscriber, { $inc: { emailsClickedCount: 1 } });
  }

  res.redirect(decodeURIComponent(redirectUrl));
});

module.exports = {
  // campaigns
  getAllCampaigns,
  getCampaignById,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  estimateSegment,
  previewCampaign,
  sendNow,
  scheduleCampaignRoute,
  cancelScheduled,
  duplicateCampaign,
  getCampaignLogs,
  // subscribers / CRM
  getAllSubscribers,
  getSubscriberById,
  updateSubscriberTags,
  deleteSubscriber,
  getSubscriberStats,
  getTopSearchTerms,
  // whatsapp
  generateWhatsappPromo,
  getWhatsappPromos,
  deleteWhatsappPromo,
  // public
  unsubscribe,
  trackOpen,
  trackClick,
};