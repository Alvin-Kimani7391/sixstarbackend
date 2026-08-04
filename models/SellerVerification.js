const mongoose = require('mongoose');
const { Schema } = mongoose;

const CATEGORY_OPTIONS = [
  'phones',
  'electronics',
  'fashion',
  'beauty',
  'groceries',
  'home_living',
  'industrial',
  'automotive',
  'agriculture',
];

const sellerVerificationSchema = new Schema(
  {
    seller: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    sellerRole: { type: String, enum: ['retailer', 'wholesaler'], required: true },

    // 'basic' = ID + KRA only. Retailers only. Wholesalers are always forced to 'business'.
    tier: { type: String, enum: ['basic', 'business'], required: true },

    status: {
      type: String,
      enum: ['not_submitted', 'pending', 'approved', 'rejected'],
      default: 'not_submitted',
    },
    rejectionReason: String,
    submittedAt: Date,
    reviewedAt: Date,
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },

    // ---------------------------------------------------------------
    // Step: email verification gate. The actual OTP hash/expiry lives
    // on the User doc (see models/User.js patch) — this just records
    // when/what was verified for audit purposes on this record.
    // ---------------------------------------------------------------
    emailVerification: {
      email: String,
      verified: { type: Boolean, default: false },
      verifiedAt: Date,
    },

    identity: {
      fullName: String,
      dateOfBirth: Date,
      nationality: String,
      idType: { type: String, enum: ['national_id', 'passport', 'alien_id'] },
      idNumber: String,
      idFrontImage: String,
      idBackImage: String, // not required for passport
      selfieWithId: String, // required — spec lists it as mandatory for individual sellers
    },

    tax: {
      kraPinNumber: String,
      kraPinCertificate: String,
      vatRegistered: { type: Boolean, default: false },
      vatCertificate: String,
    },

    // business tier only
    business: {
      classification: {
        type: String,
        enum: ['sole_proprietorship', 'partnership', 'limited_company', 'ngo', 'cooperative', 'other'],
      },
      businessName: String,
      registrationNumber: String,
      registrationCertificate: String,
      cr12Document: String, // limited_company
      partnershipAgreement: String, // partnership
      businessAge: {
        type: String,
        enum: ['lt_6m', '6_12m', '1_3y', 'gt_3y'],
      },
      businessLicense: String, // County Business Permit — optional, category/region dependent
    },

    // Where the business is legally/physically based
    businessAddress: {
      county: String,
      city: String,
      street: String,
      building: String,
      postalCode: String,
    },

    // Optional — only stored if different from businessAddress
    warehouseAddress: {
      sameAsBusiness: { type: Boolean, default: true },
      warehouseName: String,
      county: String,
      city: String,
      street: String,
      building: String,
      mapLink: String,
    },

    returnAddress: {
      recipientName: String,
      county: String,
      city: String,
      street: String,
      postalCode: String,
    },

    store: {
      storeName: String,
      storeLogo: String,
      storeBanner: String,
      storeDescription: { type: String, maxlength: 500 },
    },

    categories: {
      type: [{ type: String, enum: CATEGORY_OPTIONS }],
      default: [],
    },

    social: {
      website: String,
      facebook: String,
      instagram: String,
      tiktok: String,
    },

    payout: {
      method: { type: String, enum: ['mpesa', 'bank'] },
      mpesaNumber: String,
      mpesaName: String,
      bankName: String,
      accountName: String,
      accountNumber: String,
      branchName: String,
    },

    agreedToTerms: { type: Boolean, required: true },
    agreedAt: Date,
  },
  { timestamps: true }
);

sellerVerificationSchema.statics.CATEGORY_OPTIONS = CATEGORY_OPTIONS;

module.exports = mongoose.model('SellerVerification', sellerVerificationSchema);