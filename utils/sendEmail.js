const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

/**
 * Sends an email via SendGrid.
 * @param {Object} opts
 * @param {string} opts.to      Recipient email address
 * @param {string} opts.subject Email subject line
 * @param {string} opts.html    HTML body
 * @param {string} [opts.text]  Optional plain-text fallback
 */
const sendEmail = async ({ to, subject, html, text }) => {
  const msg = {
    to,
    from: {
      email: process.env.SENDGRID_FROM_EMAIL, // must be a verified sender/domain in SendGrid
      name: 'Six Star Suppliers',
    },
    subject,
    html,
    text: text || undefined,
  };

  await sgMail.send(msg);
};

module.exports = sendEmail;