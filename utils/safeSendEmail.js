// utils/safeSendEmail.js
//
// Fire-and-forget wrapper so a Brevo hiccup never fails the HTTP response
// that triggered it. Always call this AFTER res.json/res.status has already
// gone out to the client — never `await` it in the request/response path.
//
// `opts` is passed straight through to sendEmail(), so it MUST include
// `sender: 'noreply' | 'info'` — see utils/sendEmail.js for which one to use
// for which email.

const sendEmail = require('./sendEmail');

function safeSendEmail(opts, label) {
  sendEmail(opts).catch((err) =>
    console.error(`${label} email failed:`, err.body || err.message)
  );
}

module.exports = safeSendEmail;