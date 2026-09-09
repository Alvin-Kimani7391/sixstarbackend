const AgentNotification = require('../models/AgentNotification');

async function notifyAgent(agentId, { type = 'general', title, message, link = '' }) {
  if (!agentId || !title || !message) return null;
  try {
    return await AgentNotification.create({ agent: agentId, type, title, message, link });
  } catch (err) {
    console.error('notifyAgent failed:', err.message);
    return null;
  }
}

module.exports = { notifyAgent };