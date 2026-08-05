// utils/emailTemplates.js
//
// Central template library for every transactional email in the app.
// Every email is built on top of baseLayout() so signup, password reset,
// order, product-review and agent emails all share one modern visual system
// (gradient header, card body, consistent buttons/badges/tables).
//
// Usage: const { welcomeEmailTemplate } = require('../utils/emailTemplates');
//        await sendEmail({ to, subject, html: welcomeEmailTemplate({ name, role }) });

const FRONTEND_URL = (process.env.FRONTEND_URL || 'https://sixstarsuppliers.com').replace(/\/+$/, '');
const ADMIN_URL = (process.env.ADMIN_URL || `${FRONTEND_URL}/admin`).replace(/\/+$/, '');
const BRAND_NAME = 'Six Star Suppliers';

const COLORS = {
  ink: '#0f172a',
  muted: '#64748b',
  border: '#e5e7eb',
  bg: '#f4f4f4',
  card: '#ffffff',
  headerFrom: '#000000',
  headerTo: '#ff6600',
  accent: '#ff6600',
  accentDark: '#b34700',
  success: '#059669',
  warning: '#d97706',
  danger: '#dc2626',
  chip: '#fff4ec',
};

const money = (n) => `KES ${Number(n || 0).toLocaleString()}`;

const fmtDate = (d) =>
  new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });

/* ---------------------------------------------------------------- */
/* Base shell — header / body / footer                               */
/* Fluid, table-based layout (max-width, not fixed width) so it       */
/* resizes correctly in every mail client's phone preview instead of  */
/* forcing horizontal scroll or letting the client's own auto-shrink  */
/* mangle the design. Media queries handle padding/font drop on       */
/* narrow screens; a light dark-mode pass keeps text readable when    */
/* the client auto-inverts colors (iOS Mail / Outlook mobile / Gmail  */
/* app all do this to some emails automatically).                     */
/* ---------------------------------------------------------------- */
function baseLayout({ preheader = '', eyebrow = '', title = '', intro = '', bodyHtml = '', footerNote = '' }) {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${title}</title>
<!--[if mso]>
<noscript>
  <xml>
    <o:OfficeDocumentSettings>
      <o:PixelsPerInch>96</o:PixelsPerInch>
    </o:OfficeDocumentSettings>
  </xml>
</noscript>
<style>
  table { border-collapse: collapse; }
  td, th, div, p, a, h1, h2, h3 { font-family: Arial, sans-serif; }
</style>
<![endif]-->
<style>
  html, body { margin:0 !important; padding:0 !important; height:100% !important; width:100% !important; }
  * { -ms-text-size-adjust:100%; -webkit-text-size-adjust:100%; }
  table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
  img { -ms-interpolation-mode:bicubic; border:0; height:auto; line-height:100%; outline:none; text-decoration:none; }
  a[x-apple-data-detectors] { color:inherit !important; text-decoration:none !important; font-size:inherit !important; font-family:inherit !important; font-weight:inherit !important; line-height:inherit !important; }
  #MessageViewBody a { color:inherit; text-decoration:none; }

  @media only screen and (max-width: 600px) {
    .ss-wrapper-pad { padding-left:14px !important; padding-right:14px !important; }
    .ss-card { border-radius:12px !important; }
    .ss-header-pad { padding:26px 22px !important; }
    .ss-body-pad { padding:26px 22px !important; }
    .ss-footer-pad { padding:18px 22px !important; }
    .ss-title { font-size:19px !important; }
    .ss-otp-box { width:15% !important; padding:0 3px !important; }
    .ss-otp-digit { width:100% !important; height:44px !important; font-size:18px !important; }
    .ss-stack { display:block !important; width:100% !important; }
  }

  @media (prefers-color-scheme: dark) {
    .ss-bg { background:#15130f !important; }
    .ss-card { background:#221f19 !important; }
    .ss-ink { color:#f3ede1 !important; }
    .ss-muted { color:#b8ac98 !important; }
    .ss-footer { background:#1b1912 !important; border-top-color:#3a352a !important; }
    .ss-chip { background:#332c1d !important; }
    .ss-border { border-color:#3a352a !important; }
  }
</style>
</head>
<body class="ss-bg" style="margin:0;padding:0;background:${COLORS.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">
    ${preheader}${'&#8199;'.repeat(60)}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="ss-bg" style="background:${COLORS.bg};">
    <tr>
      <td align="center" class="ss-wrapper-pad" style="padding:32px 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
          <tr>
            <td class="ss-card" style="background:${COLORS.card};border-radius:16px;overflow:hidden;box-shadow:0 10px 40px rgba(15,23,42,0.10);">

              <!-- HEADER -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="ss-header-pad" style="background:${COLORS.headerFrom};background-image:linear-gradient(135deg,${COLORS.headerFrom},${COLORS.headerTo});padding:32px 36px;text-align:center;">
                    <div style="font-size:12px;letter-spacing:2px;color:rgba(255,255,255,0.65);text-transform:uppercase;font-weight:600;margin-bottom:8px;">
                      ${eyebrow || BRAND_NAME}
                    </div>
                    <div class="ss-title" style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:0.2px;">
                      ${title}
                    </div>
                  </td>
                </tr>
              </table>

              <!-- BODY -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="ss-body-pad" style="padding:36px;">
                    ${intro ? `<p class="ss-ink" style="margin:0 0 20px;font-size:15px;line-height:1.6;color:${COLORS.ink};">${intro}</p>` : ''}
                    ${bodyHtml}
                  </td>
                </tr>
              </table>

              <!-- FOOTER -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="ss-footer ss-footer-pad ss-border" style="background:#f8fafc;padding:22px 36px;text-align:center;border-top:1px solid ${COLORS.border};">
                    ${footerNote ? `<p class="ss-muted" style="margin:0 0 8px;font-size:12px;color:${COLORS.muted};">${footerNote}</p>` : ''}
                    <p class="ss-muted" style="margin:0;font-size:12px;color:${COLORS.muted};">
                      © ${new Date().getFullYear()} ${BRAND_NAME}. All rights reserved.
                    </p>
                  </td>
                </tr>
              </table>

            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function button(url, label, color = COLORS.accent) {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
    <tr>
      <td style="border-radius:10px;background:${color};">
        <a href="${url}" target="_blank"
          style="display:inline-block;padding:13px 26px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">
          ${label}
        </a>
      </td>
    </tr>
  </table>`;
}

function infoCard(rows) {
  // rows: [[label, value], ...]
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
    style="background:${COLORS.chip};border-radius:12px;margin:8px 0 20px;">
    <tr><td style="padding:16px 18px;">
      ${rows
        .map(
          ([label, value]) => `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:6px;">
          <tr>
            <td style="font-size:12px;color:${COLORS.muted};padding:3px 0;">${label}</td>
            <td align="right" style="font-size:13px;color:${COLORS.ink};font-weight:600;padding:3px 0;">${value}</td>
          </tr>
        </table>`
        )
        .join('')}
    </td></tr>
  </table>`;
}

function statusBadge(text, tone = 'accent') {
  const colorMap = {
    accent: COLORS.accent,
    success: COLORS.success,
    warning: COLORS.warning,
    danger: COLORS.danger,
  };
  const c = colorMap[tone] || COLORS.accent;
  return `<span style="display:inline-block;padding:6px 14px;border-radius:999px;background:${c}1A;color:${c};font-size:12px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;">${text}</span>`;
}

// Renders an itemized order table WITH product images — used by every order email.
function orderItemsTable(items) {
  const rows = (items || [])
    .map((item) => {
      const img = item.image || 'https://via.placeholder.com/80x80.png?text=No+Image';
      const variant = item.variantLabel
        ? `<div style="font-size:12px;color:${COLORS.muted};margin-top:2px;">${item.variantLabel}</div>`
        : '';
      const lineTotal = money((item.priceAtPurchase || 0) * (item.quantity || 1));
      return `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid ${COLORS.border};width:64px;">
          <img src="${img}" width="64" height="64" alt="${item.name || 'Product'}"
            style="width:64px;height:64px;object-fit:cover;border-radius:10px;border:1px solid ${COLORS.border};display:block;">
        </td>
        <td style="padding:12px 14px;border-bottom:1px solid ${COLORS.border};vertical-align:top;">
          <div style="font-size:14px;font-weight:600;color:${COLORS.ink};">${item.name}</div>
          ${variant}
          <div style="font-size:12px;color:${COLORS.muted};margin-top:2px;">Qty: ${item.quantity} × ${money(item.priceAtPurchase)}</div>
        </td>
        <td style="padding:12px 0;border-bottom:1px solid ${COLORS.border};text-align:right;vertical-align:top;">
          <div style="font-size:14px;font-weight:700;color:${COLORS.ink};">${lineTotal}</div>
        </td>
      </tr>`;
    })
    .join('');

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">${rows}</table>`;
}

/* ================================================================ */
/* AUTH EMAILS                                                       */
/* ================================================================ */

function welcomeEmailTemplate({ name, role }) {
  const roleLabel = { wholesaler: 'Wholesaler', retailer: 'Retailer', buyer: 'Buyer' }[role] || 'Member';
  const dashboardUrl =
    role === 'buyer' ? `${FRONTEND_URL}/my-orders` : `${FRONTEND_URL}/seller/dashboard`;

  const bodyHtml = `
    ${infoCard([['Account type', roleLabel]])}
    <p style="margin:0 0 4px;font-size:14px;line-height:1.6;color:${COLORS.ink};">
      ${role === 'buyer'
        ? 'You can now browse thousands of products from verified wholesalers and retailers.'
        : 'You can now list products, manage stock and track every order right from your dashboard.'}
    </p>
    ${button(dashboardUrl, role === 'buyer' ? 'Start Shopping' : 'Go to Dashboard')}
  `;

  return baseLayout({
    preheader: `Welcome to ${BRAND_NAME}, ${name}!`,
    eyebrow: 'Welcome',
    title: `Welcome, ${name?.split(' ')[0] || 'there'} 👋`,
    intro: `Your ${BRAND_NAME} account has been created successfully. Here's what you can do next.`,
    bodyHtml,
  });
}

function passwordResetEmailTemplate(name, resetUrl) {
  const bodyHtml = `
    <p style="margin:0 0 4px;font-size:13px;color:${COLORS.muted};">
      This link expires in <strong>15 minutes</strong> for your security.
    </p>
    ${button(resetUrl, 'Reset Password')}
    <p style="margin:20px 0 0;font-size:13px;color:${COLORS.muted};line-height:1.6;">
      If you didn't request this, you can safely ignore this email — your password stays unchanged.
    </p>
    <hr style="border:none;border-top:1px solid ${COLORS.border};margin:22px 0;">
    <p style="margin:0;font-size:12px;color:${COLORS.muted};word-break:break-all;">
      Button not working? Paste this link into your browser:<br>${resetUrl}
    </p>
  `;

  return baseLayout({
    preheader: 'Reset your Six Star Suppliers password',
    eyebrow: 'Security',
    title: 'Reset Your Password',
    intro: `Hi ${name || 'there'}, we received a request to reset your password.`,
    bodyHtml,
  });
}

function emailOtpTemplate({ name, code }) {
  const digits = String(code).split('');

  // Fixed-width px cells break on narrow phone previews (they either force
  // horizontal scroll or get squeezed illegibly by the client's own
  // auto-shrink). Using a full-width (100%) table with each <td> at an equal
  // percentage keeps the six boxes evenly sized and readable at any screen
  // width, and the .ss-otp-box / .ss-otp-digit media-query rules in
  // baseLayout shrink them further on screens under 600px.
  const cellPct = (100 / digits.length).toFixed(4);
  const digitBoxes = digits
    .map(
      (d) => `<td class="ss-otp-box" width="${cellPct}%" style="padding:0 3px;width:${cellPct}%;">
        <div class="ss-otp-digit ss-chip ss-border" style="width:100%;height:52px;line-height:52px;border-radius:8px;background:${COLORS.chip};border:1px solid ${COLORS.border};
          text-align:center;font-size:24px;font-weight:800;color:${COLORS.ink};font-family:'Courier New',Courier,monospace;">
          ${d}
        </div>
      </td>`
    )
    .join('');

  const plainCode = digits.join(' ');

  const bodyHtml = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 22px;table-layout:fixed;">
      <tr>${digitBoxes}</tr>
    </table>

    <!--[if mso]>
    <p style="text-align:center;margin:0 0 18px;font-size:20px;font-weight:800;letter-spacing:6px;color:${COLORS.ink};font-family:'Courier New',Courier,monospace;">${code}</p>
    <![endif]-->

    <p class="ss-muted" style="text-align:center;margin:0 0 4px;font-size:13px;color:${COLORS.muted};">
      Boxes not showing right? Your code is: <strong class="ss-ink" style="color:${COLORS.ink};letter-spacing:1px;">${plainCode}</strong>
    </p>
    <p class="ss-muted" style="text-align:center;margin:8px 0 0;font-size:13px;color:${COLORS.muted};">
      This code expires in <strong class="ss-ink" style="color:${COLORS.ink};">10 minutes</strong>.
    </p>
    <p class="ss-muted" style="margin:22px 0 0;font-size:13px;color:${COLORS.muted};line-height:1.6;">
      If you didn't request this, you can safely ignore this email — no changes will be made to your account.
    </p>
  `;

  return baseLayout({
    preheader: `Your verification code is ${code}`,
    eyebrow: 'Email Verification',
    title: 'Verify Your Email',
    intro: `Hi ${name?.split(' ')[0] || 'there'}, enter this code to continue your seller onboarding.`,
    bodyHtml,
  });
}

/* ================================================================ */
/* ORDER EMAILS (buyer / seller / admin)                             */
/* ================================================================ */

// Buyer-facing order confirmation, shown right after checkout.
function orderConfirmationTemplate({ order, buyerName }) {
  const trackUrl = `${FRONTEND_URL}/my-orders`;
  const bodyHtml = `
    ${infoCard([
      ['Order Number', order.orderNumber],
      ['Order Date', fmtDate(order.createdAt || Date.now())],
      ['Payment Status', 'Awaiting verification'],
    ])}
    <h3 style="margin:0 0 4px;font-size:14px;color:${COLORS.ink};">Your Items</h3>
    ${orderItemsTable(order.items)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;">
      <tr>
        <td style="font-size:13px;color:${COLORS.muted};padding:4px 0;">Delivery Fee</td>
        <td align="right" style="font-size:13px;color:${COLORS.ink};padding:4px 0;">${money(order.deliveryFee)}</td>
      </tr>
      <tr>
        <td style="font-size:15px;font-weight:700;color:${COLORS.ink};padding:8px 0 0;">Total</td>
        <td align="right" style="font-size:17px;font-weight:800;color:${COLORS.accent};padding:8px 0 0;">${money(order.totalAmount)}</td>
      </tr>
    </table>
    ${button(trackUrl, 'Track Your Order')}
    <p style="margin:0;font-size:12px;color:${COLORS.muted};">
      We'll verify your M-Pesa payment shortly and email you as your order progresses.
    </p>
  `;

  return baseLayout({
    preheader: `Order ${order.orderNumber} received — we're on it.`,
    eyebrow: 'Order Confirmation',
    title: 'Thanks for your order!',
    intro: `Hi ${buyerName || 'there'}, we've received your order and it's being processed.`,
    bodyHtml,
  });
}

// Sent to each seller who has items in a new order (items already filtered to that seller).
function newOrderSellerTemplate({ order, sellerName, items }) {
  const manageUrl = `${FRONTEND_URL}/seller/orders`;
  const bodyHtml = `
    ${infoCard([
      ['Order Number', order.orderNumber],
      ['Order Date', fmtDate(order.createdAt || Date.now())],
    ])}
    <h3 style="margin:0 0 4px;font-size:14px;color:${COLORS.ink};">Items From Your Store</h3>
    ${orderItemsTable(items)}
    ${button(manageUrl, 'View Order in Dashboard')}
    <p style="margin:0;font-size:12px;color:${COLORS.muted};">
      Prepare these items for dispatch once payment is verified by our team.
    </p>
  `;

  return baseLayout({
    preheader: `New order ${order.orderNumber} — items to fulfill`,
    eyebrow: 'New Order',
    title: 'You have a new order 🎉',
    intro: `Hi ${sellerName || 'there'}, a buyer just ordered items from your store.`,
    bodyHtml,
  });
}

// Sent to admin(s) so they know payment verification is needed.
function newOrderAdminTemplate({ order, buyerName }) {
  const verifyUrl = `${ADMIN_URL}/orders?paymentStatus=pending_verification`;
  const bodyHtml = `
    ${infoCard([
      ['Order Number', order.orderNumber],
      ['Buyer', buyerName || 'N/A'],
      ['Total', money(order.totalAmount)],
      ['Items', String(order.items.length)],
    ])}
    ${orderItemsTable(order.items)}
    ${button(verifyUrl, 'Verify Payment', COLORS.warning)}
  `;

  return baseLayout({
    preheader: `Order ${order.orderNumber} awaiting payment verification`,
    eyebrow: 'Admin Alert',
    title: 'New Order — Payment Verification Needed',
    intro: `A new order was placed and is waiting for M-Pesa payment verification.`,
    bodyHtml,
  });
}

// Buyer-facing fulfillment status change (processing / shipped / delivered / cancelled).
function orderStatusUpdateTemplate({ order, buyerName, status }) {
  const toneMap = { processing: 'accent', shipped: 'accent', delivered: 'success', cancelled: 'danger' };
  const labelMap = {
    processing: 'Processing',
    shipped: 'Shipped',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
  };
  const trackUrl = `${FRONTEND_URL}/my-orders`;

  const bodyHtml = `
    <div style="text-align:center;background:${COLORS.chip};border-radius:12px;padding:22px;margin:8px 0 20px;">
      <div style="font-size:11px;letter-spacing:1px;color:${COLORS.muted};text-transform:uppercase;margin-bottom:10px;">
        Order ${order.orderNumber}
      </div>
      ${statusBadge(labelMap[status] || status, toneMap[status] || 'accent')}
    </div>
    ${button(trackUrl, 'Track Your Order')}
    <p style="margin:0;font-size:12px;color:${COLORS.muted};">
      You'll get another email as soon as your order's status changes again.
    </p>
  `;

  return baseLayout({
    preheader: `Order ${order.orderNumber} is now ${labelMap[status] || status}`,
    eyebrow: 'Order Update',
    title: 'Your Order Status Changed',
    intro: `Hi ${buyerName || 'there'}, here's the latest on order ${order.orderNumber}.`,
    bodyHtml,
  });
}

// Buyer-facing M-Pesa payment verification result.
function paymentDecisionTemplate({ order, buyerName, decision }) {
  const isConfirmed = decision === 'confirmed';
  const trackUrl = `${FRONTEND_URL}/my-orders`;

  const bodyHtml = `
    <div style="text-align:center;background:${COLORS.chip};border-radius:12px;padding:22px;margin:8px 0 20px;">
      <div style="font-size:11px;letter-spacing:1px;color:${COLORS.muted};text-transform:uppercase;margin-bottom:10px;">
        Order ${order.orderNumber}
      </div>
      ${statusBadge(isConfirmed ? 'Payment Confirmed' : 'Payment Rejected', isConfirmed ? 'success' : 'danger')}
    </div>
    <p style="margin:0 0 4px;font-size:14px;line-height:1.6;color:${COLORS.ink};">
      ${isConfirmed
        ? 'Your payment has been verified. Your order is now being prepared for dispatch.'
        : 'We could not verify your M-Pesa payment for this order. If you believe this is a mistake, please contact support with your M-Pesa message.'}
    </p>
    ${button(trackUrl, 'View Order', isConfirmed ? COLORS.success : COLORS.danger)}
  `;

  return baseLayout({
    preheader: `Payment ${decision} for order ${order.orderNumber}`,
    eyebrow: 'Payment Update',
    title: isConfirmed ? 'Payment Confirmed ✅' : 'Payment Could Not Be Verified',
    intro: `Hi ${buyerName || 'there'},`,
    bodyHtml,
  });
}

/* ================================================================ */
/* PRODUCT REVIEW EMAILS (seller <-> admin)                          */
/* ================================================================ */

function productSubmittedAdminTemplate({ product, sellerName }) {
  const reviewUrl = `${ADMIN_URL}/products/pending`;
  const img = (product.images && product.images[0]) || 'https://via.placeholder.com/80x80.png?text=No+Image';

  const bodyHtml = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 18px;">
      <tr>
        <td style="width:64px;vertical-align:top;">
          <img src="${img}" width="64" height="64" alt="${product.name}"
            style="width:64px;height:64px;object-fit:cover;border-radius:10px;border:1px solid ${COLORS.border};display:block;">
        </td>
        <td style="padding-left:14px;vertical-align:top;">
          <div style="font-size:15px;font-weight:700;color:${COLORS.ink};">${product.name}</div>
          <div style="font-size:12px;color:${COLORS.muted};margin-top:4px;">Submitted by ${sellerName || 'a seller'}</div>
        </td>
      </tr>
    </table>
    ${button(reviewUrl, 'Review Product', COLORS.warning)}
  `;

  return baseLayout({
    preheader: `"${product.name}" is awaiting review`,
    eyebrow: 'Admin Alert',
    title: 'Product Awaiting Review',
    intro: 'A product was just submitted and needs pricing + approval.',
    bodyHtml,
  });
}

function productApprovedTemplate({ product, sellerName }) {
  const productUrl = `${FRONTEND_URL}/product/${product._id}`;
  const bodyHtml = `
    ${infoCard([
      ['Product', product.name],
      ['Final Price', money(product.finalPrice)],
      ['Status', 'Live on storefront'],
    ])}
    ${button(productUrl, 'View Live Listing', COLORS.success)}
  `;

  return baseLayout({
    preheader: `"${product.name}" is now live`,
    eyebrow: 'Product Approved',
    title: 'Your Product Is Live 🎉',
    intro: `Hi ${sellerName || 'there'}, great news — your product has been approved and is now visible to buyers.`,
    bodyHtml,
  });
}

function productRejectedTemplate({ product, sellerName, reason }) {
  const editUrl = `${FRONTEND_URL}/seller/products/${product._id}/edit`;
  const bodyHtml = `
    ${infoCard([['Product', product.name]])}
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px 16px;margin:8px 0 20px;">
      <div style="font-size:12px;font-weight:700;color:${COLORS.danger};text-transform:uppercase;letter-spacing:0.4px;margin-bottom:6px;">
        Reason for rejection
      </div>
      <div style="font-size:13px;color:${COLORS.ink};line-height:1.6;">${reason}</div>
    </div>
    ${button(editUrl, 'Edit &amp; Resubmit', COLORS.danger)}
  `;

  return baseLayout({
    preheader: `"${product.name}" needs changes`,
    eyebrow: 'Product Rejected',
    title: 'Your Product Needs Changes',
    intro: `Hi ${sellerName || 'there'}, your product wasn't approved this time. Here's why:`,
    bodyHtml,
  });
}

/* ================================================================ */
/* AGENT EMAILS                                                      */
/* ================================================================ */

function agentWelcomeTemplate({ name, code }) {
  const bodyHtml = `
    <div style="text-align:center;background:${COLORS.chip};border:2px solid ${COLORS.accent};border-radius:12px;padding:22px;margin:8px 0 20px;">
      <div style="font-size:11px;letter-spacing:1px;color:${COLORS.muted};text-transform:uppercase;margin-bottom:8px;">
        Your Agent Code
      </div>
      <div style="font-size:26px;font-weight:800;color:${COLORS.accent};letter-spacing:2px;">${code}</div>
    </div>
    <p style="margin:0 0 15px;font-size:14px;color:${COLORS.ink};line-height:1.7;">
      Use this code on every referral so we can track your sales and pay your commission accurately.
    </p>
  `;

  return baseLayout({
    preheader: `Your agent code is ${code}`,
    eyebrow: 'Agent Assignment',
    title: 'Welcome to the Agent Program',
    intro: `Dear ${name}, we're pleased to officially assign your agent code.`,
    bodyHtml,
  });
}

module.exports = {
  // primitives (useful if you build one-off emails later)
  COLORS,
  money,
  fmtDate,
  baseLayout,
  button,
  infoCard,
  statusBadge,
  orderItemsTable,
  FRONTEND_URL,
  ADMIN_URL,

  // auth
  welcomeEmailTemplate,
  passwordResetEmailTemplate,
  emailOtpTemplate, // <-- THE FIX: this line was missing, so require(...).emailOtpTemplate was undefined

  // orders
  orderConfirmationTemplate,
  newOrderSellerTemplate,
  newOrderAdminTemplate,
  orderStatusUpdateTemplate,
  paymentDecisionTemplate,

  // products
  productSubmittedAdminTemplate,
  productApprovedTemplate,
  productRejectedTemplate,

  // agents
  agentWelcomeTemplate,
};