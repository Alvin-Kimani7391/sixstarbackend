/**
 * routes/seoRoutes.js
 * -----------------------------------------------------------------------
 * Mount this on your Render backend (server.js), at the ROOT of the app
 * (not under /api), alongside your other route mounts:
 *
 *   app.use('/', require('./routes/seoRoutes'));
 *
 * It generates the sitemap live from MongoDB. Since your real domain is
 * served by Vercel (the frontend) and this lives on Render (the API),
 * you'll proxy https://yourdomain.com/sitemap.xml -> this Render URL
 * using a rewrite in the frontend's vercel.json (see that file) — Google
 * needs to see the sitemap on your actual domain, not on
 * *.onrender.com.
 *
 * Model requires match your real file names/casing exactly:
 *   models/Product.js, models/Category.js, models/Shop.js
 *
 * STATIC_PAGES deliberately does NOT include login.html, register.html,
 * cart.html, or any other page carrying a `noindex` meta tag / blocked in
 * robots.txt. Listing a noindex'd or disallowed URL in the sitemap tells
 * Google two contradictory things at once ("crawl this" via the sitemap,
 * "don't index this" via the tag/robots.txt) — Search Console will flag
 * it as a coverage error. Only add a page here once it's meant to be
 * publicly indexed.
 * -----------------------------------------------------------------------
 */

const express = require('express');
const router = express.Router();

const Product = require('../models/Product');
const Category = require('../models/Category');
const Shop = require('../models/Shop');

// This should be your FRONTEND (Vercel) domain — the one people actually
// visit and the one you verify in Google Search Console.
const SITE_URL = (process.env.SITE_URL || 'https://www.sixstarsuppliers.com').replace(/\/$/, '');

const STATIC_PAGES = [
  { url: '/', changefreq: 'daily', priority: 1.0 },
  { url: '/product.html', changefreq: 'daily', priority: 0.9 },
  { url: '/wholesale.html', changefreq: 'daily', priority: 0.8 },
  { url: '/shop.html', changefreq: 'weekly', priority: 0.7 },
  { url: '/about.html', changefreq: 'monthly', priority: 0.5 },
  { url: '/contact.html', changefreq: 'monthly', priority: 0.4 },
];

function xmlEscape(str = '') {
  return String(str).replace(/[<>&'"]/g, (c) => (
    { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]
  ));
}

function urlEntry(loc, lastmod, changefreq, priority) {
  return `<url><loc>${xmlEscape(loc)}</loc>` +
    (lastmod ? `<lastmod>${lastmod}</lastmod>` : '') +
    (changefreq ? `<changefreq>${changefreq}</changefreq>` : '') +
    (priority != null ? `<priority>${priority}</priority>` : '') +
    `</url>`;
}

function urlset(entries) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    entries.join('\n') +
    `\n</urlset>`;
}

router.get('/sitemap.xml', (req, res) => {
  const now = new Date().toISOString();
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `<sitemap><loc>${SITE_URL}/sitemap-static.xml</loc><lastmod>${now}</lastmod></sitemap>\n` +
    `<sitemap><loc>${SITE_URL}/sitemap-products.xml</loc><lastmod>${now}</lastmod></sitemap>\n` +
    `<sitemap><loc>${SITE_URL}/sitemap-shops.xml</loc><lastmod>${now}</lastmod></sitemap>\n` +
    `<sitemap><loc>${SITE_URL}/sitemap-categories.xml</loc><lastmod>${now}</lastmod></sitemap>\n` +
    `</sitemapindex>`;
  res.set('Content-Type', 'application/xml');
  res.send(body);
});

router.get('/sitemap-static.xml', (req, res) => {
  const now = new Date().toISOString();
  const entries = STATIC_PAGES.map((p) => urlEntry(SITE_URL + p.url, now, p.changefreq, p.priority));
  res.set('Content-Type', 'application/xml');
  res.send(urlset(entries));
});

router.get('/sitemap-products.xml', async (req, res) => {
  try {
    const products = await Product.find({ status: 'active', isActive: true })
      .select('_id updatedAt')
      .limit(50000)
      .lean();

    const entries = products.map((p) => urlEntry(
      `${SITE_URL}/product-detail.html?id=${p._id}`,
      new Date(p.updatedAt || Date.now()).toISOString(),
      'weekly',
      0.8
    ));
    res.set('Content-Type', 'application/xml');
    res.send(urlset(entries));
  } catch (err) {
    res.status(500).type('text/plain').send('Error generating product sitemap');
  }
});

router.get('/sitemap-shops.xml', async (req, res) => {
  try {
    const shops = await Shop.find({ status: 'approved', isActive: true })
      .select('slug updatedAt')
      .limit(50000)
      .lean();

    const entries = shops.map((s) => urlEntry(
      // Pretty URL (matches the /shop/:slug rewrite + api/shop-detail.js
      // SSR function), not the legacy ?slug= query-string form — sitemap
      // entries should always be the canonical URL you want indexed.
      `${SITE_URL}/shop/${s.slug}`,
      new Date(s.updatedAt || Date.now()).toISOString(),
      'weekly',
      0.6
    ));
    res.set('Content-Type', 'application/xml');
    res.send(urlset(entries));
  } catch (err) {
    res.status(500).type('text/plain').send('Error generating shop sitemap');
  }
});

router.get('/sitemap-categories.xml', async (req, res) => {
  try {
    // Only leaf categories carry products (see isLeafCategory in your
    // categoryAttributeController) — but a parent category id still
    // resolves to real products via getCategoryAndDescendantIds in
    // getProducts(), so it's a valid, indexable filter URL either way.
    const categories = await Category.find({ isActive: true }).select('_id updatedAt').lean();
    const entries = categories.map((c) => urlEntry(
      `${SITE_URL}/product.html?category=${c._id}`,
      new Date(c.updatedAt || Date.now()).toISOString(),
      'weekly',
      0.6
    ));
    res.set('Content-Type', 'application/xml');
    res.send(urlset(entries));
  } catch (err) {
    res.status(500).type('text/plain').send('Error generating category sitemap');
  }
});

module.exports = router;