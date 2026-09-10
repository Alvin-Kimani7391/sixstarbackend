const EmailCampaign = require('../models/EmailCampaign');
const { sendCampaign } = require('../services/emailCampaignService');

const SWEEP_INTERVAL_MS = 60 * 1000; // check every minute

async function sweepDueCampaigns() {
  try {
    const due = await EmailCampaign.find({
      status: 'scheduled',
      scheduledAt: { $lte: new Date() },
    }).select('_id');

    for (const c of due) {
      sendCampaign(c._id).catch((err) =>
        console.error(`[campaignScheduler] Failed to send campaign ${c._id}:`, err.message)
      );
    }
  } catch (err) {
    console.error('[campaignScheduler] Sweep error:', err.message);
  }
}

function startCampaignScheduler() {
  console.log('Campaign scheduler started (checking every 60s for due scheduled emails)');
  setInterval(sweepDueCampaigns, SWEEP_INTERVAL_MS);
  // also run once shortly after boot, in case something was due while the server was down
  setTimeout(sweepDueCampaigns, 10 * 1000);
}

module.exports = { startCampaignScheduler };