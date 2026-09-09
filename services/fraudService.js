const FraudEvent = require('../models/FraudEvent');
const ReferralClick = require('../models/ReferralClick');

// Basic, additive fraud checks (spec §67) — flags for admin review, never
// blocks the underlying action itself.
async function checkSelfReferral(agent, referredUser) {
  if (!agent || !referredUser) return;
  const sameEmail = agent.email && referredUser.email && agent.email.toLowerCase() === referredUser.email.toLowerCase();
  const samePhone = agent.phone && referredUser.phone && agent.phone === referredUser.phone;

  if (sameEmail || samePhone) {
    await FraudEvent.create({
      agent: agent._id,
      type: 'self_referral',
      severity: 'high',
      description: `Agent ${agent.code} appears to have referred an account matching their own ${sameEmail ? 'email' : 'phone number'}.`,
    }).catch((err) => console.error('Fraud log failed:', err.message));
  }
}

async function checkClickVelocity(agentId) {
  const since = new Date(Date.now() - 10 * 60 * 1000);
  const count = await ReferralClick.countDocuments({ agent: agentId, createdAt: { $gte: since } });
  if (count > 50) {
    await FraudEvent.create({
      agent: agentId,
      type: 'suspicious_click',
      severity: 'medium',
      description: `${count} referral clicks recorded for this agent in the last 10 minutes.`,
    }).catch((err) => console.error('Fraud log failed:', err.message));
  }
}

module.exports = { checkSelfReferral, checkClickVelocity };