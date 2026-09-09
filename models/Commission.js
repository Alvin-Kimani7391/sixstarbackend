const mongoose = require('mongoose');
const { Schema } = mongoose;

// The commission ledger (spec §53). One doc per agent-per-order-per-referral-type.
// A single order can generate TWO independent commission docs — one for the
// agent who referred the buyer, one for the agent who recruited the seller
// (spec §46's two-agent example) — completely decoupled from each other.
const commissionSchema = new Schema(
  {
    agent: { type: Schema.Types.ObjectId, ref: 'Agent', required: true, index: true },
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    referralType: { type: String, enum: ['buyer_referral', 'seller_referral'], required: true },

    buyer: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    seller: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    campaign: { type: Schema.Types.ObjectId, ref: 'Campaign', default: null },

    saleAmount: { type: Number, default: 0 },
    marketplaceProfit: { type: Number, default: 0 }, // KES, basis for this commission
    badge: { type: Schema.Types.ObjectId, ref: 'AgentBadge', default: null }, // snapshot at creation
    commissionRate: { type: Number, default: 0 },
    commissionAmount: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ['pending', 'processing', 'eligible', 'confirmed', 'cancelled', 'reversed'],
      default: 'pending',
      index: true,
    },

    deliveredAt: { type: Date, default: null },
    confirmedAt: { type: Date, default: null },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

commissionSchema.index({ order: 1, agent: 1, referralType: 1, seller: 1 });
commissionSchema.index({ agent: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('Commission', commissionSchema);