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

const {
  baseLayout,
  button,
  COLORS,
  money,
  NO_IMAGE_FALLBACK,
  FRONTEND_URL,
  SUPPORT_EMAIL,
} = require('./emailTemplates');

// A single, shared responsive stylesheet for the parts of the email this
// file controls (product grid + hero image). Rendered once per email,
// right before the content, so it's not duplicated if the grid function
// happens to be called more than once. Media queries here are widely
// supported by modern mobile mail clients (Apple Mail, Gmail app,
// Outlook mobile, Yahoo, most webmail) — older/legacy clients that
// ignore <style> media queries still get a sane, non-broken 2-column
// layout since every rule has a safe default value inline as well.
function emkResponsiveStyleBlock() {
  return `
    <style>
      @media only screen and (max-width:480px) {
        .emk-grid-td { display:block !important; width:100% !important; max-width:100% !important; padding:6px 0 !important; }
        .emk-grid-img { height:190px !important; }
        .emk-grid-title { font-size:13.5px !important; }
        .emk-hero-img { max-height:220px !important; }
        .emk-body-text { font-size:14.5px !important; line-height:1.6 !important; }
      }
    </style>`;
}

// Renders a responsive 2-across (desktop) / 1-across (phone) product grid.
// Every card links straight to the product's detail page — clicking the
// picture, name, or price all go to the same place, exactly like a normal
// e-commerce promo email.
function productGridHtml(products, campaignClickUrl) {
  if (!products || !products.length) return '';

  const cardHtmlArr = products.map((p) => {
    const url = campaignClickUrl
      ? `${campaignClickUrl}?redirect=${encodeURIComponent(`${FRONTEND_URL}/product-detail.html?id=${p.id}`)}`
      : `${FRONTEND_URL}/product-detail.html?id=${p.id}`;
    const img = p.image || NO_IMAGE_FALLBACK;
    const priceHtml = p.originalPrice
      ? `<span style="font-weight:800;color:${COLORS.accent};">${money(p.price)}</span>
         <span style="text-decoration:line-through;color:${COLORS.muted};font-size:11px;margin-left:6px;">${money(p.originalPrice)}</span>`
      : `<span style="font-weight:800;color:${COLORS.ink};">${money(p.price)}</span>`;
    return `
      <td class="emk-grid-td" width="50%" valign="top" style="padding:8px;">
        <a href="${url}" target="_blank" style="text-decoration:none;display:block;border:1px solid ${COLORS.border};border-radius:12px;overflow:hidden;background:${COLORS.card};">
          <img class="emk-grid-img" src="${img}" width="100%" alt="" style="display:block;width:100%;max-width:100%;height:150px;object-fit:cover;background:${COLORS.chip};">
          <div style="padding:12px 14px;">
            <div class="emk-grid-title" style="font-size:13px;font-weight:600;color:${COLORS.ink};line-height:1.4;margin-bottom:6px;word-break:break-word;">${(p.name || 'Product').toString()}</div>
            <div style="font-size:14px;">${priceHtml}</div>
          </div>
        </a>
      </td>`;
  });

  let rowsHtml = '';
  for (let i = 0; i < cardHtmlArr.length; i += 2) {
    rowsHtml += `<tr>${cardHtmlArr[i]}${cardHtmlArr[i + 1] || '<td class="emk-grid-td" width="50%"></td>'}</tr>`;
  }

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:100%;margin:6px 0 4px;">
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

// Main promotional / recommendation campaign email.
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
  const gridHtml = recommendedProducts.length ? productGridHtml(recommendedProducts, clickTrackingBaseUrl) : '';

  if (hasRecommendedPlaceholder) {
    bodyHtml = bodyHtml.replace(/\{\{\s*recommended_products\s*\}\}/gi, gridHtml);
  } else if (campaign.contentType === 'auto_recommendation' && gridHtml) {
    bodyHtml += `
      <h3 style="margin:24px 0 4px;font-size:15px;color:${COLORS.ink};">
        ${subscriber?.searchHistory?.length || subscriber?.viewedProducts?.length ? 'Recommended for you' : 'You might also like'}
      </h3>
      ${gridHtml}`;
  }

  const heroHtml = campaign.heroImageUrl
    ? `<img class="emk-hero-img" src="${campaign.heroImageUrl}" alt="" style="width:100%;max-width:100%;height:auto;max-height:320px;object-fit:cover;border-radius:12px;display:block;margin-bottom:18px;">`
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
    ${emkResponsiveStyleBlock()}
    ${heroHtml}
    <div class="emk-body-text" style="font-size:14px;line-height:1.7;color:${COLORS.ink};white-space:pre-wrap;word-break:break-word;">${bodyHtml}</div>
    ${ctaHtml}
    ${unsubscribeFooterHtml(unsubscribeUrl)}
    ${pixelHtml}
  `;

  return baseLayout({
    preheader: campaign.previewText || campaign.subject,
    eyebrow: campaign.fromName || 'Six Star Suppliers',
    title: campaign.subject,
    intro: '',
    bodyHtml: bodyWithExtras,
  });
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