const mongoose = require('mongoose');
const { Schema } = mongoose;

// Agent CRM (spec §36-37) + the seller/buyer recruitment pipeline (§35).
const agentLeadSchema = new Schema(
  {
    agent: { type: Schema.Types.ObjectId, ref: 'Agent', required: true, index: true },

    name: { type: String, required: true, trim: true },
    phone: { type: String, default: '' },
    email: { type: String, default: '', lowercase: true, trim: true },
    businessName: { type: String, default: '' },
    location: { type: String, default: '' },

    leadType: { type: String, enum: ['buyer', 'seller'], required: true, index: true },
    source: {
      type: String,
      enum: ['manual', 'referral_link', 'qr', 'whatsapp', 'email', 'facebook', 'instagram', 'tiktok', 'linkedin', 'x', 'other'],
      default: 'manual',
    },
    campaign: { type: Schema.Types.ObjectId, ref: 'Campaign', default: null },

    status: {
      type: String,
      enum: [
        'lead', 'invited', 'registered', 'application_submitted', 'documents_submitted',
        'under_review', 'approved', 'active', 'product_listed', 'first_sale', 'converted', 'lost',
      ],
      default: 'lead',
      index: true,
    },

    notes: [{ text: { type: String, required: true }, createdAt: { type: Date, default: Date.now } }],
    lastContactAt: { type: Date, default: null },
    followUpDate: { type: Date, default: null, index: true },

    // Set automatically once this lead's contact info matches a real registration.
    convertedUser: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

agentLeadSchema.index({ agent: 1, status: 1 });
agentLeadSchema.index({ name: 'text', businessName: 'text', phone: 'text', email: 'text' });

module.exports = mongoose.model('AgentLead', agentLeadSchema);