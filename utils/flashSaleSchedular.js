/* ============================================================
   SIX STAR SUPPLIERS — Flash Sale scheduler
   ============================================================
   Runs a lightweight setInterval tick (default every 60s) that
   keeps FlashSale.status in sync with the real clock:

     scheduled -> active    when now enters [startAt, endAt]
     scheduled/active -> ended   when now passes endAt (midnight)
     active -> sold_out     defensive backstop in case a sale
                             sold out without recordFlashSaleSale()
                             being called (e.g. order flow not
                             yet wired to it)

   No extra npm package needed (no node-cron) — just call
   startFlashSaleScheduler() once, after your DB connection is
   established, from server.js:

     const { startFlashSaleScheduler } = require('./utils/flashSaleScheduler');
     mongoose.connect(...).then(() => {
       startFlashSaleScheduler();
     });

   The public GET /api/flash-sales/active endpoint already
   re-derives "is this live right now?" from startAt/endAt on
   every call, so the storefront is correct even between ticks —
   this scheduler exists to keep the *stored* status (and
   therefore seller-dashboard badges, admin tables, etc.) accurate
   too, without every reader having to re-derive it themselves.
   ============================================================ */

const FlashSale = require('../models/FlashSale');

async function tickFlashSaleScheduler() {
  const now = new Date();

  try {
    await FlashSale.updateMany(
      { status: 'scheduled', startAt: { $lte: now }, endAt: { $gte: now } },
      { $set: { status: 'active' } }
    );

    await FlashSale.updateMany(
      { status: { $in: ['scheduled', 'active'] }, endAt: { $lt: now } },
      { $set: { status: 'ended' } }
    );

    await FlashSale.updateMany(
      { status: 'active', $expr: { $gte: ['$stockSold', '$stockAllocated'] } },
      { $set: { status: 'sold_out' } }
    );
  } catch (err) {
    console.error('Flash Sale scheduler tick failed:', err.message);
  }
}

function startFlashSaleScheduler({ intervalMs = 60 * 1000 } = {}) {
  // Run once immediately on boot, then on the interval.
  tickFlashSaleScheduler();
  const handle = setInterval(tickFlashSaleScheduler, intervalMs);
  console.log(`\u26A1 Flash Sale scheduler started (checking every ${intervalMs / 1000}s)`);
  return handle;
}

module.exports = { startFlashSaleScheduler, tickFlashSaleScheduler };