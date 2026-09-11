const express = require('express');
const router = express.Router();
const {
  getPublicTownLocations,
  getAdminTownLocations,
  createTownLocation,
  updateTownLocation,
  deleteTownLocation,
} = require('../controllers/townLocationController');
const { protect, authorize } = require('../middleware/authMiddleware');

// Public — powers the checkout Region/Town dropdown. Must stay ABOVE any
// '/:id'-style route if you ever add one directly on this router.
router.get('/', getPublicTownLocations);

// Admin management
router.get('/admin/all', protect, authorize('admin'), getAdminTownLocations);
router.post('/admin', protect, authorize('admin'), createTownLocation);
router.patch('/admin/:id', protect, authorize('admin'), updateTownLocation);
router.delete('/admin/:id', protect, authorize('admin'), deleteTownLocation);

module.exports = router;

