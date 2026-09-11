const express = require('express');
const router = express.Router();
const { protectAgent } = require('../middleware/agentAuthMiddleware');
const {
  searchProductsForShare,
  generateAgentWhatsappPromo,
  getAgentWhatsappPromos,
  deleteAgentWhatsappPromo,
} = require('../controllers2/agentWhatsappController');

// Every route here requires a logged-in agent
router.use(protectAgent);

router.get('/products/search', searchProductsForShare);
router.get('/whatsapp-promo', getAgentWhatsappPromos);
router.post('/whatsapp-promo/generate', generateAgentWhatsappPromo);
router.delete('/whatsapp-promo/:id', deleteAgentWhatsappPromo);

module.exports = router;