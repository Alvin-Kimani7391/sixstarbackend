const EmailCampaign = require('../models/EmailCampaign');
const EmailSubscriber = require('../models/EmailSubscriber');
const EmailSendLog = require('../models/EmailSendLog');
const Product = require('../models/Product');
const { User } = require('../models/User');
const sendEmail = require('../utils/sendEmail');
const { promotionalCampaignTemplate } = require('../utils/marketingEmailTemplates');
const { getRecommendedProducts } = require('./recommendationService');
const { ensureSubscriberForRecipient } = require('./subscriberService');

// ------------------------------------------------------------------
// API_BASE normalization
//
// Every click/open/unsubscribe link in a sent email is built by
// prefixing a path with API_BASE, and the routes for those links are
// mounted at /api/marketing/email/... (see server.js). If the
// API_PUBLIC_URL / BACKEND_URL env var on Render doesn't itself end
// in "/api", every link in every email silently 404s with
// "Route not found - /marketing/email/click/...".
//
// This normalizes whatever's in the env var so it's always correct,
// without depending on Render's env config being exactly right.
// ------------------------------------------------------------------
function normalizeApiBase(rawUrl) {
  const fallback = 'https://sixstarbackend.onrender.com/api';
  let url = (rawUrl || fallback).trim().replace(/\/+$/, '');
  if (!/\/api$/i.test(url)) url += '/api';
  return url;
}

const API_BASE = normalizeApiBase(process.env.API_PUBLIC_URL || process.env.BACKEND_URL);
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://www.sixstarsuppliers.com';

// ------------------------------------------------------------------
// SEGMENT RESOLUTION
// Returns an array of { email, name, userId, role } — deduplicated by
// email. Every recipient is then given/kept exactly one EmailSubscriber
// record (see ensureSubscriberForRecipient) so unsubscribe + tracking
// work uniformly whether they came from a signed-up account or not.
// ------------------------------------------------------------------
async function resolveSegmentRecipients(segment) {
  const out = new Map();
  const add = (email, name, userId, role) => {
    email = (email || '').trim().toLowerCase();
    if (!email || out.has(email)) return;
    out.set(email, { email, name: name || '', userId: userId || null, role: role || 'guest' });
  };

  switch (segment.type) {
    case 'buyers': {
      const users = await User.find({ role: 'buyer', isActive: true }).select('email name');
      users.forEach((u) => add(u.email, u.name, u._id, 'buyer'));
      break;
    }
    case 'sellers': {
      const users = await User.find({ role: { $in: ['wholesaler', 'retailer'] }, isActive: true }).select('email name role');
      users.forEach((u) => add(u.email, u.name, u._id, u.role));
      break;
    }
    case 'guests': {
      const subs = await EmailSubscriber.find({ status: 'subscribed', userId: null }).select('email name');
      subs.forEach((s) => add(s.email, s.name));
      break;
    }
    case 'searched_term': {
      const term = String(segment.value || '').trim().toLowerCase();
      if (term) {
        const subs = await EmailSubscriber.find({ status: 'subscribed', 'searchHistory.term': term }).select('email name userId role');
        subs.forEach((s) => add(s.email, s.name, s.userId, s.role));
      }
      break;
    }
    case 'viewed_category': {
      const categoryId = segment.value;
      if (categoryId) {
        const productIds = (await Product.find({ category: categoryId }).select('_id')).map((p) => p._id);
        const subs = await EmailSubscriber.find({
          status: 'subscribed',
          'viewedProducts.product': { $in: productIds },
        }).select('email name userId role');
        subs.forEach((s) => add(s.email, s.name, s.userId, s.role));
      }
      break;
    }
    case 'custom_emails': {
      const list = Array.isArray(segment.value) ? segment.value : String(segment.value || '').split(/[\s,;]+/);
      list.filter(Boolean).forEach((e) => add(e, ''));
      break;
    }
    case 'all_subscribers':
    default: {
      const subs = await EmailSubscriber.find({ status: 'subscribed' }).select('email name userId role');
      subs.forEach((s) => add(s.email, s.name, s.userId, s.role));
      break;
    }
  }

  return Array.from(out.values());
}

// Lightweight count-only version for the admin UI's "recipient preview"
// (avoids materializing full recipient objects for very large segments).
async function estimateSegmentCount(segment) {
  switch (segment.type) {
    case 'buyers':
      return User.countDocuments({ role: 'buyer', isActive: true });
    case 'sellers':
      return User.countDocuments({ role: { $in: ['wholesaler', 'retailer'] }, isActive: true });
    case 'guests':
      return EmailSubscriber.countDocuments({ status: 'subscribed', userId: null });
    case 'searched_term':
      return EmailSubscriber.countDocuments({ status: 'subscribed', 'searchHistory.term': String(segment.value || '').trim().toLowerCase() });
    case 'viewed_category': {
      if (!segment.value) return 0;
      const productIds = (await Product.find({ category: segment.value }).select('_id')).map((p) => p._id);
      return EmailSubscriber.countDocuments({ status: 'subscribed', 'viewedProducts.product': { $in: productIds } });
    }
    case 'custom_emails': {
      const list = Array.isArray(segment.value) ? segment.value : String(segment.value || '').split(/[\s,;]+/);
      return list.filter(Boolean).length;
    }
    case 'all_subscribers':
    default:
      return EmailSubscriber.countDocuments({ status: 'subscribed' });
  }
}

// Renders the final HTML for one recipient (used both for real sends and
// for the admin's "Preview" button). Pass `log` (an EmailSendLog document,
// already saved so it has a trackingToken) to wire up real open/click
// tracking — omit it for previews where tracking isn't meaningful.
async function renderForRecipient(campaign, subscriber, log = null) {
  let recommendedProducts = [];
  const wantsRecs =
    campaign.contentType === 'auto_recommendation' ||
    /\{\{\s*recommended_products\s*\}\}/i.test(campaign.bodyHtml || '');
  if (wantsRecs && campaign.recommendedProductCount > 0) {
    recommendedProducts = await getRecommendedProducts(subscriber, campaign.recommendedProductCount);
  }

  const unsubscribeUrl = `${API_BASE}/marketing/email/unsubscribe/${subscriber.unsubscribeToken}`;
  const clickTrackingBaseUrl = log ? `${API_BASE}/marketing/email/click/${log.trackingToken}` : null;
  const openPixelUrl = log ? `${API_BASE}/marketing/email/open/${log.trackingToken}.png` : null;

  return promotionalCampaignTemplate({
    campaign,
    subscriber,
    recommendedProducts,
    unsubscribeUrl,
    clickTrackingBaseUrl,
    openPixelUrl,
  });
}

// Sends immediately (also used by the scheduler once scheduledAt is due).
// Runs in small batches with a short delay between each to stay friendly
// to the transactional email provider's rate limits.
async function sendCampaign(campaignId) {
  const campaign = await EmailCampaign.findById(campaignId);
  if (!campaign) throw new Error('Campaign not found');
  if (!['draft', 'scheduled'].includes(campaign.status)) {
    throw new Error(`Campaign is already ${campaign.status}`);
  }

  campaign.status = 'sending';
  await campaign.save();

  try {
    const recipients = await resolveSegmentRecipients(campaign.segment);
    campaign.stats.totalRecipients = recipients.length;
    await campaign.save();

    const BATCH_SIZE = 20;
    const DELAY_MS = 800;

    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      const batch = recipients.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (r) => {
          try {
            const subscriber = await ensureSubscriberForRecipient(r);
            if (!subscriber || subscriber.status === 'unsubscribed') return;

            const log = await EmailSendLog.create({
              campaign: campaign._id,
              subscriber: subscriber._id,
              email: subscriber.email,
              status: 'queued',
            });

            const html = await renderForRecipient(campaign, subscriber, log);

            await sendEmail({
              to: subscriber.email,
              subject: campaign.subject,
              html,
              sender: 'info',
            });

            log.status = 'sent';
            log.sentAt = new Date();
            await log.save();

            subscriber.emailsSentCount += 1;
            subscriber.lastEmailSentAt = new Date();
            await subscriber.save();

            campaign.stats.sent += 1;
          } catch (err) {
            campaign.stats.failed += 1;
            console.error(`Campaign ${campaign._id} send failed for ${r.email}:`, err.body || err.message);
          }
        })
      );
      await campaign.save();
      if (i + BATCH_SIZE < recipients.length) await new Promise((res) => setTimeout(res, DELAY_MS));
    }

    campaign.status = 'sent';
    campaign.sentAt = new Date();
    await campaign.save();
  } catch (err) {
    campaign.status = 'failed';
    campaign.lastError = err.message;
    await campaign.save();
    throw err;
  }

  return campaign;
}

async function scheduleCampaign(campaignId, scheduledAt) {
  const campaign = await EmailCampaign.findById(campaignId);
  if (!campaign) throw new Error('Campaign not found');
  if (!['draft', 'scheduled'].includes(campaign.status)) {
    throw new Error(`Cannot schedule a campaign that is already ${campaign.status}`);
  }
  campaign.scheduledAt = new Date(scheduledAt);
  campaign.status = 'scheduled';
  await campaign.save();
  return campaign;
}

async function cancelScheduledCampaign(campaignId) {
  const campaign = await EmailCampaign.findById(campaignId);
  if (!campaign) throw new Error('Campaign not found');
  if (campaign.status !== 'scheduled') throw new Error('Only scheduled campaigns can be cancelled');
  campaign.status = 'cancelled';
  campaign.scheduledAt = null;
  await campaign.save();
  return campaign;
}

module.exports = {
  resolveSegmentRecipients,
  estimateSegmentCount,
  renderForRecipient,
  sendCampaign,
  scheduleCampaign,
  cancelScheduledCampaign,
  FRONTEND_URL,
  API_BASE,
};