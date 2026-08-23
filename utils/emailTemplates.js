// utils/emailTemplates.js
//
// Central template library for every transactional email in the app.
// Every email is built on top of baseLayout() so signup, password reset,
// order, product-review, seller-verification (KYC), flash-sale, shop and
// agent emails all share one visual system (navy header, warm paper body,
// consistent buttons/badges/tables).
//
// Usage: const { welcomeEmailTemplate } = require('../utils/emailTemplates');
//        await sendEmail({ to, subject, html: welcomeEmailTemplate({ name, role }), sender: 'info' });
//
// SENDER ROUTING (Brevo) — decided at the call site, not in this file:
//   sender: 'noreply' -> noreply@sixstarsuppliers.com — OTP / email verification, password reset
//   sender: 'info'    -> info@sixstarsuppliers.com    — everything else built here
// See utils/sendEmail.js for the enforcement (it throws if sender is missing).

/* ------------------------------------------------------------------ */
/* URL FIX — 2026-08-11                                                */
/* Buttons were pointing at your old .vercel.app deployment. That was  */
/* NOT a bug in this file — FRONTEND_URL/ADMIN_URL are read from       */
/* process.env at runtime, and the fallback below was already          */
/* sixstarsuppliers.com. If buttons still showed the old domain, the   */
/* env vars on Render were explicitly set to the old Vercel URL and     */
/* were overriding this fallback. Go to Render → your backend service  */
/* → Environment and set/update:                                       */
/*   FRONTEND_URL = https://sixstarsuppliers.com                       */
/*   ADMIN_URL    = https://sixstarsuppliers.com/site/admin.html        */
/* then redeploy. Once that's done, every link below is correct too,   */
/* because the paths have now been rewritten to match your real site   */
/* structure instead of the old fictional SPA routes (/seller/..,      */
/* /my-orders, /admin, etc).                                            */
/*                                                                       */
/* REAL ROUTES USED BELOW (confirmed by you):                           */
/*   Seller login  → /six-star-suppliers/login.html                     */
/*   Admin         → /site/admin.html  (?section=... query param)       */
/*   Buyer orders  → /profile.html?tab=orders&orderId=...               */
/*   Product page  → /product-detail.html?id=...                        */
/*                                                                       */
/* ASSUMED (I don't have these confirmed — search "ASSUMED" below and   */
/* fix if the real filename differs; each is a single line to edit):    */
/*   Seller dashboard/orders/products/verification/flash-sales/shop are */
/*   assumed to live in /six-star-suppliers/seller-dashboard.html with a */
/*   ?tab= query param (mirrors the profile.html?tab= pattern you gave  */
/*   me for buyers). If seller pages are actually separate .html files  */
/*   (e.g. orders.html, verification.html) tell me and I'll adjust the  */
/*   SELLER_URL helper in one place.                                    */
/* ------------------------------------------------------------------ */

const FRONTEND_URL = 'https://sixstarsuppliers.com';
const ADMIN_URL = `${FRONTEND_URL}/site/admin.html`;
// ASSUMED base for seller-facing pages — adjust if your folder/file names differ.
const SELLER_URL = `${FRONTEND_URL}/six-star-suppliers/login.html`;
const BRAND_NAME = 'Six Star Suppliers';

// Shown on OTP / password-reset / any "you requested this" security email,
// and quietly in every footer so every email looks and feels professional.
const SUPPORT_EMAIL = 'support@sixstarsuppliers.com';

// LOGO — set EMAIL_LOGO_URL in your environment to a hosted image URL
// (PNG or SVG, ~280-320px wide source so it stays crisp at 140px display
// width, ideally on a transparent or navy-safe background since it sits on
// the dark navy header). A Cloudinary URL works well since this codebase
// already uploads to Cloudinary elsewhere. Until you set it, the header
// falls back to a clean text wordmark so emails never look broken.
const LOGO_URL = process.env.EMAIL_LOGO_URL || '';

/* ------------------------------------------------------------------ */
/* THEME — deep navy + a muted marigold accent, warm paper background. */
/* Toned down from the old pure-black/bright-orange combo so the       */
/* emails read as professional rather than promotional.                */
/* ------------------------------------------------------------------ */
const COLORS = {
  ink: '#1f2937',
  muted: '#68707c',
  border: '#e7e2d6',
  bg: '#f6f3ec',          // warm paper, not flat gray
  card: '#ffffff',
  headerFrom: '#101d31',  // deep navy
  headerTo: '#1c3357',    // lighter navy
  accent: '#c9791f',      // muted marigold (was neon #ff6600)
  accentDark: '#9c5e15',
  success: '#1f7a4d',
  warning: '#b45309',
  danger: '#b3261e',
  chip: '#faf1e2',        // soft marigold tint for chips/callouts
};

const money = (n) => `KES ${Number(n || 0).toLocaleString()}`;

const fmtDate = (d) =>
  new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });

// Stable, still-hosted placeholder — via.placeholder.com has been retired,
// so any email that fell back to it rendered a broken-image icon instead of
// an actual picture. placehold.co is colored to match the theme's paper/ink
// tones so it blends in even when a product genuinely has no image.
const NO_IMAGE_FALLBACK = 'https://placehold.co/96x96/f0ece1/8a8f98?text=No+Image';

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
    .ss-item-thumb { width:56px !important; height:56px !important; }
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
            <td class="ss-card" style="background:${COLORS.card};border-radius:16px;overflow:hidden;box-shadow:0 10px 40px rgba(16,29,49,0.10);">

              <!-- HEADER -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="ss-header-pad" style="background:${COLORS.headerFrom};background-image:linear-gradient(135deg,${COLORS.headerFrom},${COLORS.headerTo});padding:32px 36px;text-align:center;">
                    ${LOGO_URL
                      ? `<img src="${LOGO_URL}" alt="${BRAND_NAME}" width="140" style="max-width:140px;width:140px;height:auto;display:block;margin:0 auto 14px;border:0;">`
                      : `<div style="font-size:20px;font-weight:800;color:#ffffff;letter-spacing:0.3px;margin-bottom:14px;">${BRAND_NAME}</div>`}
                    <div style="font-size:12px;letter-spacing:2px;color:rgba(255,255,255,0.62);text-transform:uppercase;font-weight:600;margin-bottom:8px;">
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
                  <td class="ss-footer ss-footer-pad ss-border" style="background:#faf7f1;padding:22px 36px;text-align:center;border-top:1px solid ${COLORS.border};">
                    ${footerNote ? `<p class="ss-muted" style="margin:0 0 8px;font-size:12px;color:${COLORS.muted};">${footerNote}</p>` : ''}
                    <p class="ss-muted" style="margin:0 0 8px;font-size:12px;color:${COLORS.muted};">
                      Need help? Contact us at <a href="mailto:${SUPPORT_EMAIL}" style="color:${COLORS.accentDark};text-decoration:none;font-weight:600;">${SUPPORT_EMAIL}</a>
                    </p>
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

// Reason/callout box used by every "rejected" style email (products, flash
// sales, shops, seller verification) so the tone stays consistent.
function reasonBox(reason) {
  if (!reason) return '';
  return `
    <div style="background:#fdf0ee;border:1px solid #f2c8c1;border-radius:10px;padding:14px 16px;margin:8px 0 20px;">
      <div style="font-size:12px;font-weight:700;color:${COLORS.danger};text-transform:uppercase;letter-spacing:0.4px;margin-bottom:6px;">
        Reason
      </div>
      <div style="font-size:13px;color:${COLORS.ink};line-height:1.6;">${reason}</div>
    </div>`;
}

// Used on OTP / password-reset (and any other "you requested this" security
// email) so the recipient knows exactly what to do if THEY didn't request
// it — points straight at support@sixstarsuppliers.com.
function securityWarningBox() {
  return `
    <div style="background:#fff8ec;border:1px solid #f0dcb0;border-radius:10px;padding:14px 16px;margin:22px 0 0;">
      <div style="font-size:12px;font-weight:700;color:${COLORS.warning};text-transform:uppercase;letter-spacing:0.4px;margin-bottom:6px;">
        Didn't request this?
      </div>
      <div style="font-size:13px;color:${COLORS.ink};line-height:1.6;">
        If you did not request this, your account may be at risk. Please do not share this code or link with
        anyone, and contact us immediately at
        <a href="mailto:${SUPPORT_EMAIL}" style="color:${COLORS.accentDark};font-weight:600;">${SUPPORT_EMAIL}</a>.
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Renders an itemized order table WITH product images — used by every order
// email.
//
// THE IMAGE FIX: previously this fell back to via.placeholder.com, a service
// that has been shut down — so ANY item missing an image (or any client that
// couldn't reach that dead host) rendered a broken-image icon, which is very
// likely what you were seeing even on real orders. That fallback now points
// at placehold.co (active, theme-colored). Real product images are also
// rendered with explicit width/height + a background color behind them so
// the layout never collapses even if a client blocks remote images.
//
// If your OWN Cloudinary product images still don't show up after this
// change, the most common causes are:
//   1) The image field on the product is actually empty/null for that item
//      (check item.image on the Order document itself).
//   2) The Cloudinary upload preset used for PRODUCT images is set to
//      "signed"/authenticated delivery (the same pattern used for the
//      admin-only PDF documents) — signed URLs expire and email clients
//      can't attach auth headers, so they'll never load. Product images
//      should always be uploaded as unsigned/public delivery, unlike the
//      verification PDFs.
//   3) The stored URL is a relative path instead of the full Cloudinary
//      secure_url — always store `file.path`/`file.secure_url`, never a
//      local disk path, or it will 404 outside your own server.
// ---------------------------------------------------------------------------
function orderItemsTable(items) {
  const rows = (items || [])
    .map((item) => {
      const img = (item.image && String(item.image).trim()) || NO_IMAGE_FALLBACK;
      const safeName = item.name || 'Product';
      const variant = item.variantLabel
        ? `<div style="font-size:12px;color:${COLORS.muted};margin-top:2px;">${item.variantLabel}</div>`
        : '';
      const flashTag = item.isFlashDeal
        ? `<div style="margin-top:4px;">${statusBadge('Flash Sale', 'accent')}</div>`
        : '';
      const lineTotal = money((item.priceAtPurchase || 0) * (item.quantity || 1));
      return `
      <tr>
        <td class="ss-item-thumb" style="padding:12px 0;border-bottom:1px solid ${COLORS.border};width:64px;background:${COLORS.card};">
          <table role="presentation" cellpadding="0" cellspacing="0" style="width:64px;height:64px;background:${COLORS.chip};border-radius:10px;border:1px solid ${COLORS.border};">
            <tr>
              <td align="center" valign="middle" style="width:64px;height:64px;">
                <img src="${img}" width="64" height="64" alt="${safeName}"
                  style="width:64px;height:64px;object-fit:cover;border-radius:10px;display:block;">
              </td>
            </tr>
          </table>
        </td>
        <td style="padding:12px 14px;border-bottom:1px solid ${COLORS.border};vertical-align:top;">
          <div style="font-size:14px;font-weight:600;color:${COLORS.ink};">${safeName}</div>
          ${variant}
          ${flashTag}
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
    role === 'buyer'
      ? `${FRONTEND_URL}/profile.html?tab=orders`
      : `${SELLER_URL}/seller-dashboard.html`; // ASSUMED — confirm seller dashboard filename

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
    ${securityWarningBox()}
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
    ${securityWarningBox()}
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
  const trackUrl = `${FRONTEND_URL}/profile.html?tab=orders&orderId=${order._id}`;
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
  const manageUrl = `${SELLER_URL}/seller-dashboard.html?tab=orders&orderId=${order._id}`; // ASSUMED
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
  const verifyUrl = `${ADMIN_URL}?section=orders&paymentStatus=pending_verification`;
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
  const trackUrl = `${FRONTEND_URL}/profile.html?tab=orders&orderId=${order._id}`;

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
  const trackUrl = `${FRONTEND_URL}/profile.html?tab=orders&orderId=${order._id}`;

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
  const reviewUrl = `${ADMIN_URL}?section=products&status=pending`;
  const img = (product.images && product.images[0]) || NO_IMAGE_FALLBACK;

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
  const productUrl = `${FRONTEND_URL}/product-detail.html?id=${product._id}`;
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
  const editUrl = `${SELLER_URL}/seller-dashboard.html?tab=products&action=edit&id=${product._id}`; // ASSUMED
  const bodyHtml = `
    ${infoCard([['Product', product.name]])}
    ${reasonBox(reason)}
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
/* SELLER VERIFICATION (KYC) EMAILS                                  */
/* ================================================================ */

// Seller-facing receipt, sent the moment documents are submitted (or
// resubmitted after a rejection).
function verificationSubmittedSellerTemplate({ sellerName, tier }) {
  const tierLabel = tier === 'business' ? 'Business' : 'Basic (ID + KRA)';
  const statusUrl = `${SELLER_URL}/seller-dashboard.html?tab=verification`; // ASSUMED
  const bodyHtml = `
    ${infoCard([
      ['Verification Tier', tierLabel],
      ['Status', 'Pending Review'],
    ])}
    <p style="margin:0 0 4px;font-size:14px;line-height:1.6;color:${COLORS.ink};">
      Our team typically reviews submissions within 24–48 hours. We'll email you the outcome as soon as a decision is made.
    </p>
    ${button(statusUrl, 'View Submission Status')}
  `;
  return baseLayout({
    preheader: `We've received your verification documents, ${sellerName || 'there'}.`,
    eyebrow: 'Seller Verification',
    title: 'Documents Received ✅',
    intro: `Hi ${sellerName?.split(' ')[0] || 'there'}, thanks for submitting your seller verification documents.`,
    bodyHtml,
    footerNote: 'Keep an eye on your inbox — we\u2019ll notify you the moment your review is complete.',
  });
}

// Admin notification — a seller's KYC package is ready for review.
function verificationSubmittedAdminTemplate({ sellerName, sellerEmail, tier }) {
  const reviewUrl = `${ADMIN_URL}?section=seller-verifications&status=pending`;
  const tierLabel = tier === 'business' ? 'Business' : 'Basic (ID + KRA)';
  const bodyHtml = `
    ${infoCard([
      ['Seller', sellerName || 'N/A'],
      ['Email', sellerEmail || 'N/A'],
      ['Tier', tierLabel],
    ])}
    ${button(reviewUrl, 'Review Submission', COLORS.warning)}
  `;
  return baseLayout({
    preheader: `${sellerName || 'A seller'} submitted verification documents for review`,
    eyebrow: 'Admin Alert',
    title: 'New Seller Verification Submitted',
    intro: 'A seller just submitted their verification documents and is waiting for review.',
    bodyHtml,
  });
}

// Seller-facing decision — approved or rejected, with reason when rejected.
function verificationDecisionTemplate({ sellerName, decision, reason }) {
  const isApproved = decision === 'approved';
  const dashboardUrl = `${SELLER_URL}/seller-dashboard.html`; // ASSUMED
  const editUrl = `${SELLER_URL}/seller-dashboard.html?tab=verification`; // ASSUMED
  const bodyHtml = `
    <div style="text-align:center;background:${COLORS.chip};border-radius:12px;padding:22px;margin:8px 0 20px;">
      ${statusBadge(isApproved ? 'Verified' : 'Not Approved', isApproved ? 'success' : 'danger')}
    </div>
    ${!isApproved ? reasonBox(reason) : ''}
    <p style="margin:0 0 4px;font-size:14px;line-height:1.6;color:${COLORS.ink};">
      ${isApproved
        ? 'You\u2019re now a verified seller. Your storefront badge is active and buyers can trust your listings at a glance.'
        : 'Please review the reason above, update your documents, and resubmit for another review.'}
    </p>
    ${button(isApproved ? dashboardUrl : editUrl, isApproved ? 'Go to Dashboard' : 'Update &amp; Resubmit', isApproved ? COLORS.success : COLORS.danger)}
  `;
  return baseLayout({
    preheader: isApproved ? 'Your seller verification was approved' : 'Your seller verification needs changes',
    eyebrow: 'Seller Verification',
    title: isApproved ? 'You\u2019re Verified! 🎉' : 'Verification Needs Changes',
    intro: `Hi ${sellerName?.split(' ')[0] || 'there'},`,
    bodyHtml,
  });
}

/* ================================================================ */
/* FLASH SALE EMAILS                                                  */
/* ================================================================ */

// Seller-facing receipt, sent the moment a Flash Sale is submitted.
function flashSaleSubmittedSellerTemplate({ sellerName, product, flashSale }) {
  const statusUrl = `${SELLER_URL}/seller-dashboard.html?tab=flash-sales`; // ASSUMED
  const bodyHtml = `
    ${infoCard([
      ['Product', product.name],
      ['Flash Sale Price', money(flashSale.flashSalePrice)],
      ['Units Allocated', String(flashSale.stockAllocated)],
      ['Sale Date', fmtDate(flashSale.saleDate)],
      ['Status', 'Pending Review'],
    ])}
    <p style="margin:0 0 4px;font-size:14px;line-height:1.6;color:${COLORS.ink};">
      We'll review your submission and let you know as soon as it's approved or if changes are needed.
    </p>
    ${button(statusUrl, 'View My Flash Sales')}
  `;
  return baseLayout({
    preheader: `Your Flash Sale submission for "${product.name}" was received`,
    eyebrow: 'Flash Sale',
    title: 'Flash Sale Submitted ✅',
    intro: `Hi ${sellerName?.split(' ')[0] || 'there'}, thanks for submitting a Flash Sale.`,
    bodyHtml,
  });
}

// Admin notification — a Flash Sale submission is ready for review.
function flashSaleSubmittedAdminTemplate({ sellerName, sellerEmail, product, flashSale }) {
  const reviewUrl = `${ADMIN_URL}?section=flash-sales&status=pending_review`;
  const bodyHtml = `
    ${infoCard([
      ['Seller', sellerName || 'N/A'],
      ['Email', sellerEmail || 'N/A'],
      ['Product', product.name],
      ['Flash Sale Price', money(flashSale.flashSalePrice)],
      ['Discount', `${flashSale.discountPercent}%`],
      ['Units Allocated', String(flashSale.stockAllocated)],
      ['Sale Date', fmtDate(flashSale.saleDate)],
    ])}
    ${button(reviewUrl, 'Review Flash Sale', COLORS.warning)}
  `;
  return baseLayout({
    preheader: `${sellerName || 'A seller'} submitted a Flash Sale for "${product.name}"`,
    eyebrow: 'Admin Alert',
    title: 'New Flash Sale Submitted',
    intro: 'A seller just submitted a Flash Sale and is waiting for review.',
    bodyHtml,
  });
}

// Seller-facing decision — approved or rejected, with reason when rejected.
function flashSaleDecisionTemplate({ sellerName, product, flashSale, decision, reason }) {
  const isApproved = decision === 'approved';
  const manageUrl = `${SELLER_URL}/seller-dashboard.html?tab=flash-sales`; // ASSUMED
  const bodyHtml = `
    <div style="text-align:center;background:${COLORS.chip};border-radius:12px;padding:22px;margin:8px 0 20px;">
      ${statusBadge(isApproved ? 'Approved' : 'Rejected', isApproved ? 'success' : 'danger')}
    </div>
    ${infoCard([
      ['Product', product.name],
      ['Flash Sale Price', money(flashSale.flashSalePrice)],
      ['Sale Date', fmtDate(flashSale.saleDate)],
    ])}
    ${!isApproved ? reasonBox(reason) : ''}
    ${button(manageUrl, isApproved ? 'View Flash Sale' : 'Submit Another', isApproved ? COLORS.success : COLORS.danger)}
  `;
  return baseLayout({
    preheader: isApproved
      ? `Your Flash Sale for "${product.name}" was approved`
      : `Your Flash Sale for "${product.name}" was rejected`,
    eyebrow: 'Flash Sale',
    title: isApproved ? 'Flash Sale Approved 🎉' : 'Flash Sale Rejected',
    intro: `Hi ${sellerName?.split(' ')[0] || 'there'},`,
    bodyHtml,
  });
}

/* ================================================================ */
/* SHOP EMAILS                                                       */
/* ================================================================ */

// Seller-facing receipt, sent when a shop is created or resubmitted for
// review after being edited.
function shopSubmittedSellerTemplate({ sellerName, shop }) {
  const statusUrl = `${SELLER_URL}/seller-dashboard.html?tab=shop`; // ASSUMED
  const bodyHtml = `
    ${infoCard([
      ['Shop Name', shop.shopName],
      ['Status', 'Pending Approval'],
    ])}
    <p style="margin:0 0 4px;font-size:14px;line-height:1.6;color:${COLORS.ink};">
      We'll review your shop details and notify you as soon as a decision is made.
    </p>
    ${button(statusUrl, 'View Shop Status')}
  `;
  return baseLayout({
    preheader: `Your shop "${shop.shopName}" was submitted for approval`,
    eyebrow: 'Shop Setup',
    title: 'Shop Submitted ✅',
    intro: `Hi ${sellerName?.split(' ')[0] || 'there'}, thanks for setting up your shop.`,
    bodyHtml,
  });
}

// Admin notification — a shop is ready for review.
function shopSubmittedAdminTemplate({ sellerName, sellerEmail, shop }) {
  const reviewUrl = `${ADMIN_URL}?section=shops&status=pending_approval`;
  const bodyHtml = `
    ${infoCard([
      ['Seller', sellerName || 'N/A'],
      ['Email', sellerEmail || 'N/A'],
      ['Shop Name', shop.shopName],
      ['Category', shop.businessCategory || 'N/A'],
    ])}
    ${button(reviewUrl, 'Review Shop', COLORS.warning)}
  `;
  return baseLayout({
    preheader: `${sellerName || 'A seller'} submitted a shop for approval`,
    eyebrow: 'Admin Alert',
    title: 'New Shop Submitted',
    intro: 'A seller just submitted a shop and is waiting for approval.',
    bodyHtml,
  });
}

// Seller-facing decision — approved or rejected, with reason when rejected.
function shopDecisionTemplate({ sellerName, shop, decision, reason }) {
  const isApproved = decision === 'approved';
  const manageUrl = `${SELLER_URL}/seller-dashboard.html?tab=shop`; // ASSUMED
  const bodyHtml = `
    <div style="text-align:center;background:${COLORS.chip};border-radius:12px;padding:22px;margin:8px 0 20px;">
      ${statusBadge(isApproved ? 'Approved' : 'Rejected', isApproved ? 'success' : 'danger')}
    </div>
    ${infoCard([['Shop Name', shop.shopName]])}
    ${!isApproved ? reasonBox(reason) : ''}
    <p style="margin:0 0 4px;font-size:14px;line-height:1.6;color:${COLORS.ink};">
      ${isApproved
        ? 'Your shop is now live on the storefront.'
        : 'Please review the reason above, make changes, and update your shop to resubmit.'}
    </p>
    ${button(manageUrl, isApproved ? 'View My Shop' : 'Update Shop', isApproved ? COLORS.success : COLORS.danger)}
  `;
  return baseLayout({
    preheader: isApproved ? `Your shop "${shop.shopName}" was approved` : `Your shop "${shop.shopName}" was rejected`,
    eyebrow: 'Shop Setup',
    title: isApproved ? 'Shop Approved 🎉' : 'Shop Needs Changes',
    intro: `Hi ${sellerName?.split(' ')[0] || 'there'},`,
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
  reasonBox,
  securityWarningBox,
  orderItemsTable,
  FRONTEND_URL,
  ADMIN_URL,
  SELLER_URL,
  SUPPORT_EMAIL,
  LOGO_URL,
  NO_IMAGE_FALLBACK,

  // auth
  welcomeEmailTemplate,
  passwordResetEmailTemplate,
  emailOtpTemplate,

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

  // seller verification (KYC)
  verificationSubmittedSellerTemplate,
  verificationSubmittedAdminTemplate,
  verificationDecisionTemplate,

  // flash sales
  flashSaleSubmittedSellerTemplate,
  flashSaleSubmittedAdminTemplate,
  flashSaleDecisionTemplate,

  // shops
  shopSubmittedSellerTemplate,
  shopSubmittedAdminTemplate,
  shopDecisionTemplate,

  // agents
  agentWelcomeTemplate,
};