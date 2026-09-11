const asyncHandler = require('express-async-handler');
const Product = require('../models/Product');
const WhatsappPromo = require('../models/WhatsappPromo');
const { FRONTEND_URL, BRAND_NAME } = require('../services/shareMessageService');

// ============================================================
// PRODUCT SEARCH (agent-scoped — only ever returns active/live
// products, unlike the admin search which can see any status)
// ============================================================
// @route GET /api/sharing/products/search?q=&limit=
const searchProductsForShare = asyncHandler(async (req, res) => {
  const { q = '', limit = 8 } = req.query;
  const filter = { status: 'active' };
  if (q.trim()) filter.name = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

  const products = await Product.find(filter)
    .select('name images finalPrice discountPercent sellerPrice')
    .limit(Math.min(Number(limit) || 8, 20));

  res.json({ success: true, products });
});

// Same caption-variant logic as the admin generator, just parameterized
// by whichever referral link gets passed in.
function buildCaptionVariants(product, link, customMessage) {
  const variants = [];

  if (customMessage) {
    variants.push(`${customMessage}\n\n${link}`);
  }

  if (product) {
    const price = product.finalPrice
      ? (product.discountPercent
          ? Math.round(product.finalPrice * (1 - product.discountPercent / 100))
          : product.finalPrice)
      : null;

    variants.push(
      `🔥 *${product.name}*${price ? ` — now KSh ${price.toLocaleString()}` : ''}\n` +
      `${product.discountPercent ? `🏷️ ${product.discountPercent}% OFF — limited stock!\n` : ''}` +
      `Shop now on ${BRAND_NAME} 👇\n${link}`
    );
    variants.push(
      `✨ Just landed on ${BRAND_NAME}: *${product.name}*\n` +
      `${price ? `Only KSh ${price.toLocaleString()}. ` : ''}Tap to grab yours before it's gone!\n${link}`
    );
    variants.push(
      `📦 Deal of the day!\n*${product.name}*${price ? ` — KSh ${price.toLocaleString()}` : ''}\n` +
      `Order directly here: ${link}`
    );
  } else if (!customMessage) {
    variants.push(`🛍️ Discover great deals on ${BRAND_NAME}! Shop quality products with fast delivery.\n${link}`);
    variants.push(`✨ New arrivals just dropped on ${BRAND_NAME}. Come take a look 👇\n${link}`);
  }

  return variants;
}

// @desc    Generate a ready-to-post promo (multiple captions + image),
//          with the agent's own referral code baked into the link so any
//          resulting sale is credited to them — mirrors the admin flow
//          in emailMarketingController.generateWhatsappPromo exactly,
//          scoped to this agent.
// @route   POST /api/sharing/whatsapp-promo/generate
const generateAgentWhatsappPromo = asyncHandler(async (req, res) => {
  const { productId, customMessage, imageUrl } = req.body;
  const agent = req.agent; // set by the agent auth middleware

  let product = null;
  if (productId) {
    product = await Product.findById(productId).select('name images finalPrice discountPercent');
  }

  const base = FRONTEND_URL.replace(/\/$/, '');
  const link = product
    ? `${base}/product-detail.html?id=${product._id}&ref=${agent.code}`
    : `${base}/index.html?ref=${agent.code}`;

  const image = imageUrl || product?.images?.[0] || '';
  const captions = buildCaptionVariants(product, link, customMessage);

  if (!captions.length) {
    res.status(400);
    throw new Error('Pick a product or write a custom message first');
  }

  const promo = await WhatsappPromo.create({
    title: product ? product.name : (customMessage || 'General promo'),
    imageUrl: image,
    captions,
    product: product ? product._id : null,
    link,
    agent: agent._id,
  });

  res.status(201).json({ success: true, promo });
});

// @route GET /api/sharing/whatsapp-promo
const getAgentWhatsappPromos = asyncHandler(async (req, res) => {
  const promos = await WhatsappPromo.find({ agent: req.agent._id })
    .populate('product', 'name images')
    .sort('-createdAt')
    .limit(50);
  res.json({ success: true, count: promos.length, promos });
});

// @route DELETE /api/sharing/whatsapp-promo/:id
const deleteAgentWhatsappPromo = asyncHandler(async (req, res) => {
  const promo = await WhatsappPromo.findOne({ _id: req.params.id, agent: req.agent._id });
  if (!promo) {
    res.status(404);
    throw new Error('Promo not found');
  }
  await promo.deleteOne();
  res.json({ success: true, message: 'Promo removed' });
});

module.exports = {
  searchProductsForShare,
  generateAgentWhatsappPromo,
  getAgentWhatsappPromos,
  deleteAgentWhatsappPromo,
};