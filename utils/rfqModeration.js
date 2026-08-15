/**
 * Contact-info / off-platform-communication moderation for RFQ chat and
 * bid messages.
 *
 * Report section 14: detect phone numbers, emails, WhatsApp/Telegram
 * mentions, social handles, and external payment/links; mask them rather
 * than silently dropping the whole message; apply a graduated response
 * instead of an instant ban.
 *
 * IMPORTANT: this is pattern-matching, not perfect — expect some false
 * positives (e.g. a long order number) and some false negatives (e.g.
 * "zero seven one two, three four five..." spelled out). Treat a
 * "blocked" result as "needs a human to look at it", not as proof of
 * intent. Do not tighten this into an auto-ban without admin review.
 */

const PATTERNS = [
  {
  flag: 'phone_number',
  // Kenyan mobile formats: 07xxxxxxxx, 01xxxxxxxx, +2547xxxxxxxx, 2547xxxxxxxx
  // with or without spaces/dashes, plus international fallback
  regex: /(?:\+?254|0)\s?(?:[71]\d{8}|[71]\d{1}[\s-]?\d{3}[\s-]?\d{4})\b|\b\d{3}[\s-]\d{3}[\s-]\d{4}\b|\+\d{7,14}\b/g,
},
  {
    flag: 'email_address',
    regex: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,
  },
  {
    flag: 'whatsapp',
    regex: /whats?app|wa\.me\/\S+|chat\.whatsapp\.com\/\S+/gi,
  },
  {
    flag: 'telegram',
    regex: /telegram|t\.me\/\S+/gi,
  },
  {
    flag: 'social_handle',
    regex: /instagram\.com\/\S+|facebook\.com\/\S+|fb\.me\/\S+|twitter\.com\/\S+|x\.com\/\S+|tiktok\.com\/\S+|@[a-zA-Z0-9_]{3,}/g,
  },
  {
    flag: 'external_payment',
    regex: /paypal\.me\/\S+|\bpaybill\b.{0,15}\d{4,}|\btill\s?number\b.{0,15}\d{4,}|\bsend\s?money\s?to\b/gi,
  },
  {
    flag: 'external_link',
    // Any URL that isn't your own domain — broad on purpose.
    regex: /\bhttps?:\/\/(?!(?:www\.)?sixstarsuppliers\.com)\S+/gi,
  },
];

const MASK_TEXT = '[hidden for your security]';
const WARNING_NOTICE = 'For your security, please keep communication and transactions on Six Star Suppliers.';

/**
 * Scans text for off-platform contact attempts.
 * Returns { flags: string[], maskedText: string }.
 * The ORIGINAL text is intentionally not returned — callers should never
 * persist or forward the raw input once any pattern has matched.
 */
function scanMessage(text = '') {
  let maskedText = String(text);
  const flags = [];

  for (const { flag, regex } of PATTERNS) {
    if (regex.test(maskedText)) flags.push(flag);
    regex.lastIndex = 0; // reset stateful /g regex before reuse
    maskedText = maskedText.replace(regex, MASK_TEXT);
    regex.lastIndex = 0;
  }

  return { flags: [...new Set(flags)], maskedText };
}

/**
 * Graduated response ladder (report section 14):
 *   attempts 1-4   -> warn, message still sent through (masked)
 *   attempts 5-9   -> messaging restricted, message BLOCKED, needs the
 *                     user to contact support / wait for a manual lift
 *   attempts 10+   -> also flagged for admin review as a repeat offender
 *
 * @param {number} priorWarningCount - the user's CURRENT count (i.e.
 *   User.contactShareWarnings) BEFORE this attempt.
 */
function decideAction(priorWarningCount) {
  const attemptNumber = priorWarningCount + 1;
  if (attemptNumber >= 10) return { action: 'blocked', restrictMessaging: true, flagForReview: true };
  if (attemptNumber >= 5) return { action: 'blocked', restrictMessaging: true, flagForReview: false };
  return { action: 'masked', restrictMessaging: false, flagForReview: false };
}

module.exports = { scanMessage, decideAction, MASK_TEXT, WARNING_NOTICE };