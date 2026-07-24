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
    phone: { type: String, required: [true, 'Phone number is required'], trim: true },
    password: { type: String, required: true, minlength: 6, select: false },
    avatar: { type: String, default: '' },
    isVerified: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true }, // admin can suspend an account
  },
  baseOptions
);

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.matchPassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
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
