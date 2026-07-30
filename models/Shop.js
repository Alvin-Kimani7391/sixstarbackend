const mongoose = require('mongoose');
const { Schema } = mongoose;

// ---------------------------------------------------------------------------
// Minimal Shop model — just enough for:
//   1. A seller to create one shop (optional)
//   2. Admin to approve/reject/suspend/reactivate/verify/feature it
//   3. Product creation to silently attach an approved shop's id to new products
//
// Branding/customization fields (theme, banners, layout, collections, policies,
// etc. from the full spec) are intentionally left minimal for now and can be
// expanded later without breaking anything here.
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

    // Reserved for later customization work (colors, layout, etc.)
    themeConfiguration: { type: Schema.Types.Mixed, default: {} },
    homepageLayout: { type: String, default: 'default' },

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

// Helpful indexes for the admin table's status/search filters and the
// (future) public shop directory's featured/verified filters.
shopSchema.index({ status: 1, isActive: 1 });
shopSchema.index({ shopName: 'text' });

module.exports = mongoose.model('Shop', shopSchema);