const express = require('express');
const router = express.Router();

const { getQrCode, getShareMessage, recruitBuyer, recruitSeller, sendInvite, promoteProduct } = require('../controllers2/sharingController');
const { protectAgent, requireActiveAgent } = require('../middleware/agentAuthMiddleware');

router.use(protectAgent, requireActiveAgent);

router.get('/qr', getQrCode);
router.post('/message', getShareMessage);
router.post('/recruit-buyer', recruitBuyer);
router.post('/recruit-seller', recruitSeller);
router.post('/send-invite', sendInvite);
router.post('/products/:productId/promote', promoteProduct);

module.exports = router;