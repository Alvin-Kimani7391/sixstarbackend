const asyncHandler = require('express-async-handler');
const SellerVerification = require('../models/SellerVerification');

const requireApprovedSeller = asyncHandler(async (req, res, next) => {
  if (!['retailer', 'wholesaler'].includes(req.user.role)) return next();
  const record = await SellerVerification.findOne({ seller: req.user.id });
  if (!record || record.status !== 'approved') {
    res.status(403);
    throw new Error('Your seller account must be verified before you can list products');
  }
  next();
});

module.exports = { requireApprovedSeller };