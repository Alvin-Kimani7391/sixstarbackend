const mongoose = require('mongoose');
const { Schema } = mongoose;

const agentSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true, default: '' },

    // Auto-generated on creation: PF100, PF101, PF102, ...
    code: { type: String, unique: true, index: true },

    commissionRate: { type: Number, default: 5, min: 0, max: 50 }, // percent of order total

    isActive: { type: Boolean, default: true },

    // Running totals, updated whenever a buyer places an order using this agent's code
    totalOrders: { type: Number, default: 0 },
    totalCommission: { type: Number, default: 0 },
  },
  { timestamps: true }
);

agentSchema.set('toJSON', { virtuals: true });

// Auto-generate the next sequential PF code (PF100, PF101, ...) before first save
agentSchema.pre('validate', async function (next) {
  if (this.code) return next(); // already set (or being edited) - never overwrite

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

module.exports = mongoose.model('Agent', agentSchema);