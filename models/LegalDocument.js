const mongoose = require('mongoose');
const { Schema } = mongoose;

const DOC_TYPES = [
  'terms_and_conditions','seller_agreement','privacy_policy','data_protection_agreement',
  'product_listing_policy','prohibited_products_policy','anti_counterfeit_policy','returns_policy',
  'refund_policy','shipping_policy','payments_commission_policy','seller_performance_policy',
  'cosmetics_compliance_policy','seller_code_of_conduct','intellectual_property_policy',
  'account_suspension_policy','seller_fees_schedule','advertising_promotions_policy',
  'seller_verification_policy','community_guidelines','other',
];

const legalDocumentSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    type: { type: String, enum: DOC_TYPES, required: true },
    version: { type: String, required: true },
    description: String,
    fileUrl: { type: String, required: true },
    effectiveDate: { type: Date, required: true },
    expiryDate: Date,
    status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft' },
    isMandatory: { type: Boolean, default: true },
    audience: { type: String, enum: ['sellers', 'buyers', 'both'], default: 'sellers' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

legalDocumentSchema.statics.TYPES = DOC_TYPES;

module.exports = mongoose.model('LegalDocument', legalDocumentSchema);