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
// REDESIGN NOTES
// ---------------------------------------------------------------------------
// v2: fixed the mobile-tiny-text bug. baseLayout() from emailTemplates.js
// already has working responsive CSS, but it lives in <head> — that's WHY
// transactional emails render correctly on phones. This file's <style>
// block used to live in `bodyHtml` (inside <body>), and many mobile clients
// only honor <style> tags in <head>, so the media queries were silently
// dropped and phones fell back to desktop sizing. Fix: splice our <style>
// into the finished document's <head> ourselves (injectStyleIntoHead).
//
// v3: removed the horizontal scroll rail, replaced it with a real 2-per-row
// TABLE that wraps to additional rows — no scroll gesture needed to see
// every product.
//
// v4 (this pass): the v3 rewrite accidentally swapped the cards' FIXED
// pixel widths/image heights (150px / 128px, 172px / 148px, 130px / 112px)
// for percentage-width table columns with a shorter fixed image height.
// That's what caused the re-introduced stretched/cropped look. Reverted:
// card widths and image heights are back to the exact fixed-px values from
// the scroll-rail version — ONLY the outer container changed, from a
// horizontally-scrolling <div> to a plain 2-column <table> that the cards
// sit inside unchanged. Because the cards are still fixed-px (never %),
// they cannot stretch regardless of how wide their table cell is — that
// remains the actual anti-stretch guarantee, exactly as before.
//
// Since the live markup is now a genuine HTML <table> (not a scrolling
// <div>), the old separate Windows-desktop-Outlook fallback table + VML
// crop hack is no longer needed — Outlook renders this exact same table
// like every other client. One layout, one code path, everywhere.

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
function injectStyleIntoHead(html, css) {
  const styleTag = `<style>${css}</style>`;
  if (html.includes('</head>')) {
    return html.replace('</head>', `${styleTag}</head>`);
  }
  return styleTag + html;
}

// ---------------------------------------------------------------------------
// Styles (destined for <head>)
// ---------------------------------------------------------------------------
// Same exact pixel values as the scroll-rail version — nothing about
// card/image/text sizing changed, only the container that holds the cards.
function marketingStyleSheet() {
  return `
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
// Single product card — fixed pixel width/height, unchanged from the
// scroll-rail version.
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

  const altStyle = `color:${COLORS.muted};font-size:11px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;`;

  return `
    <a href="${url}" target="_blank" class="emk-card"
       style="display:inline-block;vertical-align:top;width:150px;max-width:150px;white-space:normal;
              text-decoration:none;background:${COLORS.card};
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

// "See all" card — same fixed sizing as before, unchanged.
function viewAllCardHtml(viewAllUrl) {
  if (!viewAllUrl) return '';
  return `
    <a href="${viewAllUrl}" target="_blank" class="emk-card"
       style="display:inline-block;vertical-align:top;width:150px;max-width:150px;height:210px;
              white-space:normal;text-decoration:none;
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

// ---------------------------------------------------------------------------
// Public: 2-per-row wrapping product grid (no scrolling)
// ---------------------------------------------------------------------------
function productGridHtml(products, campaignClickUrl, viewAllUrl) {
  if (!products || !products.length) return '';

  const cards = products.map((p) => productCardHtml(p, campaignClickUrl));
  const trailingCard = viewAllCardHtml(viewAllUrl);
  if (trailingCard) cards.push(trailingCard);

  const CELL_GAP = 10; // horizontal breathing room between the 2 columns
  let rowsHtml = '';
  for (let i = 0; i < cards.length; i += 2) {
    const left = cards[i];
    const right = cards[i + 1]; // undefined if this is a trailing odd card
    rowsHtml += `
      <tr>
        <td valign="top" style="padding:0 ${CELL_GAP / 2}px 14px 0;">${left}</td>
        <td valign="top" style="padding:0 0 14px ${CELL_GAP / 2}px;">${right || ''}</td>
      </tr>`;
  }

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 2px;">
      ${rowsHtml}
    </table>`;
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
  clickTrackingBaseUrl,
  openPixelUrl,
}) {
  const name = subscriber?.name ? subscriber.name.split(' ')[0] : 'there';

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

  return injectStyleIntoHead(rawHtml, marketingStyleSheet());
}

// Small standalone confirmation page shown right after clicking Unsubscribe
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