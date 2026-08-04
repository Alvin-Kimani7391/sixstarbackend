const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { getRequiredDocumentsForSeller, acceptDocument } = require('../controllers/legalDocumentController');

router.get('/required', protect, getRequiredDocumentsForSeller);
router.post('/:id/accept', protect, acceptDocument);

module.exports = router;