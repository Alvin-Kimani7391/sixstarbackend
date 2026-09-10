const asyncHandler = require('express-async-handler');
const { getOrCreateSubscriber, recordSearch, recordView } = require('../services/subscriberService');

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

module.exports = { captureEmail, trackSearch, trackView };