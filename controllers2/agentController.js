const asyncHandler = require('express-async-handler');
const Agent = require('../models/Agent');
const Order = require('../models/Order'); // NEW - needed for getAgentOrders below
const sendEmail = require('../utils/sendEmail');
const { agentWelcomeTemplate } = require('../utils/emailTemplates');

function safeSendEmail(opts, label) {
  sendEmail(opts).catch((err) => console.error(`${label} email failed:`, err.response?.body || err.message));
}

// @desc    Get all ACTIVE agents - for the checkout page's agent picker
// @route   GET /api/agents
// @access  Public
const getActiveAgents = asyncHandler(async (req, res) => {
  const agents = await Agent.find({ isActive: true }).select('name code').sort('name');
  res.json({ success: true, count: agents.length, agents });
});

// @desc    Get ALL agents including inactive ones, with commission stats
// @route   GET /api/admin/agents
// @access  Private (admin)
const getAllAgentsAdmin = asyncHandler(async (req, res) => {
  const agents = await Agent.find().sort('-createdAt');
  res.json({ success: true, count: agents.length, agents });
});

// @desc    Admin creates a new agent - code is auto-generated (PF100, PF101, ...)
// @route   POST /api/agents
// @access  Private (admin)
const createAgent = asyncHandler(async (req, res) => {
  const { name, phone, email, commissionRate } = req.body;

  if (!name || !phone) {
    res.status(400);
    throw new Error('Agent name and phone are required');
  }

  const agent = await Agent.create({ name, phone, email, commissionRate });
  res.status(201).json({ success: true, agent });

  // Agents without an email on file simply don't get a welcome email — nothing to send to.
  if (agent.email) {
    safeSendEmail(
      {
        to: agent.email,
        subject: `Your Agent Code - ${agent.code}`,
        html: agentWelcomeTemplate({ name: agent.name, code: agent.code }),
      },
      'Agent welcome'
    );
  }
});

// @desc    Admin updates an agent's details (code itself cannot be changed)
// @route   PUT /api/agents/:id
// @access  Private (admin)
const updateAgent = asyncHandler(async (req, res) => {
  const agent = await Agent.findById(req.params.id);
  if (!agent) {
    res.status(404);
    throw new Error('Agent not found');
  }

  const editableFields = ['name', 'phone', 'email', 'commissionRate', 'isActive'];
  editableFields.forEach((field) => {
    if (req.body[field] !== undefined) agent[field] = req.body[field];
  });

  await agent.save();
  res.json({ success: true, agent });
});

// @desc    Admin deletes an agent (past orders keep their agentCode snapshot regardless)
// @route   DELETE /api/agents/:id
// @access  Private (admin)
const deleteAgent = asyncHandler(async (req, res) => {
  const agent = await Agent.findByIdAndDelete(req.params.id);
  if (!agent) {
    res.status(404);
    throw new Error('Agent not found');
  }
  res.json({ success: true, message: 'Agent deleted' });
});

// @desc    Get every order placed with a specific agent's code - buyer, date,
//          amount, and commission earned, for the admin panel's expandable
//          agent row.
// @route   GET /api/agents/admin/:id/orders
// @access  Private (admin)
const getAgentOrders = asyncHandler(async (req, res) => {
  const agent = await Agent.findById(req.params.id);
  if (!agent) {
    res.status(404);
    throw new Error('Agent not found');
  }

  const orders = await Order.find({ agent: agent._id })
    .populate('buyer', 'name phone email')
    .sort('-createdAt');

  res.json({ success: true, agent, count: orders.length, orders });
});

module.exports = { getActiveAgents, getAllAgentsAdmin, createAgent, updateAgent, deleteAgent, getAgentOrders };