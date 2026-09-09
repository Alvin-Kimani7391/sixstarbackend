const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const asyncHandler = require('express-async-handler');
const Agent = require('../models/Agent');
const sendEmail = require('../utils/sendEmail');
const {
  agentApplicationReceivedTemplate,
  agentApplicationAdminTemplate,
  agentPasswordResetTemplate,
} = require('../utils/emailTemplates');

// Same fallback pattern as controllers2/agentController.js and
// services/shareMessageService.js — set FRONTEND_URL on Render to
// https://www.sixstarsuppliers.com so all three stay in sync.
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://www.sixstarsuppliers.com';
const RESET_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes — matches the buyer/seller reset flow

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

function generateAgentToken(res, agentId) {
  // Separate JWT payload shape ({ scope: 'agent' }) and separate cookie name
  // ('agentToken') from buyer/seller/admin sessions — see
  // middleware/agentAuthMiddleware.js's protectAgent, which checks both.
  const token = jwt.sign({ id: agentId, scope: 'agent' }, process.env.JWT_SECRET, { expiresIn: '30d' });
  res.cookie('agentToken', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

async function getAdminEmails() {
  if (process.env.ADMIN_EMAILS) {
    return process.env.ADMIN_EMAILS.split(',').map((s) => s.trim()).filter(Boolean);
  }
  const { User } = require('../models/User');
  const admins = await User.find({ role: 'admin' }).select('email');
  return admins.map((a) => a.email).filter(Boolean);
}

// @desc    Public self-registration — application starts as 'pending'.
//          Logs the applicant in immediately (agentAuthMiddleware allows
//          any non-rejected/deactivated status) so the dashboard can show
//          them an "under review" screen right away.
// @route   POST /api/agents/apply
// @access  Public
const applyAsAgent = asyncHandler(async (req, res) => {
  const { name, phone, email, password, location, bio, preferredChannel, termsAccepted, marketingPolicyAccepted } = req.body;

  if (!name || !phone || !email || !password) {
    res.status(400);
    throw new Error('Name, phone, email and password are required');
  }
  if (termsAccepted !== 'true' && termsAccepted !== true) {
    res.status(400);
    throw new Error('You must accept the Terms of Service to apply');
  }
  if (marketingPolicyAccepted !== 'true' && marketingPolicyAccepted !== true) {
    res.status(400);
    throw new Error('You must accept the Agent Marketing Policy to apply');
  }

  const existing = await Agent.findOne({ email: email.toLowerCase().trim() });
  if (existing) {
    res.status(400);
    throw new Error('An agent account with this email already exists');
  }

  let socialMedia = {};
  if (req.body.socialMedia) {
    try {
      socialMedia = typeof req.body.socialMedia === 'string' ? JSON.parse(req.body.socialMedia) : req.body.socialMedia;
    } catch {
      /* ignore malformed */
    }
  }

  const agent = await Agent.create({
    name,
    phone,
    email: email.toLowerCase().trim(),
    password,
    location: location || '',
    bio: bio || '',
    preferredChannel: preferredChannel || 'whatsapp',
    socialMedia,
    avatar: req.file ? req.file.path : '',
    agentType: 'standard',
    status: 'pending',
    termsAcceptedAt: new Date(),
    marketingPolicyAcceptedAt: new Date(),
  });

  generateAgentToken(res, agent._id);

  res.status(201).json({ success: true, agent: safeAgent(agent) });

  safeSendEmail(
    {
      to: agent.email,
      subject: 'Application Received — Six Star Suppliers Agent Program',
      html: agentApplicationReceivedTemplate({ name: agent.name }),
      sender: 'info',
    },
    'Agent application received'
  );

  getAdminEmails()
    .then((emails) => {
      emails.forEach((to) =>
        safeSendEmail(
          {
            to,
            subject: `New Agent Application — ${agent.name}`,
            html: agentApplicationAdminTemplate({ agent }),
            sender: 'info',
          },
          'Agent application (admin alert)'
        )
      );
    })
    .catch(() => {});
});

// @desc    Agent login
// @route   POST /api/agents/login
// @access  Public
const agentLogin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400);
    throw new Error('Please provide email and password');
  }

  const agent = await Agent.findOne({ email: email.toLowerCase().trim() }).select('+password');
  if (!agent) {
    res.status(401);
    throw new Error('Invalid email or password');
  }
  if (['rejected', 'deactivated'].includes(agent.status)) {
    res.status(403);
    throw new Error('This agent account is no longer active. Contact support.');
  }

  const isMatch = await agent.matchPassword(password);
  if (!isMatch) {
    res.status(401);
    throw new Error('Invalid email or password');
  }

  agent.lastLoginAt = new Date();
  await agent.save({ validateBeforeSave: false });

  generateAgentToken(res, agent._id);
  res.json({ success: true, agent: safeAgent(agent) });
});

// @desc    Agent logout
// @route   POST /api/agents/logout
// @access  Private (agent)
const agentLogout = asyncHandler(async (req, res) => {
  res.cookie('agentToken', '', { httpOnly: true, expires: new Date(0) });
  res.json({ success: true, message: 'Logged out successfully' });
});

// @desc    Get own agent profile
// @route   GET /api/agents/me
// @access  Private (agent)
const getMyAgentProfile = asyncHandler(async (req, res) => {
  const agent = await Agent.findById(req.agent._id).populate('badge', 'name color commissionRate');
  res.json({ success: true, agent: safeAgent(agent) });
});

// @desc    Update own profile (name/phone/location/bio/channel/social/avatar)
// @route   PATCH /api/agents/me
// @access  Private (agent)
const updateMyAgentProfile = asyncHandler(async (req, res) => {
  const agent = await Agent.findById(req.agent._id);
  if (!agent) {
    res.status(404);
    throw new Error('Agent not found');
  }

  const editable = ['name', 'phone', 'location', 'bio', 'preferredChannel'];
  editable.forEach((f) => {
    if (req.body[f] !== undefined) agent[f] = req.body[f];
  });

  if (req.body.socialMedia) {
    try {
      const parsed = typeof req.body.socialMedia === 'string' ? JSON.parse(req.body.socialMedia) : req.body.socialMedia;
      agent.socialMedia = { ...agent.socialMedia.toObject(), ...parsed };
    } catch {
      /* ignore malformed */
    }
  }

  if (req.file) agent.avatar = req.file.path;

  await agent.save();
  res.json({ success: true, agent: safeAgent(agent) });
});

// @desc    Change own password while logged in
// @route   PUT /api/agents/change-password
// @access  Private (agent)
const changeAgentPassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    res.status(400);
    throw new Error('Current password and new password are required');
  }
  if (newPassword.length < 6) {
    res.status(400);
    throw new Error('New password must be at least 6 characters');
  }

  const agent = await Agent.findById(req.agent._id).select('+password');
  const isMatch = await agent.matchPassword(currentPassword);
  if (!isMatch) {
    res.status(401);
    throw new Error('Current password is incorrect');
  }

  agent.password = newPassword;
  await agent.save();

  res.json({ success: true, message: 'Password updated' });
});

// @desc    Request a password reset email
// @route   POST /api/agents/forgot-password
// @access  Public
const forgotAgentPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const genericResponse = {
    success: true,
    message: "If an agent account exists for that email, we've sent password reset instructions.",
  };

  if (!email) return res.json(genericResponse);

  const agent = await Agent.findOne({ email: email.toLowerCase().trim() });
  if (!agent) return res.json(genericResponse);

  const rawToken = crypto.randomBytes(32).toString('hex');
  agent.resetPasswordToken = crypto.createHash('sha256').update(rawToken).digest('hex');
  agent.resetPasswordExpire = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  await agent.save({ validateBeforeSave: false });

  const resetUrl = `${FRONTEND_URL}/agent-reset-password.html?token=${rawToken}`;

  try {
    await sendEmail({
      to: agent.email,
      subject: 'Reset your Six Star Suppliers agent password',
      html: agentPasswordResetTemplate({ name: agent.name, resetUrl }),
      sender: 'noreply',
    });
  } catch (err) {
    agent.resetPasswordToken = undefined;
    agent.resetPasswordExpire = undefined;
    await agent.save({ validateBeforeSave: false });
    console.error('Agent reset email failed:', err.body || err.message);
    res.status(500);
    throw new Error('Could not send the reset email right now. Please try again shortly.');
  }

  res.json(genericResponse);
});

// @desc    Reset password using the token emailed to the agent
// @route   POST /api/agents/reset-password
// @access  Public
const resetAgentPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) {
    res.status(400);
    throw new Error('Reset token and new password are required');
  }
  if (password.length < 6) {
    res.status(400);
    throw new Error('Password must be at least 6 characters');
  }

  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  const agent = await Agent.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpire: { $gt: Date.now() },
  }).select('+resetPasswordToken +resetPasswordExpire');

  if (!agent) {
    res.status(400);
    throw new Error('This reset link is invalid or has expired. Please request a new one.');
  }

  agent.password = password;
  agent.resetPasswordToken = undefined;
  agent.resetPasswordExpire = undefined;
  await agent.save();

  generateAgentToken(res, agent._id);
  res.json({ success: true, message: 'Password updated successfully', agent: safeAgent(agent) });
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