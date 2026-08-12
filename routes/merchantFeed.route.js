/**
 * routes/merchantFeed.route.js
 * -----------------------------------------------------------------------
 * Generates a Google Merchant Center product feed, live from MongoDB, in
 * the RSS 2.0 + Google Shopping namespace format Merchant Center expects
 * for a "Scheduled fetch" feed.
 *
 * Mount on your Render backend (server.js), at the ROOT of the app:
 *
 *   app.use('/', require('./routes/merchantFeed.route'));
 *
 * Exposes: GET /merchant-feed.xml
 *
 * You give Merchant Center this URL directly — it does NOT need to be on
 * your sixstarsuppliers.com domain (unlike sitemap.xml, which does, per
 * the sitemap protocol). Only the <g:link> INSIDE each item needs to be a
 * verified/claimed URL on your real domain, which it is here.
 *
 * WHAT'S DELIBERATELY LEFT OUT (see the setup guide for why):
 *   - g:gtin / g:mpn — you don't have manufacturer identifiers, so every
 *     item sets identifier_exists=no instead, which is the compliant way
 *     to tell Google "this product genuinely has none," rather than
 *     omitting the field and risking a disapproval.
 *   - g:shipping — configure this once at the ACCOUNT level in Merchant
 *     Center's Shipping settings instead of per-item. Your delivery
 *     terms vary per product (simple vs heavy wholesale, free vs fixed
 *     vs quantity-based vs negotiated) in a way the feed's shipping
 *     schema can't cleanly express — account-level settings are the
 *     right tool for this, not a per-item override.
 *   - Variant-level items (Size/Color as separate feed entries linked by
 *     item_group_id) — this feed submits one entry per PRODUCT using its
 *     aggregate stock/base price. Full variant support is a documented
 *     follow-up, not implemented here (see bottom of this file).
 * -----------------------------------------------------------------------
 */

const express = require('express');
const router = express.Router();

const Product = require('../models/Product');

const SITE_URL = (process.env.SITE_URL || 'https://www.sixstarsuppliers.com').replace(/\/$/, '');
const CURRENCY = 'KES';
const MAX_ADDITIONAL_IMAGES = 9; // Google allows up to 10 image_link entries total (1 main + up to 9 additional)

function xmlEscape(str = '') {
  return String(str).replace(/[<>&'"]/g, (c) => (
    { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]
  ));
}

function money(n) {
  return `${Number(n || 0).toFixed(2)} ${CURRENCY}`;
}

// Pulls a Brand-like attribute value off a populated product, if one exists.
// Your Attribute model isn't shown here, so this matches loosely on name —
// adjust the .toLowerCase() check if your actual Brand attribute is named
// differently (e.g. "Manufacturer").
function findBrand(product) {
  const attrs = Array.isArray(product.attributes) ? product.attributes : [];
  const match = attrs.find((a) => {
    const name = a.attribute && a.attribute.name ? String(a.attribute.name).toLowerCase() : '';
    return name === 'brand' || name === 'manufacturer';
  });
  return match ? String(match.value) : null;
}

function itemXml(product) {
  const id = String(product._id);
  const link = `${SITE_URL}/product-detail.html?id=${id}`;
  const title = xmlEscape((product.name || '').slice(0, 150)); // Google's title length cap
  const description = xmlEscape((product.description || `Shop ${product.name} at Six Star Suppliers.`).slice(0, 5000));

  const images = Array.isArray(product.images) ? product.images : [];
  const mainImage = images[0];
  if (!mainImage) return ''; // Merchant Center requires an image — skip items that somehow have none

  const additionalImages = images.slice(1, 1 + MAX_ADDITIONAL_IMAGES);

  const stock = Number(product.stock) || 0;
  const availability = stock > 0 ? 'in stock' : 'out of stock';

  const finalPrice = Number(product.finalPrice) || 0;
  const discountPercent = Number(product.discountPercent) || 0;
  const displayPrice = discountPercent > 0
    ? Math.round(finalPrice * (1 - discountPercent / 100))
    : finalPrice;

  // Google convention: g:price is the regular/original price; g:sale_price
  // is only included when the item is actually discounted right now.
  const priceBlock = discountPercent > 0
    ? `<g:price>${money(finalPrice)}</g:price>\n    <g:sale_price>${money(displayPrice)}</g:sale_price>`
    : `<g:price>${money(finalPrice)}</g:price>`;

  const brand = findBrand(product);

  return `
  <item>
    <g:id>${xmlEscape(id)}</g:id>
    <title>${title}</title>
    <description>${description}</description>
    <link>${xmlEscape(link)}</link>
    <g:image_link>${xmlEscape(mainImage)}</g:image_link>
    ${additionalImages.map((img) => `<g:additional_image_link>${xmlEscape(img)}</g:additional_image_link>`).join('\n    ')}
    <g:availability>${availability}</g:availability>
    ${priceBlock}
    <g:condition>new</g:condition>
    ${brand ? `<g:brand>${xmlEscape(brand)}</g:brand>` : ''}
    <g:identifier_exists>no</g:identifier_exists>
    <g:mobile_link>${xmlEscape(link)}</g:mobile_link>
  </item>`;
}

router.get('/merchant-feed.xml', async (req, res) => {
  try {
    const products = await Product.find({ status: 'active', isActive: true, finalPrice: { $ne: null } })
      .select('name description images stock finalPrice discountPercent attributes')
      .populate('attributes.attribute', 'name')
      .limit(50000)
      .lean();

    const items = products.map(itemXml).filter(Boolean).join('\n');

 const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">
<channel>
  <title>Six Star Suppliers Product Feed</title>
  <link>${xmlEscape(SITE_URL)}</link>
  <description>Live product feed for Six Star Suppliers, generated from the current catalog.</description>
  ${items}
</channel>
</rss>`;

    res.set('Content-Type', 'application/xml');
    res.send(body);
  } catch (err) {
    res.status(500).type('text/plain').send('Error generating Merchant Center feed');
  }
});

module.exports = router;