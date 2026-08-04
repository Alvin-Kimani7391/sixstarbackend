const mongoose = require('mongoose');
const { Schema } = mongoose;

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

    identity: {
      idType: { type: String, enum: ['national_id', 'passport', 'alien_id'] },
      fullName: String,
      idNumber: String,
      idFrontImage: String,
      idBackImage: String, // not required for passport
      selfieWithId: String, // optional, either tier
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
        enum: ['sole_proprietorship', 'partnership', 'limited_company', 'llp', 'cooperative', 'other'],
      },
      businessName: String,
      registrationNumber: String,
      registrationCertificate: String,
      cr12Document: String,
      partnershipAgreement: String,
    },

    address: {
      county: String,
      city: String,
      street: String,
      building: String,
      postalCode: String,
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

module.exports = mongoose.model('SellerVerification', sellerVerificationSchema);