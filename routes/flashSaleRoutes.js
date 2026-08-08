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
} = require('../controllers/flashSaleController');
const { protect, authorize } = require('../middleware/authMiddleware');

// ---------- Public storefront ----------
// Powers a "Flash Sale" rail/page on the buyer-facing site — everything
// currently inside its 2:00 PM-midnight window with stock left.
router.get('/active', getActiveFlashSales);

// ---------- Seller-only ----------
// NOTE: '/my' is declared before any '/:id' style route so Express doesn't
// try to treat "my" as an id (same rule already used in productRoutes.js).
router.get('/my', protect, authorize('wholesaler', 'retailer'), getMyFlashSales);
router.post('/', protect, authorize('wholesaler', 'retailer'), submitFlashSale);
router.patch('/:id/cancel', protect, authorize('wholesaler', 'retailer'), cancelMyFlashSale);

module.exports = router;