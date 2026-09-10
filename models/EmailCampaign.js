const mongoose = require('mongoose');
const { Schema } = mongoose;

// ============================================================
// EmailCampaign — one bulk promotional send. Modeled after how
// Shopify/Klaviyo-style campaigns work:
//   - admin writes the message once (subject, hero image, body, CTA)
//   - picks WHO receives it (segment)
//   - picks WHEN it goes out (send now, or schedule for later)
//   - the system can auto-attach a "Recommended for you" product grid
//     built per-recipient from their own search/view history
// ============================================================

const segmentSchema = new Schema(
  {
    type: {
      type: String,
      enum: [
        'all_subscribers', // every non-unsubscribed record in EmailSubscriber (guests + captured + imported)
        'buyers', // every User with role 'buyer'
        'sellers', // every User with role 'wholesaler' or 'retailer'
        'guests', // EmailSubscriber records with no linked userId
        'searched_term', // anyone (guest or user) who searched a given term
        'viewed_category', // anyone who viewed a product in a given category
        'custom_emails', // admin pasted a raw list of emails
      ],
      required: true,
    },
    // term string for 'searched_term', category ObjectId string for
    // 'viewed_category', array of email strings for 'custom_emails'.
    value: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const emailCampaignSchema = new Schema(
  {
    name: { type: String, required: true, trim: true }, // internal name, never shown to recipients
    subject: { type: String, required: true, trim: true },
    previewText: { type: String, default: '', trim: true }, // inbox preview snippet

    fromName: { type: String, default: 'Six Star Suppliers' },

    // 'custom' = admin's own bodyHtml is used as-is (may still contain the
    // {{recommended_products}} placeholder to inject a personalized grid).
    // 'auto_recommendation' = a "Recommended for you" email is generated
    // automatically around whatever intro copy the admin wrote.
    contentType: { type: String, enum: ['custom', 'auto_recommendation'], default: 'custom' },

    heroImageUrl: { type: String, default: '' },
    bodyHtml: { type: String, default: '' }, // admin-authored HTML/plain text with line breaks
    ctaText: { type: String, default: 'Shop Now' },
    ctaUrl: { type: String, default: '' },

    // How many personalized "recommended for you" products to show, when applicable.
    recommendedProductCount: { type: Number, default: 4, min: 0, max: 8 },

    segment: { type: segmentSchema, required: true },

    status: {
      type: String,
      enum: ['draft', 'scheduled', 'sending', 'sent', 'cancelled', 'failed'],
      default: 'draft',
      index: true,
    },
    scheduledAt: { type: Date, default: null, index: true },
    sentAt: { type: Date, default: null },

    stats: {
      totalRecipients: { type: Number, default: 0 },
      sent: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      opened: { type: Number, default: 0 },
      clicked: { type: Number, default: 0 },
      unsubscribed: { type: Number, default: 0 },
    },

    lastError: { type: String, default: '' },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

emailCampaignSchema.index({ status: 1, scheduledAt: 1 });

module.exports = mongoose.model('EmailCampaign', emailCampaignSchema);