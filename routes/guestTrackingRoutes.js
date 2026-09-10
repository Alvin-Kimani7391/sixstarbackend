const express = require('express');
const router = express.Router();

const { captureEmail, trackSearch, trackView } = require('../controllers2/guestTrackingController');

// Fully public — called from every storefront page, logged in or not.
router.post('/capture-email', captureEmail);
router.post('/track-search', trackSearch);
router.post('/track-view', trackView);

module.exports = router;