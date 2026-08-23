// utils/sendEmail.js
//
// Sends transactional email via Brevo (formerly Sendinblue) using their
// HTTP API directly — https://api.brevo.com/v3/smtp/email
// Docs: https://developers.brevo.com/reference/sendtransacemail
//
// SWITCHED FROM SENDGRID — 2026-08-24
// You now have TWO verified senders in Brevo. `sender` picks which one an
// email goes out from:
//   'noreply' -> noreply@sixstarsuppliers.com  (OTP codes, password resets —
//                anything automated/security-related where no reply is
//                expected)
//   'info'    -> info@sixstarsuppliers.com      (everything else: welcome,
//                orders, products, seller verification decisions, flash
//                sales, shops, agents, RFQ/bidding)
//
// `sender` is REQUIRED — there is no silent default — so a call site can
// never accidentally send an OTP from info@ (or vice versa) just because
// someone forgot the argument. sendEmail() throws immediately if it's
// missing or invalid.
//
// REQUIRED ENV VAR:
//   BREVO_API_KEY               Your Brevo API key (Brevo dashboard ->
//                                SMTP & API -> API Keys -> Generate a new key)
//
// OPTIONAL ENV VARS (sensible defaults below if you skip them — but make
// sure both addresses are verified senders/domains in Brevo first, or every
// send will fail):
//   BREVO_SENDER_NOREPLY_EMAIL  default: noreply@sixstarsuppliers.com
//   BREVO_SENDER_NOREPLY_NAME   default: Six Star Suppliers
//   BREVO_SENDER_INFO_EMAIL     default: info@sixstarsuppliers.com
//   BREVO_SENDER_INFO_NAME      default: Six Star Suppliers
//
// NOTE ON fetch: this uses the global `fetch` built into Node 18+. Check
// with `node -v`. If you're on an older Node version, either upgrade, or
// swap the fetch() call below for axios (`npm install axios`) — the request
// shape (url / method / headers / body) stays identical either way.
//
// You can safely remove the @sendgrid/mail package now:
//   npm uninstall @sendgrid/mail

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

const SENDERS = {
  noreply: {
    email: process.env.BREVO_SENDER_NOREPLY_EMAIL || 'noreply@sixstarsuppliers.com',
    name: process.env.BREVO_SENDER_NOREPLY_NAME || 'sixstar-noreply',
  },
  info: {
    email: process.env.BREVO_SENDER_INFO_EMAIL || 'info@sixstarsuppliers.com',
    name: process.env.BREVO_SENDER_INFO_NAME || 'Six Star Suppliers',
  },
};

/**
 * Sends an email via Brevo.
 * @param {Object} opts
 * @param {string} opts.to      Recipient email address
 * @param {string} opts.subject Email subject line
 * @param {string} opts.html    HTML body
 * @param {string} [opts.text]  Optional plain-text fallback
 * @param {'noreply'|'info'} opts.sender  Which verified Brevo sender to send
 *   from. REQUIRED — no default.
 *   'noreply' = noreply@sixstarsuppliers.com (OTP / email verification / password reset)
 *   'info'    = info@sixstarsuppliers.com    (everything else)
 */
const sendEmail = async ({ to, subject, html, text, sender }) => {
  if (!sender || !SENDERS[sender]) {
    throw new Error(
      `sendEmail: missing/invalid "sender" ("${sender}"). Must be "noreply" or "info" — pass it explicitly at the call site.`
    );
  }

  if (!process.env.BREVO_API_KEY) {
    throw new Error('sendEmail: BREVO_API_KEY is not set in the environment.');
  }

  const payload = {
    sender: SENDERS[sender],
    to: [{ email: to }],
    subject,
    htmlContent: html,
    ...(text ? { textContent: text } : {}),
  };

  const res = await fetch(BREVO_API_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'api-key': process.env.BREVO_API_KEY,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let bodyText = '';
    try {
      bodyText = await res.text();
    } catch (_) {
      /* ignore */
    }
    const err = new Error(`Brevo send failed (${res.status} ${res.statusText}): ${bodyText}`);
    err.status = res.status;
    err.body = bodyText;
    throw err;
  }

  return res.json(); // { messageId: '...' }
};

module.exports = sendEmail;