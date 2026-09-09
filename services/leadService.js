const AgentLead = require('../models/AgentLead');
const { notifyAgent } = require('./notificationService');

// Called from authController.js's registerUser whenever a new account
// carries agent referral attribution — auto-populates the agent's CRM so
// they don't have to manually log every referral link signup (spec §76).
async function autoTrackConversion({ agentId, user, leadType }) {
  if (!agentId || !user) return null;

  const existing = await AgentLead.findOne({ agent: agentId, convertedUser: user._id });
  if (existing) return existing;

  const lead = await AgentLead.create({
    agent: agentId,
    name: user.name,
    phone: user.phone || '',
    email: user.email,
    leadType,
    source: 'referral_link',
    status: leadType === 'seller' ? 'registered' : 'converted',
    lastContactAt: new Date(),
    convertedUser: user._id,
  });

  notifyAgent(agentId, {
    type: leadType === 'seller' ? 'seller_registered' : 'buyer_registered',
    title: leadType === 'seller' ? 'New seller registered' : 'New buyer registered',
    message: `${user.name} just signed up using your referral link.`,
  });

  return lead;
}

// Advance a seller's pipeline stage when something happens elsewhere in the
// app (product approved, seller verification approved, etc). Safe no-op if
// the lead doesn't exist — not every seller was recruited by an agent.
async function advanceSellerLeadStage(sellerUserId, newStatus) {
  if (!sellerUserId) return null;
  const lead = await AgentLead.findOne({ convertedUser: sellerUserId, leadType: 'seller' }).sort('-createdAt');
  if (!lead) return null;

  const order = [
    'lead', 'invited', 'registered', 'application_submitted', 'documents_submitted',
    'under_review', 'approved', 'active', 'product_listed', 'first_sale',
  ];
  const currentIdx = order.indexOf(lead.status);
  const newIdx = order.indexOf(newStatus);
  if (newIdx === -1 || newIdx <= currentIdx) return lead; // never move backwards

  lead.status = newStatus;
  await lead.save();

  notifyAgent(lead.agent, {
    type: 'seller_pipeline',
    title: 'Seller pipeline update',
    message: `${lead.name || 'A seller you recruited'} is now "${newStatus.replace(/_/g, ' ')}".`,
  });

  return lead;
}

module.exports = { autoTrackConversion, advanceSellerLeadStage };