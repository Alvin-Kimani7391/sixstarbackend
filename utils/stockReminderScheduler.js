const { recheckAllLowStockProducts } = require('./stockReminderService');

const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // sweep every 6 hours
const REMINDER_COOLDOWN_HOURS = 24; // don't re-email the same low-stock product more than once/day

function startStockReminderScheduler() {
  const run = async () => {
    try {
      const count = await recheckAllLowStockProducts(REMINDER_COOLDOWN_HOURS);
      if (count > 0) console.log(`Stock reminder scheduler: sent ${count} low-stock reminder(s)`);
    } catch (err) {
      console.error('Stock reminder scheduler failed:', err.message);
    }
  };

  run(); // also do an initial pass on boot
  setInterval(run, RECHECK_INTERVAL_MS);
}

module.exports = { startStockReminderScheduler };