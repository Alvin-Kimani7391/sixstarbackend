const QRCode = require('qrcode');

// Returns a base64 data: URL — no storage needed, it's regenerated on the
// fly from the same referral link every time (spec §29-30).
async function generateQrDataUrl(text) {
  return QRCode.toDataURL(text, { margin: 1, width: 500, color: { dark: '#101d31', light: '#ffffff' } });
}

module.exports = { generateQrDataUrl };