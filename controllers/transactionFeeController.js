const asyncHandler = require('express-async-handler');
const TransactionFeeTier = require('../models/TransactionFeeTier');

async function resolveTransactionFee(amount) {
  const value = Number(amount) || 0;

  const tier = await TransactionFeeTier.findOne({
    isActive: true,
    amountFrom: { $lte: value },
    $or: [{ amountTo: null }, { amountTo: { $gte: value } }],
  }).sort({ amountFrom: -1 });

  if (!tier) return { fee: 0, tier: null };

  return {
    fee: tier.fee,
    tier: { id: tier._id, amountFrom: tier.amountFrom, amountTo: tier.amountTo, label: tier.label || '' },
  };
}

const getActiveTiers = asyncHandler(async (req, res) => {
  const tiers = await TransactionFeeTier.find({ isActive: true }).sort('amountFrom');
  res.json({ success: true, tiers });
});

module.exports = { resolveTransactionFee, getActiveTiers };