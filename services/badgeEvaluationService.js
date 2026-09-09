const Agent = require('../models/Agent');
const AgentBadge = require('../models/AgentBadge');
const safeSendEmail = require('../utils/safeSendEmail');
const { agentBadgeUpgradedTemplate } = require('../utils/emailTemplates');
const { notifyAgent } = require('./notificationService');

// Automatic badge-tier evaluation (spec §41-42), previously flagged as a
// manual-only feature in Phase 1. Only ever upgrades — never downgrades —
// matching how affiliate tiers are usually run.
async function evaluateAgentBadge(agentId) {
  const agent = await Agent.findById(agentId);
  if (!agent || !['approved', 'active'].includes(agent.status)) return null;

  const badges = await AgentBadge.find({ isActive: true }).sort('-sortOrder');
  const currentBadge = agent.badge ? await AgentBadge.findById(agent.badge) : null;
  const currentSort = currentBadge ? currentBadge.sortOrder : -1;

  for (const badge of badges) {
    if (badge.sortOrder <= currentSort) continue;
    const r = badge.requirements || {};

    const meets =
      agent.buyersReferred >= (r.minBuyerReferrals || 0) &&
      agent.sellersReferred >= (r.minSellerReferrals || 0) &&
      agent.approvedSellersReferred >= (r.minApprovedSellers || 0) &&
      agent.totalCommission >= (r.minConfirmedCommission || 0) &&
      agent.lifetimeMarketplaceProfit >= (r.minMarketplaceProfit || 0);

    if (meets) {
      agent.badge = badge._id;
      agent.commissionRate = badge.commissionRate;
      agent.badgeAssignedAt = new Date();
      await agent.save();

      notifyAgent(agent._id, {
        type: 'badge_upgrade',
        title: `You've been upgraded to ${badge.name} Agent 🎉`,
        message: `Your commission rate is now ${badge.commissionRate}%.`,
      });

      if (agent.email) {
        safeSendEmail(
          {
            to: agent.email,
            subject: `You've Been Upgraded to ${badge.name} Agent 🎉`,
            html: agentBadgeUpgradedTemplate({ name: agent.name, badgeName: badge.name, commissionRate: badge.commissionRate }),
            sender: 'info',
          },
          'Agent badge auto-upgrade'
        );
      }

      return badge;
    }
  }

  return null;
}

module.exports = { evaluateAgentBadge };