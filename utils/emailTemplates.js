// Keeping templates in one place makes it easy to restyle emails later
// without touching controller logic.

function passwordResetEmailTemplate(name, resetUrl) {
  return `
  <div style="font-family: Arial, Helvetica, sans-serif; max-width:480px; margin:0 auto; color:#1a1a1a; line-height:1.5;">
    <h2 style="color:#0f5132; margin-bottom: 4px;">Six Star Suppliers</h2>
    <p>Hi ${name || 'there'},</p>
    <p>We received a request to reset your password. This link is valid for <strong>15 minutes</strong>.</p>
    <p style="margin:28px 0;">
      <a href="${resetUrl}"
         style="background:#0f5132;color:#ffffff;padding:12px 26px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;">
        Reset Password
      </a>
    </p>
    <p>If you didn't request this, you can safely ignore this email — your password will stay the same.</p>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
    <p style="color:#666;font-size:13px;">
      If the button above doesn't work, copy and paste this link into your browser:<br>
      <span style="word-break:break-all;">${resetUrl}</span>
    </p>
  </div>`;
}

module.exports = { passwordResetEmailTemplate };