/**
 * RFQ background scheduler.
 *
 * Mirrors the pattern used by utils/flashSaleScheduler.js: a simple
 * setInterval loop rather than a separate cron dependency, since the app
 * already runs as one long-lived Node process on Render.
 *
 * Two jobs, both idempotent:
 *   1. Expire RFQs whose expiresAt has passed but are still OPEN/BIDDING.
 *   2. Send a one-time "closing soon" reminder ~24h before expiresAt.
 *
 * Wire up in server.js, AFTER the DB connects:
 *   const { startRFQScheduler } = require('./utils/rfqScheduler');
 *   startRFQScheduler();
 */

const RFQRequest = require('../models/RFQRequest');
const { User } = require('../models/User');
const safeSendEmail = require('./safeSendEmail');
const { rfqDeadlineReminderTemplate } = require('./emailTemplates.rfq');

const CHECK_INTERVAL_MS = 15 * 60 * 1000; // every 15 minutes
const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000; // remind when <24h remain

async function expireOverdueRFQs() {
  const overdue = await RFQRequest.find({
    status: { $in: ['OPEN', 'BIDDING'] },
    expiresAt: { $lte: new Date() },
  });

  for (const rfq of overdue) {
    rfq.status = 'EXPIRED';
    await rfq.save();
  }

  if (overdue.length) {
    console.log(`RFQ scheduler: expired ${overdue.length} request(s)`);
  }
}

async function sendDeadlineReminders() {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_MS);

  const dueSoon = await RFQRequest.find({
    status: { $in: ['OPEN', 'BIDDING'] },
    expiresAt: { $gt: now, $lte: windowEnd },
    deadlineReminderSentAt: null,
  }).populate('buyer', 'name email');

  for (const rfq of dueSoon) {
    if (rfq.buyer?.email) {
      safeSendEmail(
        {
          to: rfq.buyer.email,
          subject: `Closing Soon - ${rfq.productName}`,
          html: rfqDeadlineReminderTemplate({ rfq, buyerName: rfq.buyer.name }),
        },
        'RFQ deadline reminder'
      );
    }
    rfq.deadlineReminderSentAt = new Date();
    await rfq.save();
  }
}

function startRFQScheduler() {
  const runAll = async () => {
    try {
      await expireOverdueRFQs();
      await sendDeadlineReminders();
    } catch (err) {
      console.error('RFQ scheduler error:', err.message);
    }
  };

  runAll(); // run once on boot so nothing waits a full interval after a deploy
  setInterval(runAll, CHECK_INTERVAL_MS);
  console.log('RFQ scheduler started (checking every 15 minutes)');
}

module.exports = { startRFQScheduler, expireOverdueRFQs, sendDeadlineReminders };