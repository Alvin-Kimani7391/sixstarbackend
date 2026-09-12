// utils/marketingEmailTemplates.js
//
// Promotional-campaign email rendering, built ENTIRELY on top of the
// existing utils/emailTemplates.js helpers (baseLayout/button/COLORS/etc).
// This file is additive — it does not modify emailTemplates.js at all,
// so nothing already using that file can break.
//
// Usage:
//   const { promotionalCampaignTemplate } = require('./marketingEmailTemplates');
//   const html = promotionalCampaignTemplate({ campaign, subscriber, recommendedProducts, unsubscribeUrl, trackingPixelUrl });
//
// ---------------------------------------------------------------------------
// REDESIGN NOTES — 2026-09-12
// ---------------------------------------------------------------------------
// 1) HEAD-INJECTED CSS (the actual mobile bug):
//    baseLayout() from emailTemplates.js already has a working responsive
//    <style> block, but it lives in the document <head> — that's WHY those
//    transactional emails render correctly on phones. The old version of
//    this file built its own <style> block (emkResponsiveStyleBlock) and
//    dropped it into `bodyHtml`, which baseLayout places inside a <td> in
//    the <body>. Plenty of mobile mail clients only honor <style> tags that
//    live in <head> and strip (or ignore the @media rules inside) any
//    <style> tag they find in the body. Result: on phones, the campaign
//    email fell back to un-queried base styles and rendered like a
//    shrunken desktop layout instead of a real mobile layout — exactly the
//    symptom reported.
//
//    Fix: baseLayout() returns a finished HTML string. We don't touch
//    emailTemplates.js — instead we splice our <style> block into that
//    string's <head> ourselves (see injectStyleIntoHead below), so our
//    media queries live in the one place every client actually respects.
//
// 2) MOBILE-FIRST SIZING:
//    Card/hero/text sizing is now written so the DEFAULT (no media query
//    required) values are the phone-appropriate ones, and a `min-width`
//    query only *upsizes* for a wider preview pane. That way, even if some
//    exotic client strips media queries entirely, a phone still sees the
//    correctly-sized layout rather than a desktop one waiting to be
//    shrunk down.
//
// 3) ANTI-STRETCH:
//    - The product rail cards are still FIXED PIXEL WIDTH (never %), which
//      is what actually prevents stretching in the scrolling rail. Do not
//      change these to percentage widths — that's the exact regression
//      that caused the stretching/oversized-image problem previously.
//    - The one real stretch risk left was the classic Windows-desktop-
//      Outlook fallback grid: Word's rendering engine ignores
//      `object-fit`, so a plain `<img width height>` there squashes any
//      image that isn't exactly the target aspect ratio. That's now
//      rendered with the standard VML bulletproof-image pattern
//      (`v:rect` + `v:fill type="frame"`), which crops-to-fill instead of
//      stretching — still fully inside the existing `<!--[if mso]>` guard,
//      so every other client is unaffected.

const {
  baseLayout,
  button,
  COLORS,
  money,
  NO_IMAGE_FALLBACK,
  FRONTEND_URL,
  SUPPORT_EMAIL,
} = require('./emailTemplates');

// ---------------------------------------------------------------------------
// Head-injection helper
// ---------------------------------------------------------------------------
// baseLayout() gives us back a complete <!DOCTYPE html>...<head>...</head>
// document as a string. We splice our own <style> block right before
// </head> so it lives in the same trusted location as baseLayout's own
// responsive rules, instead of inside the body content.
function injectStyleIntoHead(html, css) {
  const styleTag = `<style>${css}</style>`;
  if (html.includes('</head>')) {
    return html.replace('</head>', `${styleTag}</head>`);
  }
  // Extremely defensive fallback — should never trigger against the real
  // baseLayout() output, but guarantees we never silently drop the styles.
  return styleTag + html;
}

// ---------------------------------------------------------------------------
// Styles (now destined for <head>, not the body)
// ---------------------------------------------------------------------------
//
// Horizontal scroll + hidden scrollbar works in: Apple Mail (iOS/macOS),
// the Gmail app (iOS/Android), Gmail webmail, Yahoo Mail, Outlook.com,
// Outlook mobile (iOS/Android — NOT the same engine as Outlook desktop),
// and most other modern clients.
//
// Windows desktop Outlook (2016/2019/365 "classic") renders email with
// Word's engine, not a browser engine — it does not support overflow
// scrolling, flexbox, or reliable position:absolute. There's no CSS trick
// that makes a scroll rail work there. So that one client gets its own
// static fallback via `<!--[if mso]>` conditional comments, using a
// fixed-pixel-width table (never %, so it can't stretch), with crop-safe
// VML images. Every other client renders the real scrolling rail.
function marketingStyleSheet() {
  return `
    .emk-scroll {
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
      -ms-overflow-style: none;
    }
    .emk-scroll::-webkit-scrollbar { display: none; height: 0; width: 0; }
    .emk-card { scroll-snap-align: start; }

    /* Base sizes below (set inline on the elements) are already tuned for
       a ~360-430px phone screen, since that's where most opens happen.
       These queries only ENHANCE for a wider preview pane — they are not
       relied upon to make things smaller, so a client that ignores media
       queries still shows a correctly-sized mobile layout by default. */
    @media only screen and (min-width: 481px) {
      .emk-card { width: 172px !important; max-width: 172px !important; }
      .emk-card-img { height: 148px !important; }
      .emk-hero-img { max-height: 320px !important; }
    }
    @media only screen and (max-width: 359px) {
      .emk-card { width: 130px !important; max-width: 130px !important; }
      .emk-card-img { height: 112px !important; }
      .emk-card-title { font-size: 12px !important; height: 31px !important; }
    }
  `;
}

// ---------------------------------------------------------------------------
// Single product card (used inside the scroll rail)
// ---------------------------------------------------------------------------
function productCardHtml(p, campaignClickUrl) {
  const url = campaignClickUrl
    ? `${campaignClickUrl}?redirect=${encodeURIComponent(`${FRONTEND_URL}/product-detail.html?id=${p.id}`)}`
    : `${FRONTEND_URL}/product-detail.html?id=${p.id}`;

  const img = p.image || NO_IMAGE_FALLBACK;
  const name = (p.name || 'Product').toString();
  const sellerLabel = p.sellerType || 'Retail seller';

  const hasDiscount = p.originalPrice && Number(p.originalPrice) > Number(p.price);
  const discountPct = hasDiscount
    ? (p.discountPercent || Math.round((1 - Number(p.price) / Number(p.originalPrice)) * 100))
    : null;

  const priceHtml = hasDiscount
    ? `<span style="font-weight:800;color:${COLORS.accent};font-size:14px;">${money(p.price)}</span>
       <div style="text-decoration:line-through;color:${COLORS.muted};font-size:11.5px;margin-top:1px;">${money(p.originalPrice)}</div>`
    : `<span style="font-weight:800;color:${COLORS.ink};font-size:14px;">${money(p.price)}</span>`;

  const discountBadge = hasDiscount
    ? `<span style="position:absolute;top:8px;left:8px;background:${COLORS.accent};color:#ffffff;font-size:10px;font-weight:800;letter-spacing:.2px;padding:3px 7px;border-radius:20px;line-height:1;">-${discountPct}%</span>`
    : '';

  const hotBadge = p.isHot
    ? `<span style="position:absolute;top:8px;right:8px;background:#14151a;color:#ffffff;font-size:10px;font-weight:800;padding:3px 8px;border-radius:20px;line-height:1;white-space:nowrap;">🔥 Hot</span>`
    : '';

  // Explicit alt text + styled fallback text (font-size/color/family) so
  // that when a client blocks images by default on first open, the
  // placeholder reads as an intentional label instead of tiny blue
  // underlined browser-default text.
  const altStyle = `color:${COLORS.muted};font-size:11px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;`;

  return `
    <a href="${url}" target="_blank" class="emk-card"
       style="display:inline-block;vertical-align:top;width:150px;max-width:150px;white-space:normal;
              margin:0 10px 0 0;text-decoration:none;background:${COLORS.card};
              border:1px solid ${COLORS.border};border-radius:12px;overflow:hidden;
              box-shadow:0 1px 3px rgba(16,29,49,0.07);">
      <div style="position:relative;width:100%;background:${COLORS.chip};line-height:0;">
        <img class="emk-card-img" src="${img}" width="150" alt="${name}" bgcolor="${COLORS.chip}"
             style="display:block;width:100%;height:128px;object-fit:cover;background:${COLORS.chip};${altStyle}">
        ${discountBadge}
        ${hotBadge}
      </div>
      <div style="padding:11px 12px 13px;">
        <div class="emk-card-title" style="font-size:13px;font-weight:600;color:${COLORS.ink};
             line-height:1.35;height:35px;overflow:hidden;margin-bottom:7px;word-break:break-word;">
          ${name}
        </div>
        <div style="font-size:11px;color:${COLORS.muted};margin-bottom:9px;">🏬 ${sellerLabel}</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td valign="middle" style="text-align:left;">${priceHtml}</td>
            <td valign="middle" width="26" style="text-align:right;">
              <span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;
                    border-radius:50%;background:${COLORS.chip};color:${COLORS.ink};font-size:12px;font-weight:700;">→</span>
            </td>
          </tr>
        </table>
      </div>
    </a>`;
}

// A trailing "See all" card at the end of the rail, matching card sizing.
function viewAllCardHtml(viewAllUrl) {
  if (!viewAllUrl) return '';
  return `
    <a href="${viewAllUrl}" target="_blank" class="emk-card"
       style="display:inline-block;vertical-align:top;width:150px;max-width:150px;height:210px;
              white-space:normal;margin:0 10px 0 0;text-decoration:none;
              border:1.5px dashed ${COLORS.border};border-radius:12px;
              background:${COLORS.bg};text-align:center;">
      <table role="presentation" width="100%" height="210" cellpadding="0" cellspacing="0">
        <tr>
          <td align="center" valign="middle" style="padding:0 14px;">
            <span style="font-size:20px;display:block;margin-bottom:8px;">→</span>
            <span style="font-size:12.5px;font-weight:700;color:${COLORS.accent};">See all deals</span>
          </td>
        </tr>
      </table>
    </a>`;
}

// Static fixed-pixel-width fallback table for Windows desktop Outlook only
// (rendered inside `<!--[if mso]>`). Fixed px widths so it can never
// stretch horizontally — and each image is now rendered as a VML
// "bulletproof image" (v:rect + v:fill type="frame"), which crops to fill
// the box instead of squashing it, since Word's engine ignores
// `object-fit` entirely and a plain <img width height> there WILL distort
// any image that isn't exactly the target aspect ratio.
function outlookFallbackGridHtml(products, campaignClickUrl) {
  if (!products || !products.length) return '';
  const capped = products.slice(0, 4);
  const CARD_W = 260;
  const IMG_H = 150;

  const cellHtmlArr = capped.map((p) => {
    const url = campaignClickUrl
      ? `${campaignClickUrl}?redirect=${encodeURIComponent(`${FRONTEND_URL}/product-detail.html?id=${p.id}`)}`
      : `${FRONTEND_URL}/product-detail.html?id=${p.id}`;
    const img = p.image || NO_IMAGE_FALLBACK;
    const name = (p.name || 'Product').toString();
    const priceHtml = p.originalPrice && Number(p.originalPrice) > Number(p.price)
      ? `<span style="font-weight:800;color:${COLORS.accent};">${money(p.price)}</span>
         <span style="text-decoration:line-through;color:${COLORS.muted};font-size:11px;margin-left:6px;">${money(p.originalPrice)}</span>`
      : `<span style="font-weight:800;color:${COLORS.ink};">${money(p.price)}</span>`;

    return `
      <td width="${CARD_W}" valign="top" style="padding:8px;">
        <a href="${url}" target="_blank" style="text-decoration:none;display:block;border:1px solid ${COLORS.border};border-radius:12px;overflow:hidden;background:${COLORS.card};">
          <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false"
                  style="width:${CARD_W}px;height:${IMG_H}px;display:block;">
            <v:fill type="frame" src="${img}" color="${COLORS.chip}" />
            <w:anchorlock/>
          </v:rect>
          <div style="padding:12px 14px;">
            <div style="font-size:13px;font-weight:600;color:${COLORS.ink};line-height:1.4;margin-bottom:6px;">${name}</div>
            <div style="font-size:14px;">${priceHtml}</div>
          </div>
        </a>
      </td>`;
  });

  let rowsHtml = '';
  for (let i = 0; i < cellHtmlArr.length; i += 2) {
    rowsHtml += `<tr>${cellHtmlArr[i]}${cellHtmlArr[i + 1] || `<td width="${CARD_W}"></td>`}</tr>`;
  }

  return `<table role="presentation" width="${CARD_W * 2 + 32}" cellpadding="0" cellspacing="0" align="center">${rowsHtml}</table>`;
}

// ---------------------------------------------------------------------------
// Public: horizontally-scrolling product rail (+ Outlook desktop fallback)
// ---------------------------------------------------------------------------
function productGridHtml(products, campaignClickUrl, viewAllUrl) {
  if (!products || !products.length) return '';

  const cardsHtml = products.map((p) => productCardHtml(p, campaignClickUrl)).join('');
  const trailingCard = viewAllCardHtml(viewAllUrl);

  return `
    <!--[if mso]>
    ${outlookFallbackGridHtml(products, campaignClickUrl)}
    <![endif]-->
    <!--[if !mso]><!-->
    <div class="emk-scroll" style="overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;
         white-space:nowrap;scroll-snap-type:x proximity;padding:6px 0 16px;margin:0 0 4px;">
      ${cardsHtml}${trailingCard}
    </div>
    <!--<![endif]-->`;
}

function unsubscribeFooterHtml(unsubscribeUrl) {
  return `
    <p style="margin:22px 0 0;font-size:11.5px;color:${COLORS.muted};text-align:center;line-height:1.6;">
      You're receiving this because you browsed or shopped on Six Star Suppliers.<br>
      <a href="${unsubscribeUrl}" style="color:${COLORS.muted};text-decoration:underline;">Unsubscribe</a> from promotional emails ·
      <a href="mailto:${SUPPORT_EMAIL}" style="color:${COLORS.muted};text-decoration:underline;">Contact support</a>
    </p>`;
}

// ---------------------------------------------------------------------------
// Main promotional / recommendation campaign email
// ---------------------------------------------------------------------------
function promotionalCampaignTemplate({
  campaign,
  subscriber,
  recommendedProducts = [],
  unsubscribeUrl,
  clickTrackingBaseUrl, // e.g. https://api.../marketing/email/click/:token?url=  (token per-recipient)
  openPixelUrl, // e.g. https://api.../marketing/email/open/:token.png
}) {
  const name = subscriber?.name ? subscriber.name.split(' ')[0] : 'there';

  // Merge simple placeholders in admin-authored copy.
  let bodyHtml = campaign.bodyHtml || '';
  bodyHtml = bodyHtml.replace(/\{\{\s*name\s*\}\}/gi, name);

  const hasRecommendedPlaceholder = /\{\{\s*recommended_products\s*\}\}/i.test(bodyHtml);
  const gridHtml = recommendedProducts.length
    ? productGridHtml(recommendedProducts, clickTrackingBaseUrl, campaign.viewAllUrl)
    : '';

  if (hasRecommendedPlaceholder) {
    bodyHtml = bodyHtml.replace(/\{\{\s*recommended_products\s*\}\}/gi, gridHtml);
  } else if (campaign.contentType === 'auto_recommendation' && gridHtml) {
    const sectionLabel = subscriber?.searchHistory?.length || subscriber?.viewedProducts?.length
      ? 'Recommended for you'
      : 'You might also like';
    bodyHtml += `
      <h3 class="emk-section-title" style="margin:26px 0 12px;font-size:15px;font-weight:700;color:${COLORS.ink};">
        🔥 ${sectionLabel}
      </h3>
      ${gridHtml}`;
  }

  const heroHtml = campaign.heroImageUrl
    ? `<img class="emk-hero-img" src="${campaign.heroImageUrl}" alt="" style="width:100%;max-width:100%;height:auto;max-height:240px;object-fit:cover;border-radius:12px;display:block;margin-bottom:20px;background:${COLORS.chip};">`
    : '';

  const ctaHtml = campaign.ctaUrl
    ? button(
        clickTrackingBaseUrl ? `${clickTrackingBaseUrl}?redirect=${encodeURIComponent(campaign.ctaUrl)}` : campaign.ctaUrl,
        campaign.ctaText || 'Shop Now'
      )
    : '';

  const pixelHtml = openPixelUrl
    ? `<img src="${openPixelUrl}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px;">`
    : '';

  // Note: no <style> tag here anymore — marketingStyleSheet() gets spliced
  // into <head> below, after baseLayout() builds the full document.
  const bodyWithExtras = `
    ${heroHtml}
    <div class="emk-body-text" style="font-size:15px;line-height:1.7;color:${COLORS.ink};white-space:pre-wrap;word-break:break-word;">${bodyHtml}</div>
    ${ctaHtml}
    ${unsubscribeFooterHtml(unsubscribeUrl)}
    ${pixelHtml}
  `;

  const rawHtml = baseLayout({
    preheader: campaign.previewText || campaign.subject,
    eyebrow: campaign.fromName || 'Six Star Suppliers',
    title: campaign.subject,
    intro: '',
    bodyHtml: bodyWithExtras,
  });

  // This is the actual mobile fix: splice our responsive rules into
  // <head> instead of leaving them inside the body, where many mobile
  // clients strip them.
  return injectStyleIntoHead(rawHtml, marketingStyleSheet());
}

// Small standalone confirmation page shown right after clicking Unsubscribe
// (served directly by the backend — no frontend page needed).
function unsubscribeConfirmedPageHtml({ email }) {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Unsubscribed — Six Star Suppliers</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:${COLORS.bg};margin:0;padding:60px 20px;text-align:center;">
  <div style="max-width:420px;margin:0 auto;background:${COLORS.card};border-radius:16px;padding:36px;box-shadow:0 10px 40px rgba(16,29,49,0.10);">
    <div style="font-size:40px;margin-bottom:12px;">✅</div>
    <h1 style="font-size:20px;color:${COLORS.ink};margin:0 0 10px;">You've been unsubscribed</h1>
    <p style="font-size:14px;color:${COLORS.muted};line-height:1.6;">${email ? `${email} will` : 'You will'} no longer receive promotional emails from Six Star Suppliers. You may still receive essential account and order emails.</p>
    <a href="${FRONTEND_URL}" style="display:inline-block;margin-top:18px;padding:12px 24px;background:${COLORS.accent};color:#fff;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px;">Back to Six Star Suppliers</a>
  </div>
</body></html>`;
}

module.exports = {
  productGridHtml,
  promotionalCampaignTemplate,
  unsubscribeConfirmedPageHtml,
};