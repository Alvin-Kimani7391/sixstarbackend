const FRONTEND_URL = process.env.FRONTEND_URL || 'https://www.sixstarsuppliers.com';
const BRAND_NAME = 'Six Star Suppliers';

// Referral link shapes — kept in one place so Sharing (Phase 3), Recruitment
// (Phase 4), and the agent dashboard's own "Your Referral Links" panel all
// build the EXACT same links.
//
// IMPORTANT: buyers and sellers both register through the single
// register.html page (it has a Buy/Sell tab switcher) — there is no
// separate become-a-seller.html. The `intent` query param just pre-selects
// the right tab; register.html reads it and forwards `ref` on to
// POST /api/auth/register so the signup gets attributed to this agent.
function buildReferralLink({ agentCode, type = 'general', targetId }) {
  switch (type) {
    case 'buyer':
      return `${FRONTEND_URL}/register.html?ref=${agentCode}&intent=buyer`;
    case 'seller':
      return `${FRONTEND_URL}/register.html?ref=${agentCode}&intent=seller`;
    case 'agent':
      return `${FRONTEND_URL}/agent-apply.html?ref=${agentCode}`;
    case 'product':
      return `${FRONTEND_URL}/product-detail.html?id=${targetId}&ref=${agentCode}`;
    case 'category':
      return `${FRONTEND_URL}/?category=${targetId}&ref=${agentCode}`;
    case 'campaign':
      return `${FRONTEND_URL}/?campaign=${targetId}&ref=${agentCode}`;
    default:
      return `${FRONTEND_URL}/?ref=${agentCode}`;
  }
}

function buildRecruitmentMessage({ agentName, leadName = '', type, link }) {
  const greeting = leadName ? `Hi ${leadName} 👋` : 'Hi there 👋';
  if (type === 'seller') {
    return (
      `${greeting}\n\nI thought you might be interested in joining ${BRAND_NAME}. ` +
      `You can sell your products online and reach more customers.\n\n` +
      `Join here:\n${link}\n\nReferred by: ${agentName}`
    );
  }
  return (
    `${greeting}\n\nCheck out ${BRAND_NAME} — great deals from verified wholesalers and retailers.\n\n` +
    `Shop here:\n${link}\n\nReferred by: ${agentName}`
  );
}

function buildProductCaption({ agentName, productName, link }) {
  return `🔥 ${productName} — available now on ${BRAND_NAME}!\n\n${link}\n\nShared by: ${agentName}`;
}

module.exports = { buildReferralLink, buildRecruitmentMessage, buildProductCaption, FRONTEND_URL, BRAND_NAME };