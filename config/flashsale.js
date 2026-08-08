/* ============================================================
   Flash Sale timing rules — single source of truth so the
   controller, scheduler, and any future admin tooling can't
   drift out of sync with each other.
   ============================================================ */

module.exports = {
  // The Flash Sale window opens at 2:00 PM (server local time) every day...
  FLASH_SALE_START_HOUR: 14,
  // ...and always runs until midnight of the same calendar day.
  FLASH_SALE_END_HOUR: 24,
  // Sellers must submit at least this many hours before the 2:00 PM start.
  MIN_LEAD_TIME_HOURS: 24,
};