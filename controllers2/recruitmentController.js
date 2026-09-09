const asyncHandler = require('express-async-handler');
const AgentLead = require('../models/AgentLead');

// ============================================================
// AGENT — CRM (spec §36-37)
// ============================================================

const createLead = asyncHandler(async (req, res) => {
  const { name, phone, email, businessName, location, leadType, source } = req.body;
  if (!name || !leadType) {
    res.status(400);
    throw new Error('name and leadType are required');
  }

  const lead = await AgentLead.create({
    agent: req.agent._id,
    name,
    phone: phone || '',
    email: email || '',
    businessName: businessName || '',
    location: location || '',
    leadType,
    source: source || 'manual',
    lastContactAt: new Date(),
  });

  res.status(201).json({ success: true, lead });
});

const getMyLeads = asyncHandler(async (req, res) => {
  const { type, status, search } = req.query;
  const filter = { agent: req.agent._id };
  if (type) filter.leadType = type;
  if (status) filter.status = status;
  if (search && search.trim()) filter.$text = { $search: search.trim() };

  const leads = await AgentLead.find(filter).sort('-updatedAt');
  res.json({ success: true, count: leads.length, leads });
});

const getLeadById = asyncHandler(async (req, res) => {
  const lead = await AgentLead.findOne({ _id: req.params.id, agent: req.agent._id });
  if (!lead) {
    res.status(404);
    throw new Error('Lead not found');
  }
  res.json({ success: true, lead });
});

const updateLead = asyncHandler(async (req, res) => {
  const lead = await AgentLead.findOne({ _id: req.params.id, agent: req.agent._id });
  if (!lead) {
    res.status(404);
    throw new Error('Lead not found');
  }

  const editable = ['name', 'phone', 'email', 'businessName', 'location', 'status', 'followUpDate'];
  editable.forEach((f) => {
    if (req.body[f] !== undefined) lead[f] = req.body[f];
  });
  lead.lastContactAt = new Date();

  await lead.save();
  res.json({ success: true, lead });
});

const addLeadNote = asyncHandler(async (req, res) => {
  const { text } = req.body;
  if (!text) {
    res.status(400);
    throw new Error('Note text is required');
  }
  const lead = await AgentLead.findOne({ _id: req.params.id, agent: req.agent._id });
  if (!lead) {
    res.status(404);
    throw new Error('Lead not found');
  }
  lead.notes.push({ text });
  lead.lastContactAt = new Date();
  await lead.save();
  res.json({ success: true, lead });
});

const deleteLead = asyncHandler(async (req, res) => {
  const lead = await AgentLead.findOneAndDelete({ _id: req.params.id, agent: req.agent._id });
  if (!lead) {
    res.status(404);
    throw new Error('Lead not found');
  }
  res.json({ success: true, message: 'Lead deleted' });
});

// @desc    Follow-up reminders (spec §37) — leads due for contact
// @route   GET /api/recruitment/leads/followups
const getFollowupReminders = asyncHandler(async (req, res) => {
  const now = new Date();
  const leads = await AgentLead.find({
    agent: req.agent._id,
    followUpDate: { $lte: now },
    status: { $nin: ['converted', 'lost', 'active', 'first_sale'] },
  }).sort('followUpDate');

  res.json({ success: true, count: leads.length, leads });
});

// ============================================================
// ADMIN — oversight
// ============================================================

const getAllLeadsAdmin = asyncHandler(async (req, res) => {
  const { agentId, type, status } = req.query;
  const filter = {};
  if (agentId) filter.agent = agentId;
  if (type) filter.leadType = type;
  if (status) filter.status = status;

  const leads = await AgentLead.find(filter).populate('agent', 'name code').sort('-createdAt');
  res.json({ success: true, count: leads.length, leads });
});

const getPipelineStatsAdmin = asyncHandler(async (req, res) => {
  const stats = await AgentLead.aggregate([{ $group: { _id: { leadType: '$leadType', status: '$status' }, count: { $sum: 1 } } }]);
  res.json({ success: true, stats });
});

module.exports = {
  createLead,
  getMyLeads,
  getLeadById,
  updateLead,
  addLeadNote,
  deleteLead,
  getFollowupReminders,
  getAllLeadsAdmin,
  getPipelineStatsAdmin,
};