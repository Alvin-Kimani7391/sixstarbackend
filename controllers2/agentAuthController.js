const jwt = require('jsonwebtoken');
const asyncHandler = require('express-async-handler');
const crypto = require('crypto');
const Agent = require('../models/Agent');
const AgentBadge = require('../models/AgentBadge');
const sendEmail = require('../utils/sendEmail');
const getAdminEmails = require('../utils/getAdminEmails');
const {
  agentApplicationReceivedTemplate,
  agentApplicationAdminTemplate,
  agentPasswordResetTemplate,
} = require('../utils/emailTemplates');

function safeSendEmail(opts, label) {
  sendEmail(opts).catch((err) => console.error(`${label} email failed:`, err.body || err.message));
}

function signAgentToken(agentId) {
  return jwt.sign({ id: agentId, scope: 'agent' }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

function setAgentCookie(res, token) {
  res.cookie('agentToken', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

function safeAgent(agent) {
  const obj = agent.toObject ? agent.toObject() : agent;
  delete obj.password;
  delete obj.resetPasswordToken;
  delete obj.resetPasswordExpire;
  return obj;
}

// @desc    Public agent application (self-registration)
// @route   POST /api/agents/apply
// @access  Public
// @desc    Public agent application (self-registration)
// @route   POST /api/agents/apply
// @access  Public
const applyAsAgent = asyncHandler(async (req, res) => {
  const {
    name,
    email,
    phone,
    password,
    location,
    preferredChannel,
    socialMedia,
    termsAccepted,
    marketingPolicyAccepted,
  } = req.body;

  if (!name || !email || !phone || !password) {
    res.status(400);
    throw new Error('Name, email, phone and password are required');
  }
  if (password.length < 6) {
    res.status(400);
    throw new Error('Password must be at least 6 characters');
  }
  if (!termsAccepted || !marketingPolicyAccepted) {
    res.status(400);
    throw new Error('You must accept the Terms and the Marketing Policy to apply');
  }

  const existing = await Agent.findOne({ email: email.toLowerCase().trim() });
  if (existing) {
    res.status(400);
    throw new Error('An agent application already exists for this email');
  }

  const defaultBadge = await AgentBadge.findOne({ isDefault: true, isActive: true });

  const agent = await Agent.create({
    name,
    email: email.toLowerCase().trim(),
    phone,
    password,
    location: location || '',
    bio: req.body.bio || '',
    preferredChannel: preferredChannel || 'whatsapp',
    socialMedia: socialMedia || {},
    avatar: req.file ? req.file.path : '', // NEW — was silently dropped before
    termsAcceptedAt: new Date(),
    marketingPolicyAcceptedAt: new Date(),
    status: 'pending',
    agentType: 'standard',
    badge: defaultBadge ? defaultBadge._id : null,
    commissionRate: defaultBadge ? defaultBadge.commissionRate : 5,
  });

  const token = signAgentToken(agent._id);
  setAgentCookie(res, token);

  res.status(201).json({ success: true, agent: safeAgent(agent), token });

  safeSendEmail(
    {
      to: agent.email,
      subject: 'Your Agent Application Was Received',
      html: agentApplicationReceivedTemplate({ name: agent.name }),
      sender: 'info',
    },
    'Agent application received'
  );

  getAdminEmails().then((adminEmails) => {
    adminEmails.forEach((to) => {
      safeSendEmail(
        {
          to,
          subject: `New Agent Application - ${agent.name}`,
          html: agentApplicationAdminTemplate({ agent }),
          sender: 'info',
        },
        'Agent application (admin alert)'
      );
    });
  });
});

// @desc    Agent login
// @route   POST /api/agents/login
// @access  Public
const agentLogin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400);
    throw new Error('Email and password are required');
  }

  const agent = await Agent.findOne({ email: email.toLowerCase().trim() }).select('+password');
  if (!agent || !(await agent.matchPassword(password))) {
    res.status(401);
    throw new Error('Invalid email or password');
  }
  if (['rejected', 'deactivated'].includes(agent.status)) {
    res.status(403);
    throw new Error('This agent account is no longer active. Contact support for help.');
  }

  agent.lastLoginAt = new Date();
  await agent.save();

  const token = signAgentToken(agent._id);
  setAgentCookie(res, token);

  res.json({ success: true, agent: safeAgent(agent), token });
});

// @desc    Agent logout
// @route   POST /api/agents/logout
// @access  Private (agent)
const agentLogout = asyncHandler(async (req, res) => {
  res.cookie('agentToken', '', { httpOnly: true, expires: new Date(0) });
  res.json({ success: true, message: 'Logged out' });
});

// @desc    Get my own agent profile (full, private view)
// @route   GET /api/agents/me
// @access  Private (agent)
const getMyAgentProfile = asyncHandler(async (req, res) => {
  const agent = await Agent.findById(req.agent._id).populate('badge');
  res.json({ success: true, agent: safeAgent(agent) });
});

// @desc    Update my own agent profile
// @route   PATCH /api/agents/me
// @access  Private (agent)
const updateMyAgentProfile = asyncHandler(async (req, res) => {
  const agent = await Agent.findById(req.agent._id);
  if (!agent) {
    res.status(404);
    throw new Error('Agent not found');
  }

  const editableFields = ['name', 'phone', 'bio', 'location', 'preferredChannel'];
  editableFields.forEach((field) => {
    if (req.body[field] !== undefined) agent[field] = req.body[field];
  });
  if (req.body.socialMedia !== undefined) {
    agent.socialMedia = { ...(agent.socialMedia?.toObject?.() || {}), ...req.body.socialMedia };
  }
  if (req.file) {
    agent.avatar = req.file.path;
  }

  await agent.save();
  res.json({ success: true, agent: safeAgent(agent) });
});

// @desc    Change my agent password
// @route   PUT /api/agents/change-password
// @access  Private (agent)
const changeAgentPassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const agent = await Agent.findById(req.agent._id).select('+password');
  if (!agent || !(await agent.matchPassword(currentPassword))) {
    res.status(401);
    throw new Error('Current password is incorrect');
  }
  if (!newPassword || newPassword.length < 6) {
    res.status(400);
    throw new Error('New password must be at least 6 characters');
  }
  agent.password = newPassword;
  await agent.save();
  res.json({ success: true, message: 'Password updated' });
});

// @desc    Request a password reset link
// @route   POST /api/agents/forgot-password
// @access  Public
const forgotAgentPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const agent = await Agent.findOne({ email: (email || '').toLowerCase().trim() });

  // Always respond success so this endpoint can't be used to enumerate agent emails
  if (!agent) {
    return res.json({ success: true, message: 'If that email exists, a reset link has been sent' });
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  agent.resetPasswordToken = crypto.createHash('sha256').update(rawToken).digest('hex');
  agent.resetPasswordExpire = Date.now() + 15 * 60 * 1000;
  await agent.save();

  const resetUrl = `${process.env.FRONTEND_URL || 'https://sixstarsuppliers.com'}/agent/reset-password.html?token=${rawToken}`;

  safeSendEmail(
    {
      to: agent.email,
      subject: 'Reset Your Agent Password',
      html: agentPasswordResetTemplate({ name: agent.name, resetUrl }),
      sender: 'noreply',
    },
    'Agent password reset'
  );

  res.json({ success: true, message: 'If that email exists, a reset link has been sent' });
});

// @desc    Reset password using the emailed token
// @route   POST /api/agents/reset-password
// @access  Public
const resetAgentPassword = asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword || newPassword.length < 6) {
    res.status(400);
    throw new Error('A valid token and a password of at least 6 characters are required');
  }

  const hashed = crypto.createHash('sha256').update(token).digest('hex');
  const agent = await Agent.findOne({
    resetPasswordToken: hashed,
    resetPasswordExpire: { $gt: Date.now() },
  });

  if (!agent) {
    res.status(400);
    throw new Error('This reset link is invalid or has expired');
  }

  agent.password = newPassword;
  agent.resetPasswordToken = undefined;
  agent.resetPasswordExpire = undefined;
  await agent.save();

  res.json({ success: true, message: 'Password reset — please log in' });
});

module.exports = {
  applyAsAgent,
  agentLogin,
  agentLogout,
  getMyAgentProfile,
  updateMyAgentProfile,
  changeAgentPassword,
  forgotAgentPassword,
  resetAgentPassword,
};