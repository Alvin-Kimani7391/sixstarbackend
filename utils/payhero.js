// utils/payhero.js
//
// Thin wrapper around PayHero's STK Push API (https://backend.payhero.co.ke/api/v2).
//
// Two env vars drive everything here:
//   PAYHERO_BASIC_AUTH_TOKEN — the FULL "Basic xxxxx..." string from your
//                              PayHero API credentials page (Custom
//                              Integrations > API Keys). Render env var ONLY
//                              — never commit this to the repo.
//   PAYHERO_CHANNEL_ID       — your registered payment channel ID (Payment
//                              Channels > My Payment Channels).
//
// SECURITY: if this token has ever left your Render dashboard (chat,
// screenshot, ticket, Slack, wherever) regenerate it before going live —
// treat any token that left the dashboard as compromised, even if you trust
// where it was shared.

const PAYHERO_BASE = 'https://backend.payhero.co.ke/api/v2';

function authHeader() {
  const token = process.env.PAYHERO_BASIC_AUTH_TOKEN;
  if (!token) throw new Error('PAYHERO_BASIC_AUTH_TOKEN is not set');
  // Accept the env var whether or not it already includes the "Basic " prefix.
  return token.startsWith('Basic ') ? token : `Basic ${token}`;
}

// Initiates an STK Push — pushes the M-Pesa PIN prompt straight to the
// customer's phone. Resolves with PayHero's QUEUED response
// { success, status, reference, CheckoutRequestID } — the actual payment
// result arrives later via the webhook (see paymentController.handleCallback).
async function initiateStkPush(payload) {
  const res = await fetch(`${PAYHERO_BASE}/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader(),
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error_message || data?.message || `PayHero request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// Best-effort fallback only — the webhook is the source of truth for actually
// confirming orders. This exists for an admin "re-check" button in case a
// callback is ever lost/delayed.
async function getTransactionStatus(reference) {
  const res = await fetch(`${PAYHERO_BASE}/transaction-status?reference=${encodeURIComponent(reference)}`, {
    method: 'GET',
    headers: { Authorization: authHeader() },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error_message || data?.message || `PayHero status check failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

module.exports = { initiateStkPush, getTransactionStatus };