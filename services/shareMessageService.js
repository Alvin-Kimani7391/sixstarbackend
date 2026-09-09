const FRONTEND_URL = process.env.FRONTEND_URL || 'https://sixstarsuppliers.com';
const BRAND_NAME = 'Six Star Suppliers';

// Mirrors the referral link shapes already used in
// controllers2/agentController.js's getPublicAgentProfile — kept in one
// place so Sharing (Phase 3) and Recruitment (Phase 4) build the exact
// same links agents already see on their dashboard.
function buildReferralLink({ agentCode, type = 'general', targetId }) {
  switch (type) {
    case 'buyer':
      return `${FRONTEND_URL}/?ref=${agentCode}&intent=buyer`;
    case 'seller':
      return `${FRONTEND_URL}/become-a-seller.html?ref=${agentCode}`; // ASSUMED — matches agentController
    case 'agent':
      return `${FRONTEND_URL}/agent/apply.html?ref=${agentCode}`; // ASSUMED
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