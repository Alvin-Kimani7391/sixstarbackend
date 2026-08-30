const express = require('express');
const router = express.Router();
const { getActiveTiers } = require('../controllers/transactionFeeController');

// Public/seller-facing — lets the earnings page show the current fee ladder.
router.get('/', getActiveTiers);

module.exports = router;