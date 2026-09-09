const asyncHandler = require('express-async-handler');
const { generateQrDataUrl } = require('../services/qrService');
const { buildReferralLink, buildRecruitmentMessage, buildProductCaption } = require('../services/shareMessageService');
const AgentLead = require('../models/AgentLead');
const Product = require('../models/Product');
const sendEmail = require('../utils/sendEmail');
const { agentRecruitmentInviteTemplate } = require('../utils/emailTemplates');

function logEmailFailure(err, label) {
  console.error(`${label} email failed:`, err.body || err.message);
}

const getQrCode = asyncHandler(async (req, res) => {
  const { type = 'general', targetId } = req.query;
  const link = buildReferralLink({ agentCode: req.agent.code, type, targetId });
  const qrDataUrl = await generateQrDataUrl(link);
  res.json({ success: true, link, qrDataUrl });
});

const getShareMessage = asyncHandler(async (req, res) => {
  const { channel = 'whatsapp', type = 'general', targetId, leadName } = req.body;
  const link = buildReferralLink({ agentCode: req.agent.code, type, targetId });
  const message = buildRecruitmentMessage({ agentName: req.agent.name, leadName, type, link });
  res.json({ success: true, link, message, channel });
});

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

// @desc    Actually SEND a branded recruitment invite email to the intended
//          person (buyer or seller) via Brevo, and log the recipient as a
//          lead — now accepts the same optional phone/businessName/location
//          fields as recruitSeller so the frontend no longer needs a second,
//          duplicate createLead() call after this one.
// @route   POST /api/sharing/send-invite
// @access  Private (agent)
const sendInvite = asyncHandler(async (req, res) => {
  const { type, email, name, phone, businessName, location } = req.body;
  const recruitType = type === 'seller' ? 'seller' : 'buyer';

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    res.status(400);
    throw new Error('A valid recipient email address is required');
  }

  const link = buildReferralLink({ agentCode: req.agent.code, type: recruitType });

  try {
    await sendEmail({
      to: email,
      subject:
        recruitType === 'seller'
          ? `You're invited to sell on Six Star Suppliers`
          : `You're invited to shop on Six Star Suppliers`,
      html: agentRecruitmentInviteTemplate({
        agentName: req.agent.name,
        recipientName: name || '',
        type: recruitType,
        link,
      }),
      sender: 'info',
    });
  } catch (err) {
    // Surface the real reason to the agent instead of pretending it worked —
    // if you're seeing "invitation sent" toasts but no email ever arrives,
    // check this log line first (most likely cause: BREVO_API_KEY missing/
    // invalid, or the `sender: 'info'` address isn't a verified sender in
    // your Brevo account — see utils/sendEmail.js).
    logEmailFailure(err, 'Agent recruitment invite');
    res.status(502);
    throw new Error('Could not send the invitation email right now. Please try again shortly.');
  }

  if (name) {
    AgentLead.create({
      agent: req.agent._id,
      name,
      phone: phone || '',
      email,
      businessName: businessName || '',
      location: location || '',
      leadType: recruitType,
      source: 'email',
      status: 'invited',
      lastContactAt: new Date(),
    }).catch(() => {});
  }

  res.json({ success: true, message: 'Invitation email sent', link });
});

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

module.exports = { getQrCode, getShareMessage, recruitBuyer, recruitSeller, sendInvite, promoteProduct };