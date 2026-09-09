const mongoose = require('mongoose');
const { Schema } = mongoose;

const marketingAssetSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    assetType: { type: String, enum: ['image', 'banner', 'video', 'flyer', 'document'], required: true },

    fileUrl: { type: String, required: true },
    thumbnailUrl: { type: String, default: '' },

    audience: { type: String, enum: ['buyer', 'seller', 'agent', 'everyone'], default: 'everyone', index: true },
    campaign: { type: Schema.Types.ObjectId, ref: 'Campaign', default: null, index: true },
    channels: [
      { type: String, enum: ['whatsapp', 'email', 'facebook', 'instagram', 'tiktok', 'linkedin', 'x', 'qr', 'direct', 'other'] },
    ],
    cta: { type: String, default: 'Shop Now' },

    publishAt: { type: Date, default: null },
    expiryAt: { type: Date, default: null },

    status: {
      type: String,
      enum: ['draft', 'pending_review', 'approved', 'scheduled', 'published', 'expired', 'archived'],
      default: 'draft',
      index: true,
    },

    isFeatured: { type: Boolean, default: false, index: true },
    // Agent Academy (spec §66) reuses this same asset library instead of a
    // separate model — training videos/PDFs/guides are just assets with
    // this flag set and audience:'agent'.
    isAcademyContent: { type: Boolean, default: false, index: true },

    downloadCount: { type: Number, default: 0 },
    shareCount: { type: Number, default: 0 },
    viewCount: { type: Number, default: 0 },

    // Versioning (spec §74) — replacing a file archives the old doc and
    // creates a new one linked back via previousVersion.
    version: { type: Number, default: 1 },
    previousVersion: { type: Schema.Types.ObjectId, ref: 'MarketingAsset', default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

marketingAssetSchema.index({ title: 'text', description: 'text' });
marketingAssetSchema.index({ status: 1, audience: 1, isFeatured: 1 });

module.exports = mongoose.model('MarketingAsset', marketingAssetSchema);