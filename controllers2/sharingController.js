const asyncHandler = require('express-async-handler');
const { generateQrDataUrl } = require('../services/qrService');
const { buildReferralLink, buildRecruitmentMessage, buildProductCaption } = require('../services/shareMessageService');
const AgentLead = require('../models/AgentLead');
const Product = require('../models/Product');

// @desc    Generate a QR code for any referral link type (spec §29-30)
// @route   GET /api/sharing/qr?type=general&targetId=&channel=qr
// @access  Private (agent)
const getQrCode = asyncHandler(async (req, res) => {
  const { type = 'general', targetId } = req.query;
  const link = buildReferralLink({ agentCode: req.agent.code, type, targetId });
  const qrDataUrl = await generateQrDataUrl(link);
  res.json({ success: true, link, qrDataUrl });
});

// @desc    Generate a ready-to-send share message for a channel (spec §26-28)
// @route   POST /api/sharing/message
// @access  Private (agent)
const getShareMessage = asyncHandler(async (req, res) => {
  const { channel = 'whatsapp', type = 'general', targetId, leadName } = req.body;
  const link = buildReferralLink({ agentCode: req.agent.code, type, targetId });
  const message = buildRecruitmentMessage({ agentName: req.agent.name, leadName, type, link });
  res.json({ success: true, link, message, channel });
});

// @desc    Recruit Buyer flow (spec §23) — generates content and optionally
//          logs the contact as a lead in the agent's CRM.
// @route   POST /api/sharing/recruit-buyer
// @access  Private (agent)
const recruitBuyer = asyncHandler(async (req, res) => {
  const { name, phone, email, channel = 'whatsapp' } = req.body;
  const link = buildReferralLink({ agentCode: req.agent.code, type: 'buyer' });
  const message = buildRecruitmentMessage({ agentName: req.agent.name, leadName: name, type: 'buyer', link });

  let lead = null;
  if (name) {
    lead = await AgentLead.create({
      agent: req.agent._id,
      name,
      phone: phone || '',
      email: email || '',
      leadType: 'buyer',
      source: channel,
      status: 'invited',
      lastContactAt: new Date(),
    });
  }

  res.status(201).json({ success: true, link, message, lead });
});

// @desc    Recruit Seller flow (spec §24-25)
// @route   POST /api/sharing/recruit-seller
// @access  Private (agent)
const recruitSeller = asyncHandler(async (req, res) => {
  const { name, phone, email, businessName, location, channel = 'whatsapp' } = req.body;
  if (!name) {
    res.status(400);
    throw new Error('Lead name is required');
  }

  const link = buildReferralLink({ agentCode: req.agent.code, type: 'seller' });
  const message = buildRecruitmentMessage({ agentName: req.agent.name, leadName: name, type: 'seller', link });

  const lead = await AgentLead.create({
    agent: req.agent._id,
    name,
    phone: phone || '',
    email: email || '',
    businessName: businessName || '',
    location: location || '',
    leadType: 'seller',
    source: channel,
    status: 'invited',
    lastContactAt: new Date(),
  });

  res.status(201).json({ success: true, link, message, lead });
});

// @desc    Promote a specific product (spec §39)
// @route   POST /api/sharing/products/:productId/promote
// @access  Private (agent)
const promoteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.productId).select('name images status');
  if (!product || product.status !== 'active') {
    res.status(404);
    throw new Error('Product not found or not active');
  }

  const link = buildReferralLink({ agentCode: req.agent.code, type: 'product', targetId: product._id });
  const caption = buildProductCaption({ agentName: req.agent.name, productName: product.name, link });
  const qrDataUrl = await generateQrDataUrl(link);

  res.json({ success: true, link, caption, qrDataUrl, product: { id: product._id, name: product.name, image: product.images?.[0] || null } });
});

module.exports = { getQrCode, getShareMessage, recruitBuyer, recruitSeller, promoteProduct };