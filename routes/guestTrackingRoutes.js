const express = require('express');
const router = express.Router();

const { captureEmail, trackSearch, trackView, getMyActivity } = require('../controllers2/guestTrackingController');

// Fully public — called from every storefront page, logged in or not.
router.post('/capture-email', captureEmail);
router.post('/track-search', trackSearch);
router.post('/track-view', trackView);
router.get('/my-activity', getMyActivity);

module.exports = router;