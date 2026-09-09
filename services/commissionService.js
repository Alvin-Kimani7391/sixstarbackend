const Agent = require('../models/Agent');
const Commission = require('../models/Commission');
const { User } = require('../models/User');
const { notifyAgent } = require('./notificationService');
const { evaluateAgentBadge } = require('./badgeEvaluationService');
const { checkAchievementsForAgent } = require('./achievementService');
const { advanceSellerLeadStage } = require('./leadService');

// ============================================================
// The commission engine (spec §43-54, §81). Independent of the OLD
// checkout-time order.agent/order.commissionAmount flat-fee flow, which is
// left completely untouched. This engine keys off the NEW account-level
// User.referredBy (set by authController.registerUser — see Phase 1), so a
// buyer-referral and a seller-referral commission can exist on the same
// order at the same time, attributed to two different agents.
// ============================================================

function computeOrderMarketplaceProfit(order) {
  return (order.items || []).reduce((sum, i) => sum + (Number(i.commissionAmount) || 0), 0);
}

function computeSellerShareOfOrder(order, sellerId) {
  return (order.items || [])
    .filter((i) => String(i.seller) === String(sellerId))
    .reduce((sum, i) => sum + (Number(i.commissionAmount) || 0), 0);
}

async function resolveCommissionRate(agent, referralType) {
  const CommissionRule = require('../models/CommissionRule'); // lazy require avoids circular init order issues
  const audience = referralType === 'buyer' ? 'buyer_referral' : 'seller_referral';

  const rules = await CommissionRule.find({ audience, isActive: true }).sort('-priority');
  const specific = rules.find((r) => r.badge && String(r.badge) === String(agent.badge));
  if (specific) return specific.commissionRate;

  const generic = rules.find((r) => !r.badge);
  if (generic) return generic.commissionRate;

  return agent.commissionRate || 0;
}

// ---------- Called when an order's payment is confirmed ----------
async function onOrderPaymentConfirmed(order) {
  if (!order) return;

  // Buyer-referral commission — whole-order marketplace profit.
  const buyerUser = await User.findById(order.buyer).select('referredBy name email');
  if (buyerUser?.referredBy?.agent) {
    const already = await Commission.findOne({ order: order._id, agent: buyerUser.referredBy.agent, referralType: 'buyer_referral' });
    if (!already) {
      const agent = await Agent.findById(buyerUser.referredBy.agent);
      if (agent && agent.isActive) {
        const profit = computeOrderMarketplaceProfit(order);
        const rate = await resolveCommissionRate(agent, 'buyer');
        const amount = Math.round(profit * (rate / 100));

        await Commission.create({
          agent: agent._id,
          order: order._id,
          referralType: 'buyer_referral',
          buyer: buyerUser._id,
          saleAmount: order.totalAmount,
          marketplaceProfit: profit,
          badge: agent.badge,
          commissionRate: rate,
          commissionAmount: amount,
          status: 'pending',
        });

        notifyAgent(agent._id, {
          type: 'commission_pending',
          title: 'New commission pending',
          message: `A buyer you referred placed order ${order.orderNumber}. Commission will confirm on delivery.`,
        });
      }
    }
  }

  // Seller-referral commission(s) — one per unique referred seller on this order.
  const sellerIds = [...new Set((order.items || []).map((i) => String(i.seller)))];
  for (const sellerId of sellerIds) {
    const sellerUser = await User.findById(sellerId).select('referredBy name email');
    if (!sellerUser?.referredBy?.agent) continue;

    const already = await Commission.findOne({ order: order._id, agent: sellerUser.referredBy.agent, referralType: 'seller_referral', seller: sellerId });
    if (already) continue;

    const agent = await Agent.findById(sellerUser.referredBy.agent);
    if (!agent || !agent.isActive) continue;

    const profit = computeSellerShareOfOrder(order, sellerId);
    const rate = await resolveCommissionRate(agent, 'seller');
    const amount = Math.round(profit * (rate / 100));

    await Commission.create({
      agent: agent._id,
      order: order._id,
      referralType: 'seller_referral',
      seller: sellerId,
      saleAmount: order.totalAmount,
      marketplaceProfit: profit,
      badge: agent.badge,
      commissionRate: rate,
      commissionAmount: amount,
      status: 'pending',
    });

    notifyAgent(agent._id, {
      type: 'commission_pending',
      title: 'New commission pending',
      message: `A sale went through for a seller you recruited (order ${order.orderNumber}). Commission will confirm on delivery.`,
    });
  }
}

// ---------- Called when an order's status becomes 'delivered' ----------
async function onOrderDelivered(order) {
  if (!order) return;
  const commissions = await Commission.find({ order: order._id, status: { $in: ['pending', 'processing'] } });

  for (const c of commissions) {
    // Recompute at delivery time in case admin adjusted pricing after creation.
    const profit = c.referralType === 'buyer_referral' ? computeOrderMarketplaceProfit(order) : computeSellerShareOfOrder(order, c.seller);
    const amount = Math.round(profit * (c.commissionRate / 100));

    c.marketplaceProfit = profit;
    c.commissionAmount = amount;
    c.status = 'confirmed';
    c.deliveredAt = new Date();
    c.confirmedAt = new Date();
    await c.save();

    const agent = await Agent.findById(c.agent);
    if (agent) {
      agent.totalCommission = (agent.totalCommission || 0) + amount;
      agent.lifetimeMarketplaceProfit = (agent.lifetimeMarketplaceProfit || 0) + profit;
      agent.totalOrders = (agent.totalOrders || 0) + 1;
      await agent.save();

      notifyAgent(agent._id, {
        type: 'commission_confirmed',
        title: 'Commission confirmed',
        message: `KES ${amount.toLocaleString()} confirmed for order ${order.orderNumber}.`,
      });

      await evaluateAgentBadge(agent._id);
      await checkAchievementsForAgent(agent._id);

      if (c.referralType === 'seller_referral') {
        advanceSellerLeadStage(c.seller, 'first_sale').catch(() => {});
      }
    }
  }
}

// ---------- Called when an order is cancelled or its payment is rejected before delivery ----------
async function onOrderCancelled(order) {
  if (!order) return;
  await Commission.updateMany(
    { order: order._id, status: { $in: ['pending', 'processing'] } },
    { $set: { status: 'cancelled' } }
  );
}

// ---------- Called when a delivered/confirmed order is later refunded/returned ----------
async function onOrderRefunded(order) {
  if (!order) return;
  const commissions = await Commission.find({ order: order._id, status: 'confirmed' });

  for (const c of commissions) {
    c.status = 'reversed';
    await c.save();

    const agent = await Agent.findById(c.agent);
    if (agent) {
      agent.totalCommission = Math.max(0, (agent.totalCommission || 0) - c.commissionAmount);
      await agent.save();

      notifyAgent(agent._id, {
        type: 'commission_reversed',
        title: 'Commission reversed',
        message: `The commission for order ${order.orderNumber} was reversed following a refund/return.`,
      });
    }
  }
}

// ---------- Manual admin adjustment (spec §69) ----------
async function applyManualAdjustment({ agentId, amount, reason, adminId }) {
  const CommissionAdjustment = require('../models/CommissionAdjustment');
  const agent = await Agent.findById(agentId);
  if (!agent) throw new Error('Agent not found');

  const adjustment = await CommissionAdjustment.create({ agent: agentId, amount, reason, addedBy: adminId });

  agent.totalCommission = Math.max(0, (agent.totalCommission || 0) + amount);
  await agent.save();

  notifyAgent(agentId, {
    type: 'commission_adjustment',
    title: amount >= 0 ? 'Bonus added to your account' : 'Commission adjustment applied',
    message: `KES ${Math.abs(amount).toLocaleString()} ${amount >= 0 ? 'added' : 'deducted'} — ${reason}`,
  });

  return adjustment;
}

module.exports = {
  onOrderPaymentConfirmed,
  onOrderDelivered,
  onOrderCancelled,
  onOrderRefunded,
  applyManualAdjustment,
  resolveCommissionRate,
  computeOrderMarketplaceProfit,
};