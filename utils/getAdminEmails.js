const { User } = require('../models/User');

// Best-effort admin recipient list: explicit env override first, otherwise
// every user with role "admin". A lookup failure here should never break
// whatever action triggered it — callers wrap the resulting sends in
// safeSendEmail, and this itself is only ever called from inside a
// fire-and-forget flow.
async function getAdminEmails() {
  if (process.env.ADMIN_EMAILS) {
    return process.env.ADMIN_EMAILS.split(',').map((s) => s.trim()).filter(Boolean);
  }
  const admins = await User.find({ role: 'admin' }).select('email');
  return admins.map((a) => a.email).filter(Boolean);
}

module.exports = getAdminEmails;