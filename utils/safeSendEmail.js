const sendEmail = require('./sendEmail');

// Fire-and-forget wrapper so a SendGrid hiccup never fails the HTTP response
// that triggered it. Always call this AFTER res.json/res.status has already
// gone out to the client — never `await` it in the request/response path.
function safeSendEmail(opts, label) {
  sendEmail(opts).catch((err) =>
    console.error(`${label} email failed:`, err.response?.body || err.message)
  );
}

module.exports = safeSendEmail;