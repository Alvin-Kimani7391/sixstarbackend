const mongoose = require('mongoose');
const crypto = require('crypto');
const { Schema } = mongoose;

// ============================================================
// EmailSubscriber — the single CRM record every promotional email
// is sent against, whether the person is:
//   - a guest who only left an email while browsing (source: 'guest_capture')
//   - a registered buyer/wholesaler/retailer (source: 'registration', linked via userId)
//   - manually imported / pasted by admin (source: 'manual_import')
//
// This is intentionally decoupled from the User model — nothing here
// requires touching models/User.js. When a campaign targets "All buyers",
// the backend still creates/looks up a subscriber record for each buyer
// on the fly (see subscriberService.getOrCreateByEmail) purely so every
// recipient has one unsubscribe token and one send/open/click history,
// regardless of whether they ever "signed up" for email specifically.
// ============================================================

const searchTermSchema = new Schema(
  {
    term: { type: String, required: true, trim: true, lowercase: true },
    count: { type: Number, default: 1 },
    lastSearchedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const viewedProductSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    viewCount: { type: Number, default: 1 },
    viewedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const emailSubscriberSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    name: { type: String, default: '', trim: true },

    // Links back to a real account when we have one — never required.
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    role: {
      type: String,
      enum: ['buyer', 'wholesaler', 'retailer', 'guest'],
      default: 'guest',
    },

    // Anonymous browsing identity set client-side (see frontend/guest-capture.js)
    // BEFORE we know the person's email — lets us attach the search/view
    // history that happened before capture to the subscriber the moment
    // they do give us an email.
    guestId: { type: String, default: null, index: true },

    status: {
      type: String,
      enum: ['subscribed', 'unsubscribed', 'bounced'],
      default: 'subscribed',
      index: true,
    },
    unsubscribeToken: {
      type: String,
      unique: true,
      default: () => crypto.randomBytes(20).toString('hex'),
    },
    unsubscribedAt: { type: Date, default: null },

    source: {
      type: String,
      enum: ['guest_capture', 'registration', 'manual_import', 'checkout', 'agent_referral'],
      default: 'guest_capture',
    },

    tags: [{ type: String, trim: true }],

    // ---- Behavioural signal used to build personalized recommendation blocks ----
    searchHistory: { type: [searchTermSchema], default: [] },
    viewedProducts: { type: [viewedProductSchema], default: [] },

    // ---- Engagement stats (rolled up from EmailSendLog on every send) ----
    emailsSentCount: { type: Number, default: 0 },
    emailsOpenedCount: { type: Number, default: 0 },
    emailsClickedCount: { type: Number, default: 0 },
    lastEmailSentAt: { type: Date, default: null },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

emailSubscriberSchema.index({ status: 1, role: 1, createdAt: -1 });
emailSubscriberSchema.index({ 'searchHistory.term': 1 });
emailSubscriberSchema.index({ 'viewedProducts.product': 1 });

// Push/bump a search term, capped to the 25 most-recent distinct terms.
emailSubscriberSchema.methods.recordSearch = function (rawTerm) {
  const term = String(rawTerm || '').trim().toLowerCase();
  if (!term) return;
  const existing = this.searchHistory.find((s) => s.term === term);
  if (existing) {
    existing.count += 1;
    existing.lastSearchedAt = new Date();
  } else {
    this.searchHistory.unshift({ term, count: 1, lastSearchedAt: new Date() });
  }
  if (this.searchHistory.length > 25) this.searchHistory = this.searchHistory.slice(0, 25);
};

// Push/bump a viewed product, capped to the 30 most-recent.
emailSubscriberSchema.methods.recordView = function (productId) {
  if (!productId) return;
  const idStr = String(productId);
  const existing = this.viewedProducts.find((v) => String(v.product) === idStr);
  if (existing) {
    existing.viewCount += 1;
    existing.viewedAt = new Date();
  } else {
    this.viewedProducts.unshift({ product: productId, viewCount: 1, viewedAt: new Date() });
  }
  if (this.viewedProducts.length > 30) this.viewedProducts = this.viewedProducts.slice(0, 30);
};

module.exports = mongoose.model('EmailSubscriber', emailSubscriberSchema);