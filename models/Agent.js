const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { Schema } = mongoose;

const socialMediaSchema = new Schema(
  {
    facebook: { type: String, default: '' },
    instagram: { type: String, default: '' },
    tiktok: { type: String, default: '' },
    x: { type: String, default: '' },
    linkedin: { type: String, default: '' },
    whatsapp: { type: String, default: '' }, // WhatsApp number/link used for sharing
  },
  { _id: false }
);

// NEW — payout details agents provide so admin can pay out their commission.
// idNumber is required so it can be cross-checked against the mpesa/bank
// account name (must match the same registered ID).
const payoutSchema = new Schema(
  {
    method: { type: String, enum: ['mpesa', 'bank'], default: 'mpesa' },
    idNumber: { type: String, default: '' },
    mpesaNumber: { type: String, default: '' },
    mpesaName: { type: String, default: '' },
    bankName: { type: String, default: '' },
    accountName: { type: String, default: '' },
    accountNumber: { type: String, default: '' },
    branchName: { type: String, default: '' },
  },
  { _id: false }
);

const agentSchema = new Schema(
  {
    // ---------- Identity ----------
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    password: { type: String, required: true, minlength: 6, select: false },
    avatar: { type: String, default: '' },
    bio: { type: String, default: '', maxlength: 500 },
    location: { type: String, default: '' }, // county/region

    // Auto-generated on creation: PF100, PF101, PF102, ...
    code: { type: String, unique: true, index: true },
    // URL-safe handle for the public agent page, e.g. /agent/james-mwangi-pf100
    publicSlug: { type: String, unique: true, index: true },

    agentType: {
      type: String,
      enum: ['standard', 'premium', 'corporate', 'admin_created'],
      default: 'standard',
    },

    preferredChannel: {
      type: String,
      enum: ['whatsapp', 'email', 'sms', 'call', 'social'],
      default: 'whatsapp',
    },
    socialMedia: { type: socialMediaSchema, default: () => ({}) },

    // NEW — payout / payment details for commission disbursement
    payout: { type: payoutSchema, default: () => ({}) },

    // Kept lightweight for V1 — document upload (ID/KRA/business reg) can be
    // bolted on later using the same Cloudinary pattern as seller verification.
    verification: {
      idNumber: { type: String, default: '' },
      kraPin: { type: String, default: '' },
      businessName: { type: String, default: '' },
    },

    termsAcceptedAt: { type: Date, default: null },
    marketingPolicyAcceptedAt: { type: Date, default: null },

    // ---------- Approval lifecycle ----------
    // application(pending) -> under_review -> approved -> active
    // alt terminal states: rejected / suspended / deactivated
    status: {
      type: String,
      enum: ['pending', 'under_review', 'approved', 'active', 'rejected', 'suspended', 'deactivated'],
      default: 'pending',
      index: true,
    },
    rejectionReason: { type: String, default: '' },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },

    // Legacy boolean your existing code already queries on
    // (Agent.find({isActive:true}) in getActiveAgents, the checkout
    // agentCode lookup in orderController) — kept in sync with `status`
    // by the pre-save hook below so none of that code needs to change.
    isActive: { type: Boolean, default: false },

    // ---------- Badge & commission ----------
    badge: { type: Schema.Types.ObjectId, ref: 'AgentBadge', default: null },
    badgeAssignedAt: { type: Date, default: null },
    // Fallback flat rate, used only when no badge is assigned yet.
    commissionRate: { type: Number, default: 5, min: 0, max: 50 },

    // ---------- Running stats ----------
    totalOrders: { type: Number, default: 0 },
    totalCommission: { type: Number, default: 0 },
    buyersReferred: { type: Number, default: 0 },
    sellersReferred: { type: Number, default: 0 },
    approvedSellersReferred: { type: Number, default: 0 },
    referralClickCount: { type: Number, default: 0 },

    // ---------- Add inside agentSchema, next to the other "Running stats" fields ----------
lifetimeMarketplaceProfit: { type: Number, default: 0 }, // KES, accumulates on every CONFIRMED commission — feeds badge requirement evaluation

    // ---------- Auth support ----------
    resetPasswordToken: { type: String, select: false },
    resetPasswordExpire: { type: Date, select: false },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true }
);

agentSchema.set('toJSON', { virtuals: true });

// Auto-generate the next sequential PF code (PF100, PF101, ...) before first save
agentSchema.pre('validate', async function (next) {
  if (this.code) return next();

  const Agent = this.constructor;
  const existing = await Agent.find({ code: { $regex: /^PF\d+$/ } }).select('code').lean();

  let maxNumber = 99; // so the very first agent becomes PF100
  existing.forEach((a) => {
    const num = parseInt(a.code.replace('PF', ''), 10);
    if (!isNaN(num) && num > maxNumber) maxNumber = num;
  });

  this.code = `PF${maxNumber + 1}`;
  next();
});

// Slug: name + code -> human-readable and guaranteed unique
agentSchema.pre('validate', function (next) {
  if (this.publicSlug || !this.name || !this.code) return next();
  const base = this.name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  this.publicSlug = `${base}-${this.code.toLowerCase()}`;
  next();
});

// Keep the legacy isActive boolean in sync with status.
agentSchema.pre('save', function (next) {
  this.isActive = this.status === 'active';
  next();
});

agentSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

agentSchema.methods.matchPassword = async function (entered) {
  return bcrypt.compare(entered, this.password);
};

module.exports = mongoose.model('Agent', agentSchema);