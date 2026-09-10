const express = require('express');
const router = express.Router();

const {
  getAllCampaigns, getCampaignById, createCampaign, updateCampaign, deleteCampaign,
  estimateSegment, previewCampaign, sendNow, scheduleCampaignRoute, cancelScheduled,
  duplicateCampaign, getCampaignLogs,
  getAllSubscribers, getSubscriberById, updateSubscriberTags, deleteSubscriber,
  getSubscriberStats, getTopSearchTerms,
  generateWhatsappPromo, getWhatsappPromos, deleteWhatsappPromo,
  unsubscribe, trackOpen, trackClick,
} = require('../controllers2/emailMarketingController');

const { protect, authorize } = require('../middleware/authMiddleware');

// ============================================================
// PUBLIC — these are clicked/loaded directly from inside an email, so they
// must stay above the admin auth gate below.
// ============================================================
router.get('/unsubscribe/:token', unsubscribe);
router.get('/open/:token.png', trackOpen); // Express param + literal ".png" both match via :token below
router.get('/open/:token', trackOpen); // fallback if the .png suffix is stripped by a client/proxy
router.get('/click/:token', trackClick);

// ============================================================
// ADMIN — everything below requires an authenticated admin
// ============================================================
router.use(protect, authorize('admin'));

// Campaigns
router.get('/campaigns', getAllCampaigns);
router.post('/campaigns', createCampaign);
router.post('/campaigns/estimate-segment', estimateSegment);
router.get('/campaigns/:id', getCampaignById);
router.patch('/campaigns/:id', updateCampaign);
router.delete('/campaigns/:id', deleteCampaign);
router.get('/campaigns/:id/preview', previewCampaign);
router.post('/campaigns/:id/send-now', sendNow);
router.patch('/campaigns/:id/schedule', scheduleCampaignRoute);
router.patch('/campaigns/:id/cancel', cancelScheduled);
router.post('/campaigns/:id/duplicate', duplicateCampaign);
router.get('/campaigns/:id/logs', getCampaignLogs);

// Subscribers / CRM
router.get('/subscribers/stats', getSubscriberStats);
router.get('/subscribers/top-searches', getTopSearchTerms);
router.get('/subscribers', getAllSubscribers);
router.get('/subscribers/:id', getSubscriberById);
router.patch('/subscribers/:id', updateSubscriberTags);
router.delete('/subscribers/:id', deleteSubscriber);

// WhatsApp Status/group promo generator
router.get('/whatsapp-promo', getWhatsappPromos);
router.post('/whatsapp-promo/generate', generateWhatsappPromo);
router.delete('/whatsapp-promo/:id', deleteWhatsappPromo);

module.exports = router;