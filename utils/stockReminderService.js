const Product = require('../models/Product');
const { User } = require('../models/User');
const sendEmail = require('./sendEmail');
const {
  stockReminderSellerTemplate,
  stockReminderAdminTemplate,
} = require('./emailTemplates');

function safeSendEmail(opts, label) {
  sendEmail(opts).catch((err) => console.error(`${label} email failed:`, err.body || err.message));
}

async function getAdminEmails() {
  if (process.env.ADMIN_EMAILS) {
    return process.env.ADMIN_EMAILS.split(',').map((s) => s.trim()).filter(Boolean);
  }
  const admins = await User.find({ role: 'admin' }).select('email');
  return admins.map((a) => a.email).filter(Boolean);
}

// Sends the seller their low-stock reminder AND a monitoring copy to every
// admin, so admin can track whether the seller actually restocks in time.
async function sendLowStockEmails(product) {
  const seller = product.seller; // must already be populated with name/email

  if (seller && seller.email) {
    safeSendEmail(
      {
        to: seller.email,
        subject: `Low stock alert — ${product.name}`,
        html: stockReminderSellerTemplate({ sellerName: seller.name, product }),
        sender: 'info',
      },
      'Low stock reminder (seller)'
    );
  }

  const adminEmails = await getAdminEmails();
  adminEmails.forEach((to) => {
    safeSendEmail(
      {
        to,
        subject: `[Stock Monitor] ${product.name} is low on stock`,
        html: stockReminderAdminTemplate({
          sellerName: seller?.name,
          sellerEmail: seller?.email,
          product,
        }),
        sender: 'info',
      },
      'Low stock reminder (admin copy)'
    );
  });
}

// Re-evaluates ONE product against its own reminder settings right after a
// stock-changing write, and fires an email the moment it first dips to/below
// threshold. Safe/cheap to call after any save that touches `stock`.
async function checkAndSendStockReminder(productId) {
  const product = await Product.findById(productId).populate('seller', 'name email');
  if (!product || !product.stockReminderEnabled) return;

  if (product.stock > product.stockReminderThreshold) {
    // Back above threshold — re-arm so the next dip sends a fresh reminder.
    if (product.lastStockReminderSentAt) {
      product.lastStockReminderSentAt = null;
      await product.save();
    }
    return;
  }

  // At or below threshold — only email if we haven't already alerted for
  // this particular dip (the scheduler below handles repeat nudges).
  if (!product.lastStockReminderSentAt) {
    await sendLowStockEmails(product);
    product.lastStockReminderSentAt = new Date();
    await product.save();
  }
}

// Periodic sweep (see utils/stockReminderScheduler.js) that keeps nudging
// about products that are STILL low, on a cooldown, so a low-stock item that
// never gets touched again doesn't just get one email and go silent — this
// is what actually lets admin "monitor" whether the seller updated stock.
async function recheckAllLowStockProducts(cooldownHours = 24) {
  const cutoff = new Date(Date.now() - cooldownHours * 60 * 60 * 1000);

  const products = await Product.find({
    stockReminderEnabled: true,
    isActive: true,
    $expr: { $lte: ['$stock', '$stockReminderThreshold'] },
    $or: [{ lastStockReminderSentAt: null }, { lastStockReminderSentAt: { $lte: cutoff } }],
  }).populate('seller', 'name email');

  for (const product of products) {
    await sendLowStockEmails(product);
    product.lastStockReminderSentAt = new Date();
    await product.save();
  }

  return products.length;
}

module.exports = {
  checkAndSendStockReminder,
  recheckAllLowStockProducts,
};

/* ------------------------------------------------------------------ */
/* NOTE for orderController.js (not provided, so not edited here):      */
/* wherever an order decrements a product's `stock` field, add:         */
/*                                                                       */
/*   const { checkAndSendStockReminder } = require('../utils/stockReminderService'); */
/*   checkAndSendStockReminder(product._id).catch(() => {});             */
/*                                                                       */
/* right after that stock write is saved — same one-line hook used in   */
/* productController.js below. Without it, stock drops from ORDERS      */
/* won't trigger an immediate email (they'll still get caught by the    */
/* scheduler's periodic sweep within `cooldownHours`, just not instantly).*/
/* ------------------------------------------------------------------ */