// utils/emailTemplates.rfq.js
//
// Email templates for the RFQ / Bidding / Private Chat feature.
//
// WHY A SEPARATE FILE: utils/emailTemplates.js is already large and covers
// auth/orders/products/verification/flash-sales/shops/agents. Rather than
// hand-editing that file (risky to paste back correctly at this size), this
// file imports its shared building blocks — baseLayout, button, infoCard,
// statusBadge, reasonBox, money, fmtDate, FRONTEND_URL, SELLER_URL — so
// every RFQ email still matches your existing navy/marigold visual system
// exactly. If you'd rather have everything in one file, these functions can
// be pasted into emailTemplates.js and the requires below deleted.
//
// Usage: const { newBidBuyerTemplate } = require('../utils/emailTemplates.rfq');

const {
  baseLayout,
  button,
  infoCard,
  statusBadge,
  reasonBox,
  money,
  fmtDate,
  FRONTEND_URL,
  SELLER_URL,
} = require('./emailTemplates');

const BRAND_NAME = 'Six Star Suppliers';

// ASSUMED frontend routes for the RFQ pages — adjust these two lines if your
// actual filenames differ. Everything else derives from them.
const RFQ_BUYER_URL = (rfqId) => `${FRONTEND_URL}/rfq-detail.html?id=${rfqId}`;
const RFQ_SELLER_URL = (rfqId) => `${SELLER_URL}/seller-dashboard.html?tab=rfq&rfqId=${rfqId}`;

function rfqSummaryRows(rfq) {
  const budget =
    rfq.budgetType === 'total'
      ? `${money(rfq.minBudget)} - ${money(rfq.maxBudget)} total`
      : `${money(rfq.minBudget)} - ${money(rfq.maxBudget)} per ${rfq.unit}`;
  return [
    ['Product', rfq.productName],
    ['Quantity', `${rfq.quantity} ${rfq.unit}`],
    ['Budget', budget],
    ['Location', rfq.location],
    ['Required by', fmtDate(rfq.requiredDate)],
  ];
}

/* ================================================================ */
/* BUYER-FACING                                                      */
/* ================================================================ */

// Sent the moment a buyer's RFQ is successfully posted.
function rfqPostedBuyerTemplate({ rfq, buyerName }) {
  const bodyHtml = `
    ${infoCard(rfqSummaryRows(rfq))}
    <p style="margin:0 0 4px;font-size:14px;line-height:1.6;color:#1f2937;">
      Your request is now visible to wholesalers and retailers who match what you're looking for. We'll email you as soon as offers start coming in.
    </p>
    ${button(RFQ_BUYER_URL(rfq._id), 'View My Request')}
  `;
  return baseLayout({
    preheader: `Your request for "${rfq.productName}" is now live`,
    eyebrow: 'Request Posted',
    title: 'Your Request Is Live 📋',
    intro: `Hi ${buyerName?.split(' ')[0] || 'there'}, thanks for posting a request on ${BRAND_NAME}.`,
    bodyHtml,
  });
}

// Sent to the buyer every time a new bid comes in on their RFQ.
function newBidBuyerTemplate({ rfq, buyerName, bidCount }) {
  const bodyHtml = `
    ${infoCard([...rfqSummaryRows(rfq), ['Offers so far', String(bidCount)]])}
    <p style="margin:0 0 4px;font-size:14px;line-height:1.6;color:#1f2937;">
      A seller has submitted a private offer. Compare it against your other offers before deciding.
    </p>
    ${button(RFQ_BUYER_URL(rfq._id), 'View Offers')}
  `;
  return baseLayout({
    preheader: `New offer received for "${rfq.productName}"`,
    eyebrow: 'New Offer',
    title: 'New Offer Received',
    intro: `Hi ${buyerName?.split(' ')[0] || 'there'}, a seller has submitted an offer for your request.`,
    bodyHtml,
  });
}

// Sent to the buyer when a seller updates their existing offer.
function bidUpdatedBuyerTemplate({ rfq, buyerName }) {
  const bodyHtml = `
    ${infoCard(rfqSummaryRows(rfq))}
    <p style="margin:0 0 4px;font-size:14px;line-height:1.6;color:#1f2937;">
      One of the sellers who bid on your request has updated their offer.
    </p>
    ${button(RFQ_BUYER_URL(rfq._id), 'View Updated Offer')}
  `;
  return baseLayout({
    preheader: `An offer for "${rfq.productName}" was updated`,
    eyebrow: 'Offer Updated',
    title: 'A Seller Updated Their Offer',
    intro: `Hi ${buyerName?.split(' ')[0] || 'there'},`,
    bodyHtml,
  });
}

// Sent to the buyer as their RFQ approaches its deadline.
function rfqDeadlineReminderTemplate({ rfq, buyerName }) {
  const bodyHtml = `
    ${infoCard([...rfqSummaryRows(rfq), ['Offers received', String(rfq.bidCount)]])}
    <p style="margin:0 0 4px;font-size:14px;line-height:1.6;color:#1f2937;">
      Bidding on this request closes soon. If you've found an offer you like, now's a good time to select a seller.
    </p>
    ${button(RFQ_BUYER_URL(rfq._id), 'Review Offers Now', '#b45309')}
  `;
  return baseLayout({
    preheader: `Bidding closes soon for "${rfq.productName}"`,
    eyebrow: 'Deadline Approaching',
    title: 'Your Request Closes Soon ⏳',
    intro: `Hi ${buyerName?.split(' ')[0] || 'there'},`,
    bodyHtml,
  });
}

/* ================================================================ */
/* SELLER-FACING                                                     */
/* ================================================================ */

// Optional: notify sellers in a matching category when a new RFQ is posted.
function relevantRfqSellerTemplate({ rfq, sellerName }) {
  const bodyHtml = `
    ${infoCard(rfqSummaryRows(rfq))}
    <p style="margin:0 0 4px;font-size:14px;line-height:1.6;color:#1f2937;">
      A buyer is looking for a product that matches what you sell. Submit a private offer if you can fulfil it.
    </p>
    ${button(RFQ_SELLER_URL(rfq._id), 'View Request &amp; Submit Offer')}
  `;
  return baseLayout({
    preheader: `New buyer request: ${rfq.productName}`,
    eyebrow: 'New Request',
    title: 'A Buyer Is Looking For This',
    intro: `Hi ${sellerName?.split(' ')[0] || 'there'}, a new request matches your category.`,
    bodyHtml,
  });
}

// Sent when a seller's offer is accepted.
function offerAcceptedSellerTemplate({ rfq, sellerName, bid }) {
  const bodyHtml = `
    <div style="text-align:center;background:#faf1e2;border-radius:12px;padding:22px;margin:8px 0 20px;">
      ${statusBadge('Offer Accepted', 'success')}
    </div>
    ${infoCard([
      ['Product', rfq.productName],
      ['Your Price', money(bid.unitPrice)],
      ['Quantity', String(bid.quantityAvailable)],
    ])}
    <p style="margin:0 0 4px;font-size:14px;line-height:1.6;color:#1f2937;">
      The buyer has selected your offer. Head to your private conversation with them to share your special-offer link and finalise the order.
    </p>
    ${button(RFQ_SELLER_URL(rfq._id), 'Open Conversation', '#1f7a4d')}
  `;
  return baseLayout({
    preheader: `Your offer for "${rfq.productName}" was accepted`,
    eyebrow: 'Offer Accepted',
    title: 'You\u2019ve Been Selected! 🎉',
    intro: `Hi ${sellerName?.split(' ')[0] || 'there'}, great news.`,
    bodyHtml,
  });
}

// Sent to sellers whose offer was NOT selected once the buyer picks someone else.
function offerRejectedSellerTemplate({ rfq, sellerName }) {
  const bodyHtml = `
    <div style="text-align:center;background:#faf1e2;border-radius:12px;padding:22px;margin:8px 0 20px;">
      ${statusBadge('Not Selected', 'danger')}
    </div>
    ${infoCard([['Product', rfq.productName]])}
    <p style="margin:0 0 4px;font-size:14px;line-height:1.6;color:#1f2937;">
      The buyer went with another offer this time. Keep an eye out for new requests that match what you sell.
    </p>
    ${button(SELLER_URL + '/seller-dashboard.html?tab=rfq', 'Browse Open Requests', '#b3261e')}
  `;
  return baseLayout({
    preheader: `Your offer for "${rfq.productName}" was not selected`,
    eyebrow: 'Offer Update',
    title: 'Offer Not Selected',
    intro: `Hi ${sellerName?.split(' ')[0] || 'there'},`,
    bodyHtml,
  });
}

/* ================================================================ */
/* SHARED (both buyer and seller can receive these)                  */
/* ================================================================ */

// Generic new-private-message notification. `isBuyer` decides which
// dashboard link to point at; `senderLabel` is already a MASKED identity
// (e.g. "Seller J.M. #4F21") — never pass a real name/email/phone in here.
function newMessageTemplate({ rfq, recipientName, isBuyer, senderLabel }) {
  const url = isBuyer ? RFQ_BUYER_URL(rfq._id) : RFQ_SELLER_URL(rfq._id);
  const bodyHtml = `
    ${infoCard([
      ['Request', rfq.productName],
      ['From', senderLabel],
    ])}
    <p style="margin:0 0 4px;font-size:14px;line-height:1.6;color:#1f2937;">
      You have a new message about this request. Keep the conversation on ${BRAND_NAME} for your protection.
    </p>
    ${button(url, 'Open Conversation')}
  `;
  return baseLayout({
    preheader: `New message about "${rfq.productName}"`,
    eyebrow: 'New Message',
    title: 'You Have a New Message 💬',
    intro: `Hi ${recipientName?.split(' ')[0] || 'there'},`,
    bodyHtml,
  });
}

// Sent to both sides once an RFQ is closed.
function rfqClosedTemplate({ rfq, recipientName, isBuyer }) {
  const url = isBuyer ? RFQ_BUYER_URL(rfq._id) : RFQ_SELLER_URL(rfq._id);
  const bodyHtml = `
    <div style="text-align:center;background:#faf1e2;border-radius:12px;padding:22px;margin:8px 0 20px;">
      ${statusBadge('Closed', 'accent')}
    </div>
    ${infoCard([['Product', rfq.productName]])}
    ${button(url, 'View Request')}
  `;
  return baseLayout({
    preheader: `Request "${rfq.productName}" has closed`,
    eyebrow: 'Request Closed',
    title: 'This Request Has Closed',
    intro: `Hi ${recipientName?.split(' ')[0] || 'there'},`,
    bodyHtml,
  });
}

// Sent to a user the moment they're messaging-restricted after repeated
// off-platform-contact attempts. No reason detail needed by email — the
// in-app notice already told them why.
function messagingRestrictedTemplate({ recipientName }) {
  const bodyHtml = `
    ${reasonBox(
      'Repeated attempts to share phone numbers, external links, or other off-platform contact details in RFQ chat.'
    )}
    <p style="margin:0 0 4px;font-size:14px;line-height:1.6;color:#1f2937;">
      Your ability to send RFQ messages and bids has been temporarily restricted while our team reviews your account. If you believe this is a mistake, please contact support.
    </p>
  `;
  return baseLayout({
    preheader: 'Your messaging has been temporarily restricted',
    eyebrow: 'Account Notice',
    title: 'Messaging Temporarily Restricted',
    intro: `Hi ${recipientName?.split(' ')[0] || 'there'},`,
    bodyHtml,
  });
}

module.exports = {
  rfqPostedBuyerTemplate,
  newBidBuyerTemplate,
  bidUpdatedBuyerTemplate,
  rfqDeadlineReminderTemplate,
  relevantRfqSellerTemplate,
  offerAcceptedSellerTemplate,
  offerRejectedSellerTemplate,
  newMessageTemplate,
  rfqClosedTemplate,
  messagingRestrictedTemplate,
};