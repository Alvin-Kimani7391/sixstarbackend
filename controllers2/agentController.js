const asyncHandler = require('express-async-handler');
const crypto = require('crypto');
const Agent = require('../models/Agent');
const AgentBadge = require('../models/AgentBadge');
const ReferralClick = require('../models/ReferralClick');
const Order = require('../models/Order');
const sendEmail = require('../utils/sendEmail');
const {
  agentWelcomeTemplate,
  agentApprovedTemplate,
  agentRejectedTemplate,
  agentStatusChangedTemplate,
  agentBadgeUpgradedTemplate,
} = require('../utils/emailTemplates');

function safeSendEmail(opts, label) {
  sendEmail(opts).catch((err) => console.error(`${label} email failed:`, err.body || err.message));
}

function safeAgent(agent) {
  const obj = agent.toObject ? agent.toObject() : agent;
  delete obj.password;
  delete obj.resetPasswordToken;
  delete obj.resetPasswordExpire;
  return obj;
}

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://sixstarsuppliers.com';

// ============================================================
// PUBLIC
// ============================================================

// @desc    Get all ACTIVE agents - for the checkout page's agent picker
// @route   GET /api/agents
// @access  Public
const getActiveAgents = asyncHandler(async (req, res) => {
  const agents = await Agent.find({ isActive: true }).select('name code').sort('name');
  res.json({ success: true, count: agents.length, agents });
});

// @desc    Public agent profile page — safe subset of fields only
// @route   GET /api/agents/public/:slug
// @access  Public
const getPublicAgentProfile = asyncHandler(async (req, res) => {
  const agent = await Agent.findOne({ publicSlug: req.params.slug, isActive: true }).populate('badge', 'name color');
  if (!agent) {
    res.status(404);
    throw new Error('Agent page not found');
  }

  res.json({
    success: true,
    agent: {
      name: agent.name,
      avatar: agent.avatar,
      bio: agent.bio,
      badge: agent.badge,
      code: agent.code,
      publicSlug: agent.publicSlug,
      joinDate: agent.createdAt,
      referralLinks: {
        general: `${FRONTEND_URL}/?ref=${agent.code}`,
        shop: `${FRONTEND_URL}/?ref=${agent.code}&intent=buyer`,
        sell: `${FRONTEND_URL}/become-a-seller.html?ref=${agent.code}`, // ASSUMED path
        joinAsAgent: `${FRONTEND_URL}/agent/apply.html?ref=${agent.code}`, // ASSUMED path
      },
    },
  });
});

// @desc    Record a click on one of an agent's referral links (public, fired
//          by the frontend the instant a referral URL loads). Foundation for
//          the full attribution chain — registration/order-time conversion
//          gets stitched on in later phases via convertedUser.
// @route   POST /api/agents/track/:code
// @access  Public
const trackReferralClick = asyncHandler(async (req, res) => {
  const agent = await Agent.findOne({ code: req.params.code.toUpperCase(), isActive: true });
  if (!agent) {
    // Don't error the page load over a bad/stale referral code — just no-op.
    return res.status(204).end();
  }

  const { type = 'general', channel = 'direct', targetId = null, targetModel = '' } = req.body || {};

  await ReferralClick.create({
    agent: agent._id,
    agentCode: agent.code,
    type,
    channel,
    targetId: targetId || null,
    targetModel,
    ip: req.ip,
    userAgent: req.headers['user-agent'] || '',
    referer: req.headers['referer'] || '',
  });

  await Agent.findByIdAndUpdate(agent._id, { $inc: { referralClickCount: 1 } });

  require('../services/fraudService').checkClickVelocity(agent._id).catch(() => {}); // NEW

  res.status(204).end();
});

// ============================================================
// ADMIN — Agent Management
// ============================================================

// @desc    Get ALL agents including inactive ones, with commission stats
// @route   GET /api/agents/admin/all?status=pending&badge=<id>&search=
// @access  Private (admin)
const getAllAgentsAdmin = asyncHandler(async (req, res) => {
  const { status, badge, search } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (badge) filter.badge = badge;
  if (search && search.trim()) {
    const q = search.trim();
    filter.$or = [
      { name: { $regex: q, $options: 'i' } },
      { email: { $regex: q, $options: 'i' } },
      { code: { $regex: q, $options: 'i' } },
      { phone: { $regex: q, $options: 'i' } },
    ];
  }

  const agents = await Agent.find(filter).populate('badge', 'name color commissionRate').sort('-createdAt');
  res.json({ success: true, count: agents.length, agents: agents.map(safeAgent) });
});

// @desc    Pending/under-review applications queue
// @route   GET /api/agents/admin/pending
// @access  Private (admin)
const getPendingAgentApplications = asyncHandler(async (req, res) => {
  const agents = await Agent.find({ status: { $in: ['pending', 'under_review'] } }).sort('createdAt');
  res.json({ success: true, count: agents.length, agents: agents.map(safeAgent) });
});

// @desc    Admin creates a new agent directly (skips the application flow) —
//          code is auto-generated (PF100, PF101, ...), account starts active
//          immediately, and a temporary password is emailed to the agent.
// @route   POST /api/agents/admin
// @access  Private (admin)
const createAgent = asyncHandler(async (req, res) => {
  const { name, phone, email, commissionRate, badge } = req.body;

  if (!name || !phone || !email) {
    res.status(400);
    throw new Error('Agent name, phone and email are required');
  }

  const tempPassword = crypto.randomBytes(5).toString('hex'); // 10-char temp password

  let badgeDoc = null;
  if (badge) {
    badgeDoc = await AgentBadge.findById(badge);
  } else {
    badgeDoc = await AgentBadge.findOne({ isDefault: true, isActive: true });
  }

  const agent = await Agent.create({
    name,
    phone,
    email: email.toLowerCase().trim(),
    password: tempPassword,
    commissionRate: commissionRate !== undefined ? commissionRate : badgeDoc?.commissionRate ?? 5,
    badge: badgeDoc ? badgeDoc._id : null,
    badgeAssignedAt: badgeDoc ? new Date() : null,
    agentType: 'admin_created',
    status: 'active',
    reviewedAt: new Date(),
    reviewedBy: req.user._id,
    termsAcceptedAt: new Date(),
    marketingPolicyAcceptedAt: new Date(),
  });

  res.status(201).json({ success: true, agent: safeAgent(agent) });

  safeSendEmail(
    {
      to: agent.email,
      subject: `Your Agent Account - ${agent.code}`,
      html: agentWelcomeTemplate({ name: agent.name, code: agent.code, tempPassword }),
      sender: 'info',
    },
    'Agent welcome (admin-created)'
  );
});

// @desc    Approve a pending/under-review application
// @route   PATCH /api/agents/admin/:id/approve
// @access  Private (admin)
const approveAgentApplication = asyncHandler(async (req, res) => {
  const agent = await Agent.findById(req.params.id);
  if (!agent) {
    res.status(404);
    throw new Error('Agent not found');
  }
  if (!['pending', 'under_review'].includes(agent.status)) {
    res.status(400);
    throw new Error('Only pending or under-review applications can be approved');
  }

  if (!agent.badge) {
    const defaultBadge = await AgentBadge.findOne({ isDefault: true, isActive: true });
    if (defaultBadge) {
      agent.badge = defaultBadge._id;
      agent.commissionRate = defaultBadge.commissionRate;
      agent.badgeAssignedAt = new Date();
    }
  }

  agent.status = 'active';
  agent.reviewedBy = req.user._id;
  agent.reviewedAt = new Date();
  agent.rejectionReason = '';
  await agent.save();

  res.json({ success: true, agent: safeAgent(agent) });

  safeSendEmail(
    {
      to: agent.email,
      subject: `You're Approved - Welcome to the Agent Program`,
      html: agentApprovedTemplate({ name: agent.name, code: agent.code }),
      sender: 'info',
    },
    'Agent approved'
  );
});

// @desc    Move an application to under_review (optional intermediate step)
// @route   PATCH /api/agents/admin/:id/review
// @access  Private (admin)
const markAgentUnderReview = asyncHandler(async (req, res) => {
  const agent = await Agent.findById(req.params.id);
  if (!agent) {
    res.status(404);
    throw new Error('Agent not found');
  }
  if (agent.status !== 'pending') {
    res.status(400);
    throw new Error('Only pending applications can be moved to under review');
  }
  agent.status = 'under_review';
  await agent.save();
  res.json({ success: true, agent: safeAgent(agent) });
});

// @desc    Reject a pending/under-review application
// @route   PATCH /api/agents/admin/:id/reject
// @access  Private (admin)
const rejectAgentApplication = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  if (!reason) {
    res.status(400);
    throw new Error('A rejection reason is required');
  }

  const agent = await Agent.findById(req.params.id);
  if (!agent) {
    res.status(404);
    throw new Error('Agent not found');
  }
  if (!['pending', 'under_review'].includes(agent.status)) {
    res.status(400);
    throw new Error('Only pending or under-review applications can be rejected');
  }

  agent.status = 'rejected';
  agent.rejectionReason = reason;
  agent.reviewedBy = req.user._id;
  agent.reviewedAt = new Date();
  await agent.save();

  res.json({ success: true, agent: safeAgent(agent) });

  safeSendEmail(
    {
      to: agent.email,
      subject: 'Update on Your Agent Application',
      html: agentRejectedTemplate({ name: agent.name, reason }),
      sender: 'info',
    },
    'Agent rejected'
  );
});

// @desc    Suspend an active agent (blocks login-gated features, keeps history)
// @route   PATCH /api/agents/admin/:id/suspend
// @access  Private (admin)
const suspendAgent = asyncHandler(async (req, res) => {
  const agent = await Agent.findById(req.params.id);
  if (!agent) {
    res.status(404);
    throw new Error('Agent not found');
  }
  agent.status = 'suspended';
  await agent.save();
  res.json({ success: true, agent: safeAgent(agent) });

  safeSendEmail(
    {
      to: agent.email,
      subject: 'Your Agent Account Has Been Suspended',
      html: agentStatusChangedTemplate({ name: agent.name, status: 'suspended' }),
      sender: 'info',
    },
    'Agent suspended'
  );
});

// @desc    Reactivate a suspended agent
// @route   PATCH /api/agents/admin/:id/reactivate
// @access  Private (admin)
const reactivateAgent = asyncHandler(async (req, res) => {
  const agent = await Agent.findById(req.params.id);
  if (!agent) {
    res.status(404);
    throw new Error('Agent not found');
  }
  if (agent.status !== 'suspended') {
    res.status(400);
    throw new Error('Only suspended agents can be reactivated');
  }
  agent.status = 'active';
  await agent.save();
  res.json({ success: true, agent: safeAgent(agent) });

  safeSendEmail(
    {
      to: agent.email,
      subject: 'Your Agent Account Is Active Again',
      html: agentStatusChangedTemplate({ name: agent.name, status: 'active' }),
      sender: 'info',
    },
    'Agent reactivated'
  );
});

// @desc    Admin updates an agent's details, including manually assigning a badge
// @route   PUT /api/agents/admin/:id
// @access  Private (admin)
const updateAgent = asyncHandler(async (req, res) => {
  const agent = await Agent.findById(req.params.id);
  if (!agent) {
    res.status(404);
    throw new Error('Agent not found');
  }

  const editableFields = ['name', 'phone', 'email', 'commissionRate', 'location', 'bio', 'agentType'];
  editableFields.forEach((field) => {
    if (req.body[field] !== undefined) agent[field] = req.body[field];
  });

  if (req.body.badge !== undefined) {
    const oldBadgeId = agent.badge ? agent.badge.toString() : null;
    if (req.body.badge === null || req.body.badge === '') {
      agent.badge = null;
    } else {
      const badgeDoc = await AgentBadge.findById(req.body.badge);
      if (!badgeDoc) {
        res.status(400);
        throw new Error('Badge not found');
      }
      agent.badge = badgeDoc._id;
      agent.commissionRate = badgeDoc.commissionRate;
      agent.badgeAssignedAt = new Date();

      if (oldBadgeId !== badgeDoc._id.toString() && agent.email) {
        safeSendEmail(
          {
            to: agent.email,
            subject: `You've Been Upgraded to ${badgeDoc.name} Agent 🎉`,
            html: agentBadgeUpgradedTemplate({
              name: agent.name,
              badgeName: badgeDoc.name,
              commissionRate: badgeDoc.commissionRate,
            }),
            sender: 'info',
          },
          'Agent badge changed'
        );
      }
    }
  }

  await agent.save();
  res.json({ success: true, agent: safeAgent(agent) });
});

// @desc    Admin deletes an agent (past orders keep their agentCode snapshot regardless)
// @route   DELETE /api/agents/admin/:id
// @access  Private (admin)
const deleteAgent = asyncHandler(async (req, res) => {
  const agent = await Agent.findByIdAndDelete(req.params.id);
  if (!agent) {
    res.status(404);
    throw new Error('Agent not found');
  }
  res.json({ success: true, message: 'Agent deleted' });
});

// @desc    Get every order placed with a specific agent's code
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

  res.json({ success: true, agent: safeAgent(agent), count: orders.length, orders });
});

// @desc    Referral click log for a specific agent (admin oversight)
// @route   GET /api/agents/admin/:id/clicks?page=&limit=
// @access  Private (admin)
const getAgentReferralClicks = asyncHandler(async (req, res) => {
  const { page = 1, limit = 50 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const [clicks, total] = await Promise.all([
    ReferralClick.find({ agent: req.params.id }).sort('-createdAt').skip(skip).limit(Number(limit)),
    ReferralClick.countDocuments({ agent: req.params.id }),
  ]);

  res.json({ success: true, count: clicks.length, total, page: Number(page), clicks });
});

// ============================================================
// ADMIN — Badge Management
// ============================================================

// @desc    All badges (active + inactive) for the admin screen
// @route   GET /api/agents/admin/badges
// @access  Private (admin)
const getAllBadgesAdmin = asyncHandler(async (req, res) => {
  const badges = await AgentBadge.find().sort('sortOrder');
  res.json({ success: true, count: badges.length, badges });
});

// @desc    Create a badge tier
// @route   POST /api/agents/admin/badges
// @access  Private (admin)
const createBadge = asyncHandler(async (req, res) => {
  const { name, slug, color, commissionRate, requirements, sortOrder, isDefault, isActive } = req.body;

  if (!name || !slug || commissionRate === undefined) {
    res.status(400);
    throw new Error('name, slug and commissionRate are required');
  }

  const badge = await AgentBadge.create({
    name,
    slug: slug.toLowerCase().trim(),
    color,
    commissionRate,
    requirements,
    sortOrder,
    isDefault: !!isDefault,
    isActive: isActive !== undefined ? isActive : true,
  });

  res.status(201).json({ success: true, badge });
});

// @desc    Update a badge tier
// @route   PATCH /api/agents/admin/badges/:id
// @access  Private (admin)
const updateBadge = asyncHandler(async (req, res) => {
  const badge = await AgentBadge.findById(req.params.id);
  if (!badge) {
    res.status(404);
    throw new Error('Badge not found');
  }

  const editableFields = ['name', 'slug', 'color', 'commissionRate', 'requirements', 'sortOrder', 'isDefault', 'isActive'];
  editableFields.forEach((field) => {
    if (req.body[field] !== undefined) badge[field] = req.body[field];
  });

  await badge.save();
  res.json({ success: true, badge });
});

// @desc    Delete a badge tier — agents on this badge fall back to their
//          flat commissionRate until reassigned; nothing else cascades.
// @route   DELETE /api/agents/admin/badges/:id
// @access  Private (admin)
const deleteBadge = asyncHandler(async (req, res) => {
  const badge = await AgentBadge.findByIdAndDelete(req.params.id);
  if (!badge) {
    res.status(404);
    throw new Error('Badge not found');
  }
  await Agent.updateMany({ badge: badge._id }, { $set: { badge: null } });
  res.json({ success: true, message: 'Badge deleted' });
});

module.exports = {
  getActiveAgents,
  getPublicAgentProfile,
  trackReferralClick,
  getAllAgentsAdmin,
  getPendingAgentApplications,
  createAgent,
  approveAgentApplication,
  markAgentUnderReview,
  rejectAgentApplication,
  suspendAgent,
  reactivateAgent,
  updateAgent,
  deleteAgent,
  getAgentOrders,
  getAgentReferralClicks,
  getAllBadgesAdmin,
  createBadge,
  updateBadge,
  deleteBadge,
};