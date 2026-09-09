const AuditLog = require('../models/AuditLog');

async function logAudit({ actor = null, action, targetType = '', targetId = null, description = '', metadata = {} }) {
  try {
    return await AuditLog.create({ actor, action, targetType, targetId, description, metadata });
  } catch (err) {
    console.error('logAudit failed:', err.message);
    return null;
  }
}

module.exports = { logAudit };