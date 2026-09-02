/* ============================================================
   SIX STAR SUPPLIERS — Dynamic Shipping quote endpoint
   Public: used by checkout.html to get a LIVE shipping fee as the cart
   changes, using the exact same calculation utils/shippingFeeCalculator.js
   will (once wired) use again, authoritatively, inside orderController's
   createOrder — so the quote shown to the buyer is never a different
   number from what actually gets charged.
   ============================================================ */

const express = require('express');
const router = express.Router();
const asyncHandler = require('express-async-handler');
const { calculateDynamicShippingFee } = require('../utils/shippingFeeCalculator');
const { getActiveWeightTiers } = require('../controllers/weightTierController');

// GET /api/shipping/weight-tiers — public, active tiers only (for any
// frontend that wants to show "shipping bands" informationally).
router.get('/weight-tiers', getActiveWeightTiers);

// POST /api/shipping/quote
// body: { lines: [{ productId, quantity }] }
router.post(
  '/quote',
  asyncHandler(async (req, res) => {
    const { lines } = req.body;
    if (!Array.isArray(lines)) {
      res.status(400);
      throw new Error('lines must be an array of { productId, quantity }');
    }
    const result = await calculateDynamicShippingFee(lines);
    res.json({ success: true, ...result });
  })
);

module.exports = router;