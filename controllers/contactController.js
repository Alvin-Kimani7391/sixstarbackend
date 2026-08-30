const asyncHandler = require('express-async-handler');
const sendEmail = require('../utils/sendEmail');
const { contactFormEmailTemplate, SUPPORT_EMAIL } = require('../utils/emailTemplates');

// Very small helper — good enough to reject obviously malformed input
// without pulling in a validation library for one field.
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

// @desc    Send the public "Contact Us" form as an email to support
// @route   POST /api/contact
// @access  Public
const sendContactMessage = asyncHandler(async (req, res) => {
  const name = (req.body.name || '').trim();
  const email = (req.body.email || '').trim();
  const phone = (req.body.phone || '').trim();
  const inquiryType = (req.body.inquiryType || '').trim();
  const orderNumber = (req.body.orderNumber || '').trim();
  const subject = (req.body.subject || '').trim();
  const message = (req.body.message || '').trim();

  const VALID_TYPES = ['General Information', 'Order Inquiry', 'Sales and Advertisement', 'Feedback'];

  if (!name || !email || !message) {
    res.status(400);
    throw new Error('Name, email and message are required');
  }

  if (!isValidEmail(email)) {
    res.status(400);
    throw new Error('Please provide a valid email address');
  }

  if (inquiryType && !VALID_TYPES.includes(inquiryType)) {
    res.status(400);
    throw new Error('Invalid inquiry type');
  }

  if (inquiryType === 'Order Inquiry' && !orderNumber) {
    res.status(400);
    throw new Error('Order number is required for an order inquiry');
  }

  await sendEmail({
    to: SUPPORT_EMAIL,
    subject: subject ? `Contact Form: ${subject}` : `Contact Form: ${inquiryType || 'New Message'}`,
    html: contactFormEmailTemplate({ name, email, phone, inquiryType, orderNumber, subject, message }),
    sender: 'info',
  });

  res.status(200).json({ success: true, message: 'Your message has been sent — we will get back to you shortly.' });
});

module.exports = { sendContactMessage };