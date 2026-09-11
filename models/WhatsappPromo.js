const mongoose = require('mongoose');
const { Schema } = mongoose;

// A lightweight history of WhatsApp Status / group promo content someone
// has generated, so they can revisit and re-copy/re-download it later.
// This does NOT send anything itself — WhatsApp has no public API for
// posting to Status or groups, so the flow is always "generate -> copy
// caption -> download image -> post manually / open wa.me to share".
//
// Used by BOTH the admin Marketing Center (createdBy = User/admin) and the
// agent Sharing tab (agent = Agent). Exactly one of createdBy/agent is set.
const whatsappPromoSchema = new Schema(
  {
    title: { type: String, default: '' },
    imageUrl: { type: String, default: '' },
    captions: { type: [String], default: [] }, // multiple ready-to-use variants
    product: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
    link: { type: String, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },   // admin-generated
    agent: { type: Schema.Types.ObjectId, ref: 'Agent', default: null },      // agent-generated
  },
  { timestamps: true }
);

module.exports = mongoose.model('WhatsappPromo', whatsappPromoSchema);