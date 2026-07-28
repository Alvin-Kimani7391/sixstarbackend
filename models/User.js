const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { Schema } = mongoose;

// Base schema shared by every account type
const options = {
  discriminatorKey: 'role', // this field decides wholesaler/retailer/buyer/admin
  collection: 'users',
  timestamps: true,
};

const baseOptions = { ...options };

const userSchema = new Schema(
  {
    name: { type: String, required: [true, 'Name is required'], trim: true },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    // Not required for Google sign-ups, who can add it later from their profile
    phone: {
      type: String,
      required: function () {
        return !this.googleId;
      },
      trim: true,
    },
    // Not required for Google-only accounts (they authenticate via Google, not a local password)
    password: {
      type: String,
      required: function () {
        return !this.googleId;
      },
      minlength: 6,
      select: false,
    },
    avatar: { type: String, default: '' },
    isVerified: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true }, // admin can suspend an account

    // ---------- Google Sign-In ----------
    googleId: { type: String, unique: true, sparse: true, select: false },

    // ---------- Forgot / reset password ----------
    resetPasswordToken: { type: String, select: false },
    resetPasswordExpire: { type: Date, select: false },

    // ---------- Login lockout (brute-force protection) ----------
    failedLoginAttempts: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, select: false },
  },
  baseOptions
);

// Hash password before saving (skips if this save doesn't touch the password,
// e.g. a Google-only account with no password field at all)
userSchema.pre('save', async function (next) {
  if (!this.isModified('password') || !this.password) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.matchPassword = async function (enteredPassword) {
  if (!this.password) return false; // Google-only account has no local password to match
  return bcrypt.compare(enteredPassword, this.password);
};

userSchema.methods.isLocked = function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
};

const User = mongoose.model('User', userSchema);

// ---------- Wholesaler ----------
const Wholesaler = User.discriminator(
  'wholesaler',
  new Schema({
    businessName: { type: String, required: true },
    businessLicenseNo: { type: String },
    location: { type: String, required: true },
    minOrderQuantity: { type: Number, default: 1 }, // wholesalers often sell in bulk
  })
);

// ---------- Retailer ----------
const Retailer = User.discriminator(
  'retailer',
  new Schema({
    shopName: { type: String, required: true },
    location: { type: String, required: true },
  })
);

// ---------- Buyer ----------
const Buyer = User.discriminator(
  'buyer',
  new Schema({
    address: { type: String },
    savedLocations: [{ type: String }],
    recentlyViewed: [
      {
        product: { type: Schema.Types.ObjectId, ref: 'Product' },
        viewedAt: { type: Date, default: Date.now },
      },
    ],
  })
);

// ---------- Admin ----------
const Admin = User.discriminator(
  'admin',
  new Schema({
    permissions: {
      type: [String],
      default: ['manage_products', 'manage_orders', 'manage_ads', 'manage_users'],
    },
  })
);

module.exports = { User, Wholesaler, Retailer, Buyer, Admin };