const mongoose = require('mongoose');
const { Schema } = mongoose;

// ---------------------------------------------------------------------------
// Shop model — a seller's optional shop, now with full storefront
// customization support via `customizationMode` + `themeConfiguration`.
//
//   customizationMode: 'basic'  -> storefront renders the original fixed
//                                  passport/banner layout (no theme applied,
//                                  identical to how shops rendered before
//                                  this feature existed).
//                       'custom' -> storefront renders entirely from
//                                  themeConfiguration (header, hero, product
//                                  grid, arrangeable sections, footer — see
//                                  utils/shopThemeDefaults.js for the shape).
//
// Sellers can flip between the two any time without losing their saved
// theme — 'basic' just means the theme isn't applied right now.
// ---------------------------------------------------------------------------

function slugify(str) {
  return String(str)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const shopSchema = new Schema(
  {
    seller: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true, // one shop per seller for now
      index: true,
    },
    shopName: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true },
    logo: { type: String, default: '' },
    banner: { type: String, default: '' },
    description: { type: String, default: '' },
    businessCategory: { type: String, default: '' },
    businessHours: { type: String, default: '' },

    // --- Storefront customization ---
    customizationMode: {
      type: String,
      enum: ['basic', 'custom'],
      default: 'basic',
    },
    themeConfiguration: { type: Schema.Types.Mixed, default: {} },
    homepageLayout: { type: String, default: 'default' }, // legacy field, kept for back-compat

    // --- Approval workflow ---
    status: {
      type: String,
      enum: ['pending_approval', 'approved', 'rejected', 'suspended'],
      default: 'pending_approval',
      index: true,
    },
    rejectionReason: { type: String, default: '' },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },

    verificationStatus: {
      type: String,
      enum: ['unverified', 'verified'],
      default: 'unverified',
    },

    // --- Ratings (auto-calculated from ShopReview collection) ---
    ratingsAverage: { type: Number, default: 0, min: 0, max: 5 },
    ratingsCount: { type: Number, default: 0 },

    // Admin-only homepage spotlight toggle. Only ever meaningful on an
    // approved shop — enforced in the controller, not here.
    isFeatured: { type: Boolean, default: false, index: true },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Auto-generate a unique slug from shopName if one wasn't supplied.
shopSchema.statics.buildUniqueSlug = async function (shopName, excludeId = null) {
  const base = slugify(shopName) || 'shop';
  let candidate = base;
  let suffix = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const query = { slug: candidate };
    if (excludeId) query._id = { $ne: excludeId };
    // eslint-disable-next-line no-await-in-loop
    const exists = await this.findOne(query).select('_id');
    if (!exists) return candidate;
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
};

shopSchema.index({ status: 1, isActive: 1 });
shopSchema.index({ shopName: 'text' });

module.exports = mongoose.model('Shop', shopSchema);