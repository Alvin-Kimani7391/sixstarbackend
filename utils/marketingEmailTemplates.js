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
// v2 (2026-09-12, earlier pass): fixed the mobile-tiny-text bug. baseLayout()
// from emailTemplates.js already has working responsive CSS, but it lives in
// <head> — that's WHY transactional emails render correctly on phones. This
// file's old <style> block lived in `bodyHtml` (inside <body>), and many
// mobile clients only honor <style> tags in <head>, so the media queries
// were silently dropped and phones fell back to desktop sizing. Fix: splice
// our <style> into the finished document's <head> ourselves.
//
// v3 (this pass): REMOVED the horizontal scrolling product rail entirely,
// per request. On a phone the rail only ever showed ~2 cards at a time
// anyway (the rest were hidden off-screen behind a scroll gesture people
// don't always discover), so it's replaced with a real wrapping GRID: 2
// products per row, and any additional products simply continue on the row(s)
// below — no scrolling required to see everything.
//
// Why this also fixes the Outlook-desktop stretching risk instead of just
// avoiding it: the old design needed a *separate* fixed-pixel-width fallback
// table (plus a VML crop hack) purely because the live version was a
// non-table scrolling <div>, which Windows desktop Outlook's Word engine
// can't render at all. A table-based grid IS a real HTML table, so Outlook
// renders the exact same markup as every other client — there is no longer
// a second fallback code path to keep in sync or get out of alignment with
// the default view. One layout, one path, every client.
//
// Anti-stretch guarantee for the grid itself: columns are percentage-width
// <td>s (so 2 fit per row at ANY screen width, phone or desktop), but every
// product image inside them has a FIXED height with object-fit:cover. A
// percentage-width column only ever changes how much of the image is
// visible — it can never distort/stretch it, because height and crop
// behavior aren't tied to the column width. That's the actual guard against
// the old stretching bug, not the specific layout style.

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
// responsive rules, instead of inside the body content where many mobile
// clients ignore it.
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
// Styles (destined for <head>)
// ---------------------------------------------------------------------------
// Mobile-first: the inline defaults on each element already target a phone
// screen. This min-width query only ENHANCES for a wider preview pane —
// it's never relied on to make things smaller, so a client that ignores
// media queries entirely still shows a correctly-sized mobile grid, not an
// oversized desktop one waiting to be shrunk.
function marketingStyleSheet() {
  return `
    .emk-cell-img {
      display:block;width:100%;height:118px;object-fit:cover;
    }
    .emk-cell-title {
      font-size:12.5px !important;
      height:33px !important;
    }
    @media only screen and (min-width: 481px) {
      .emk-cell-img { height:158px !important; }
      .emk-cell-title { font-size:14px !important; height:38px !important; }
      .emk-cell-price { font-size:15px !important; }
    }
  `;
}

// ---------------------------------------------------------------------------
// Single product cell (sits inside one <td> of the grid table)
// ---------------------------------------------------------------------------
function productCellHtml(p, campaignClickUrl) {
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
    ? `<span class="emk-cell-price" style="font-weight:800;color:${COLORS.accent};font-size:13px;">${money(p.price)}</span>
       <div style="text-decoration:line-through;color:${COLORS.muted};font-size:11px;margin-top:1px;">${money(p.originalPrice)}</div>`
    : `<span class="emk-cell-price" style="font-weight:800;color:${COLORS.ink};font-size:13px;">${money(p.price)}</span>`;

  const discountBadge = hasDiscount
    ? `<span style="position:absolute;top:8px;left:8px;background:${COLORS.accent};color:#ffffff;font-size:10px;font-weight:800;letter-spacing:.2px;padding:3px 7px;border-radius:20px;line-height:1;">-${discountPct}%</span>`
    : '';

  const hotBadge = p.isHot
    ? `<span style="position:absolute;top:8px;right:8px;background:#14151a;color:#ffffff;font-size:10px;font-weight:800;padding:3px 8px;border-radius:20px;line-height:1;white-space:nowrap;">🔥 Hot</span>`
    : '';

  // Explicit alt text + styled fallback text so that if a client blocks
  // images by default on first open, the placeholder reads as an
  // intentional label instead of tiny blue underlined browser-default text.
  const altStyle = `color:${COLORS.muted};font-size:11px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;`;

  return `
    <a href="${url}" target="_blank"
       style="display:block;width:100%;text-decoration:none;background:${COLORS.card};
              border:1px solid ${COLORS.border};border-radius:12px;overflow:hidden;
              box-shadow:0 1px 3px rgba(16,29,49,0.07);">
      <div style="position:relative;width:100%;background:${COLORS.chip};line-height:0;">
        <img class="emk-cell-img" src="${img}" alt="${name}" bgcolor="${COLORS.chip}"
             style="display:block;width:100%;height:118px;object-fit:cover;background:${COLORS.chip};${altStyle}">
        ${discountBadge}
        ${hotBadge}
      </div>
      <div style="padding:10px 11px 12px;">
        <div class="emk-cell-title" style="font-size:12.5px;font-weight:600;color:${COLORS.ink};
             line-height:1.35;height:33px;overflow:hidden;margin-bottom:6px;word-break:break-word;">
          ${name}
        </div>
        <div style="font-size:10.5px;color:${COLORS.muted};margin-bottom:8px;">🏬 ${sellerLabel}</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td valign="middle" style="text-align:left;">${priceHtml}</td>
            <td valign="middle" width="24" style="text-align:right;">
              <span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;
                    border-radius:50%;background:${COLORS.chip};color:${COLORS.ink};font-size:12px;font-weight:700;">→</span>
            </td>
          </tr>
        </table>
      </div>
    </a>`;
}

// "See all" cell, sized and styled to sit as the final grid cell.
function viewAllCellHtml(viewAllUrl) {
  if (!viewAllUrl) return '';
  return `
    <a href="${viewAllUrl}" target="_blank"
       style="display:block;width:100%;height:100%;min-height:150px;text-decoration:none;
              border:1.5px dashed ${COLORS.border};border-radius:12px;
              background:${COLORS.bg};text-align:center;">
      <table role="presentation" width="100%" height="150" cellpadding="0" cellspacing="0">
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
// Public: 2-column wrapping product grid
// ---------------------------------------------------------------------------
// Renders as an actual <table>, so it needs no scroll gesture and no
// separate Outlook fallback — every client (including Windows desktop
// Outlook) sees the identical 2-per-row grid, with any extra products
// simply continuing on the next row.
function productGridHtml(products, campaignClickUrl, viewAllUrl) {
  if (!products || !products.length) return '';

  // Build the flat list of cells: every product, then the optional
  // trailing "see all" cell.
  const cells = products.map((p) => productCellHtml(p, campaignClickUrl));
  const trailing = viewAllCellHtml(viewAllUrl);
  if (trailing) cells.push(trailing);

  // Group into rows of 2. GAP is the horizontal breathing room between the
  // two columns, split evenly as right-padding on the left cell and
  // left-padding on the right cell so the outer edges stay flush with the
  // rest of the email's content column.
  const GAP = 12;
  const ROW_GAP = 14;
  let rowsHtml = '';
  for (let i = 0; i < cells.length; i += 2) {
    const left = cells[i];
    const right = cells[i + 1]; // may be undefined for a trailing odd cell

    rowsHtml += `
      <tr>
        <td width="50%" valign="top" style="padding:0 ${GAP / 2}px ${ROW_GAP}px 0;">
          ${left}
        </td>
        <td width="50%" valign="top" style="padding:0 0 ${ROW_GAP}px ${GAP / 2}px;">
          ${right || ''}
        </td>
      </tr>`;
  }

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;margin:4px 0 2px;">
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

  // Note: no <style> tag here — marketingStyleSheet() gets spliced into
  // <head> below, after baseLayout() builds the full document.
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

  // Splice our responsive rules into <head> instead of leaving them inside
  // the body, where many mobile clients strip them.
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