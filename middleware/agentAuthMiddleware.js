const jwt = require('jsonwebtoken');
const asyncHandler = require('express-async-handler');
const Agent = require('../models/Agent');

// Agents use a SEPARATE cookie ('agentToken') and JWT payload shape
// ({ id, scope: 'agent' }) from buyer/seller/admin Users (which use 'token').
// This lets an agent session and a marketplace User session coexist in the
// same browser without clobbering each other, and this middleware never
// touches the User collection at all.
const protectAgent = asyncHandler(async (req, res, next) => {
  let token;

  if (req.cookies && req.cookies.agentToken) {
    token = req.cookies.agentToken;
  } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    res.status(401);
    throw new Error('Not authorized, no agent token provided');
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.scope !== 'agent') {
      res.status(401);
      throw new Error('Not authorized as an agent');
    }

    const agent = await Agent.findById(decoded.id);
    if (!agent || ['rejected', 'deactivated'].includes(agent.status)) {
      res.status(401);
      throw new Error('Not authorized, agent account not found or deactivated');
    }

    req.agent = agent;
    next();
  } catch (error) {
    res.status(401);
    throw new Error('Not authorized, agent token invalid or expired');
  }
});

// Gates dashboard features (marketing, referral tools, commission views) that
// only make sense once an application is actually approved. Login itself is
// allowed at any non-rejected/deactivated status so the agent can at least
// see "your application is under review".
const requireActiveAgent = (req, res, next) => {
  if (!req.agent || !['approved', 'active'].includes(req.agent.status)) {
    res.status(403);
    throw new Error('Your agent application is not yet approved for this action');
  }
  next();
};

module.exports = { protectAgent, requireActiveAgent };