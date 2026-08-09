/* ============================================================
   SIX STAR SUPPLIERS — Flash Sale routes
   Mount in server.js with:
     app.use('/api/flash-sales', require('./routes/flashSaleRoutes'));
   ============================================================ */

const express = require('express');
const router = express.Router();
const {
  submitFlashSale,
  getMyFlashSales,
  cancelMyFlashSale,
  getActiveFlashSales,
  getTodayFlashSales, // <-- new
  getFlashSaleById,
} = require('../controllers/flashSaleController');
const { protect, authorize } = require('../middleware/authMiddleware');

// ---------- Public storefront ----------
// Powers a "Flash Sale" rail/page on the buyer-facing site — everything
// currently inside its 2:00 PM-midnight window with stock left.
// ---------- Public storefront ----------
router.get('/active', getActiveFlashSales);
router.get('/today', getTodayFlashSales);

// ---------- Seller-only ----------
router.get('/my', protect, authorize('wholesaler', 'retailer'), getMyFlashSales);
router.post('/', protect, authorize('wholesaler', 'retailer'), submitFlashSale);
router.patch('/:id/cancel', protect, authorize('wholesaler', 'retailer'), cancelMyFlashSale);

// ---------- Public: single Flash Sale by id ----------
// MUST come after /active, /today, /my so Express doesn't swallow them as an :id.
router.get('/:id', getFlashSaleById);

module.exports = router;