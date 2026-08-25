// utils/paymentReaper.js
//
// Safety net: an STK order reserves stock the instant it's created, before
// the buyer has even seen the PIN prompt. If the attempt fails (wrong PIN,
// insufficient balance, timeout, cancel) or the buyer just abandons the tab,
// nothing else in the codebase ever gives that stock back. This sweep finds
// STK orders that have sat unpaid past an abandonment window and cancels
// them + restores stock, using the exact same restoration logic as a
// buyer-initiated cancelOrder().

const Order = require('../models/Order');
const Product = require('../models/Product');
const ProductVariant = require('../models/ProductVariant');
const FlashSale = require('../models/FlashSale');

const ABANDON_MINUTES = Number(process.env.STK_ABANDON_MINUTES || 20);
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

async function reapAbandonedStkOrders() {
  const cutoff = new Date(Date.now() - ABANDON_MINUTES * 60 * 1000);

  // Covers BOTH: orders where the webhook never even fired (still
  // pending_verification) AND orders where it fired with a failure
  // (rejected) but the buyer never retried successfully.
  const stale = await Order.find({
    paymentMethod: 'stk',
    paymentStatus: { $in: ['pending_verification', 'rejected'] },
    orderStatus: 'processing',
    createdAt: { $lt: cutoff },
  });

  for (const order of stale) {
    for (const item of order.items) {
      await Product.findByIdAndUpdate(item.product, { $inc: { stock: item.quantity } });
      if (item.variant) {
        await ProductVariant.findByIdAndUpdate(item.variant, { $inc: { stock: item.quantity } });
      }
      if (item.isFlashDeal && item.flashSale) {
        const restored = await FlashSale.findByIdAndUpdate(
          item.flashSale,
          { $inc: { stockSold: -item.quantity } },
          { new: true }
        );
        if (restored && restored.status === 'sold_out' && restored.stockSold < restored.stockAllocated) {
          const now = new Date();
          restored.status = restored.endAt < now ? 'ended' : restored.startAt <= now ? 'active' : 'scheduled';
          await restored.save();
        }
      }
    }
    order.orderStatus = 'cancelled';
    if (!order.rejectionReason) {
      order.rejectionReason = 'Payment was never completed in time — order auto-cancelled and stock released.';
    }
    await order.save();
    console.log(`[paymentReaper] auto-cancelled abandoned STK order ${order.orderNumber}`);
  }
}

function startPaymentReaper() {
  reapAbandonedStkOrders().catch((err) => console.error('[paymentReaper] initial sweep failed:', err));
  setInterval(() => {
    reapAbandonedStkOrders().catch((err) => console.error('[paymentReaper] sweep failed:', err));
  }, SWEEP_INTERVAL_MS);
}

module.exports = { startPaymentReaper, reapAbandonedStkOrders };