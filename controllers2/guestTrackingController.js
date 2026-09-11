const asyncHandler = require('express-async-handler');
const { getOrCreateSubscriber, recordSearch, recordView, findSubscriber } = require('../services/subscriberService');
const { getMergedViewedProducts } = require('../services/recommendationService');

// All of these are PUBLIC — called from the storefront for both guests and
// logged-in buyers (the frontend passes `email` when it already knows who's
// logged in via SS_AUTH; otherwise it passes only the anonymous `guestId`
// cookie). None of this requires an account or blocks the page in any way.

// @desc    Capture an email address from a guest (e.g. a "get notified of
//          deals" prompt after a search or product view)
// @route   POST /api/guest/capture-email
const captureEmail = asyncHandler(async (req, res) => {
  const { email, guestId, name } = req.body;
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    res.status(400);
    throw new Error('A valid email address is required');
  }

  const subscriber = await getOrCreateSubscriber({ email, guestId, name, source: 'guest_capture' });
  res.status(201).json({ success: true, message: 'Thanks — you will hear about deals matching what you like.', subscribed: subscriber.status === 'subscribed' });
});

// @desc    Record a search term against a guest/known subscriber
// @route   POST /api/guest/track-search
const trackSearch = asyncHandler(async (req, res) => {
  const { term, guestId, email } = req.body;
  if (!term || !String(term).trim()) return res.status(204).end();
  if (!guestId && !email) return res.status(204).end();

  await recordSearch({ email, guestId, term });
  res.status(204).end();
});

// @desc    Record a product view against a guest/known subscriber
// @route   POST /api/guest/track-view
const trackView = asyncHandler(async (req, res) => {
  const { productId, guestId, email } = req.body;
  if (!productId) return res.status(204).end();
  if (!guestId && !email) return res.status(204).end();

  await recordView({ email, guestId, productId });
  res.status(204).end();
});

// @desc    Read-only — a person's own recent searches + recently viewed
//          products, keyed by their guestId and/or (if logged in) email.
//          Powers the header search bar's "recent searches" dropdown.
//          Never creates a subscriber record — a fresh visitor just gets
//          empty arrays back.
// @route   GET /api/guest/my-activity?guestId=&email=
const getMyActivity = asyncHandler(async (req, res) => {
  const { guestId, email } = req.query;
  if (!guestId && !email) {
    return res.json({ success: true, searches: [], viewedProducts: [] });
  }

  const subscriber = await findSubscriber({ email, guestId });
  if (!subscriber) {
    return res.json({ success: true, searches: [], viewedProducts: [] });
  }

  const searches = (subscriber.searchHistory || [])
    .slice()
    .sort((a, b) => new Date(b.lastSearchedAt) - new Date(a.lastSearchedAt))
    .slice(0, 8)
    .map((s) => s.term);

  const merged = await getMergedViewedProducts(subscriber);
  const Product = require('../models/Product');
  const productIds = merged.slice(0, 8).map((v) => v.product);
  const products = await Product.find({ _id: { $in: productIds }, isActive: true })
    .select('name images finalPrice discountPercent status');

  const productById = new Map(products.map((p) => [String(p._id), p]));
  const viewedProducts = merged
    .filter((v) => productById.has(String(v.product)) && productById.get(String(v.product)).status === 'active')
    .slice(0, 8)
    .map((v) => {
      const p = productById.get(String(v.product));
      const price = p.discountPercent ? Math.round(p.finalPrice * (1 - p.discountPercent / 100)) : p.finalPrice;
      return { id: p._id, name: p.name, image: (p.images && p.images[0]) || '', price };
    });

  res.json({ success: true, searches, viewedProducts });
});

module.exports = { captureEmail, trackSearch, trackView, getMyActivity };