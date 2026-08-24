const asyncHandler = require('express-async-handler');
const RFQRequest = require('../models/RFQRequest');
const RFQBid = require('../models/RFQBid');
const { User } = require('../models/User');
const safeSendEmail = require('../utils/safeSendEmail');
const { maskIdentity } = require('../utils/privacy');
const { scanMessage, decideAction, WARNING_NOTICE } = require('../utils/rfqModeration');
const {
  newBidBuyerTemplate,
  bidUpdatedBuyerTemplate,
  offerAcceptedSellerTemplate,
  offerRejectedSellerTemplate,
  messagingRestrictedTemplate,
} = require('../utils/emailTemplates.rfq');

/**
 * Runs a bid/message's free-text field through contact moderation and
 * applies the graduated response to the AUTHOR's account. Returns the safe
 * text to store, or throws (via res) if the author is currently restricted.
 */
async function moderateAndTrack(rawText, authorId, res) {
  const author = await User.findById(authorId).select('contactShareWarnings messagingRestricted');

  if (author.messagingRestricted) {
    res.status(403);
    throw new Error(
      'Your messaging privileges are currently restricted pending review. Please contact support.'
    );
  }

  if (!rawText) return { safeText: '', flagged: false, notice: null };

  const { flags, maskedText } = scanMessage(rawText);
  if (flags.length === 0) return { safeText: rawText, flagged: false, notice: null };

  const { action, restrictMessaging, flagForReview } = decideAction(author.contactShareWarnings || 0);

  author.contactShareWarnings = (author.contactShareWarnings || 0) + 1;
  if (restrictMessaging) {
    author.messagingRestricted = true;
    author.messagingRestrictedAt = new Date();
  }
  if (flagForReview) author.flaggedForReview = true;
  await author.save();

  if (action === 'blocked') {
    if (author.email) {
      safeSendEmail(
        {
          to: author.email,
          subject: 'Messaging Temporarily Restricted',
          html: messagingRestrictedTemplate({ recipientName: author.name }),
          sender: 'info',
        },
        'Messaging restricted notice'
      );
    }
    res.status(403);
    throw new Error(WARNING_NOTICE + ' Your message could not be sent and your account has been flagged for review.');
  }

  return { safeText: maskedText, flagged: true, notice: WARNING_NOTICE };
}

/* ================================================================ */
/* SELLER                                                             */
/* ================================================================ */

// @desc    Seller submits or updates their private offer on an RFQ
//          (one bid per seller per RFQ — upsert)
// @route   POST /api/rfq/:rfqId/bids
// @access  Private (wholesaler/retailer)
const submitOrUpdateBid = asyncHandler(async (req, res) => {
  if (!['wholesaler', 'retailer'].includes(req.user.role)) {
    res.status(403);
    throw new Error('Only sellers can submit an offer');
  }

  const rfq = await RFQRequest.findById(req.params.rfqId);
  if (!rfq || rfq.isSuspended) {
    res.status(404);
    throw new Error('Request not found');
  }
  if (!['OPEN', 'BIDDING'].includes(rfq.status)) {
    res.status(400);
    throw new Error('This request is no longer accepting offers');
  }

  const { unitPrice, quantityAvailable, deliveryFee, deliveryTime, offerValidUntil, message } = req.body;
  if (!unitPrice || !quantityAvailable) {
    res.status(400);
    throw new Error('Price and quantity available are required');
  }

  const { safeText, flagged, notice } = await moderateAndTrack(message, req.user._id, res);

  const existingBid = await RFQBid.findOne({ rfq: rfq._id, seller: req.user._id });
  const isUpdate = !!existingBid;

  const bid = await RFQBid.findOneAndUpdate(
    { rfq: rfq._id, seller: req.user._id },
    {
      unitPrice,
      quantityAvailable,
      deliveryFee: deliveryFee || 0,
      deliveryTime: deliveryTime || '',
      offerValidUntil: offerValidUntil || undefined,
      message: safeText,
      messageFlagged: flagged,
      status: 'pending',
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  if (!isUpdate) {
    rfq.bidCount += 1;
    if (rfq.status === 'OPEN') rfq.status = 'BIDDING';
    await rfq.save();
  }

  res.status(isUpdate ? 200 : 201).json({ success: true, bid, notice: notice || undefined });

  const buyer = await User.findById(rfq.buyer).select('name email');
  if (buyer?.email) {
    safeSendEmail(
      {
        to: buyer.email,
        subject: isUpdate ? `Offer Updated - ${rfq.productName}` : `New Offer Received - ${rfq.productName}`,
        html: isUpdate
          ? bidUpdatedBuyerTemplate({ rfq, buyerName: buyer.name })
          : newBidBuyerTemplate({ rfq, buyerName: buyer.name, bidCount: rfq.bidCount }),
        sender: 'info',
      },
      isUpdate ? 'Bid updated' : 'New bid'
    );
  }
});

// @desc    Seller withdraws their own pending offer
// @route   PATCH /api/rfq/bids/:bidId/withdraw
// @access  Private (seller, bid owner only)
const withdrawBid = asyncHandler(async (req, res) => {
  const bid = await RFQBid.findById(req.params.bidId);
  if (!bid) {
    res.status(404);
    throw new Error('Offer not found');
  }
  if (String(bid.seller) !== String(req.user._id)) {
    res.status(403);
    throw new Error('Not authorized');
  }
  if (bid.status !== 'pending') {
    res.status(400);
    throw new Error('Only a pending offer can be withdrawn');
  }
  bid.status = 'withdrawn';
  await bid.save();
  res.json({ success: true, message: 'Offer withdrawn', bid });
});

// @desc    Seller's own bids across all RFQs
// @route   GET /api/rfq/bids/mine
// @access  Private (seller)
const getMyBids = asyncHandler(async (req, res) => {
  const bids = await RFQBid.find({ seller: req.user._id })
    .populate('rfq', 'productName productImage status quantity unit location requiredDate')
    .sort('-updatedAt');
  res.json({ success: true, count: bids.length, bids });
});

/* ================================================================ */
/* BUYER                                                              */
/* ================================================================ */

// @desc    Buyer's offers/bids comparison view for one of their own RFQs.
//          Seller identity is masked; only non-identifying business
//          context (name, location, verification, rating) is shown.
// @route   GET /api/rfq/:rfqId/bids
// @access  Private (buyer, RFQ owner only)
const getBuyerOffers = asyncHandler(async (req, res) => {
  const rfq = await RFQRequest.findById(req.params.rfqId);
  if (!rfq) {
    res.status(404);
    throw new Error('Request not found');
  }
  if (String(rfq.buyer) !== String(req.user._id)) {
    res.status(403);
    throw new Error('Not authorized');
  }

  const bids = await RFQBid.find({ rfq: rfq._id, status: { $ne: 'withdrawn' } })
    .populate('seller', 'name isVerified businessName shopName location')
    .sort('-createdAt');

  const offers = bids.map((b) => ({
    _id: b._id,
    seller: maskIdentity(b.seller, 'seller'),
    unitPrice: b.unitPrice,
    quantityAvailable: b.quantityAvailable,
    deliveryFee: b.deliveryFee,
    deliveryTime: b.deliveryTime,
    offerValidUntil: b.offerValidUntil,
    message: b.message,
    status: b.status,
    createdAt: b.createdAt,
  }));

  res.json({ success: true, count: offers.length, offers });
});

// @desc    Buyer accepts one seller's offer. All other pending offers on
//          this RFQ are automatically rejected and their sellers notified.
// @route   PATCH /api/rfq/bids/:bidId/accept
// @access  Private (buyer, RFQ owner only)
const acceptBid = asyncHandler(async (req, res) => {
  const bid = await RFQBid.findById(req.params.bidId);
  if (!bid) {
    res.status(404);
    throw new Error('Offer not found');
  }

  const rfq = await RFQRequest.findById(bid.rfq);
  if (!rfq) {
    res.status(404);
    throw new Error('Request not found');
  }
  if (String(rfq.buyer) !== String(req.user._id)) {
    res.status(403);
    throw new Error('Not authorized');
  }
  if (bid.status !== 'pending') {
    res.status(400);
    throw new Error('This offer is no longer available');
  }

  bid.status = 'accepted';
  await bid.save();

  rfq.status = 'SELLER_SELECTED';
  rfq.selectedSeller = bid.seller;
  rfq.selectedBid = bid._id;
  await rfq.save();

  const otherBids = await RFQBid.find({ rfq: rfq._id, _id: { $ne: bid._id }, status: 'pending' });
  await RFQBid.updateMany({ _id: { $in: otherBids.map((b) => b._id) } }, { status: 'rejected' });

  res.json({ success: true, message: 'Seller selected', rfq, bid });

  const seller = await User.findById(bid.seller).select('name email');
  if (seller?.email) {
    safeSendEmail(
      {
        to: seller.email,
        subject: `You've Been Selected - ${rfq.productName}`,
        html: offerAcceptedSellerTemplate({ rfq, sellerName: seller.name, bid }),
        sender: 'info',
      },
      'Offer accepted'
    );
  }

  for (const otherBid of otherBids) {
    const rejectedSeller = await User.findById(otherBid.seller).select('name email');
    if (rejectedSeller?.email) {
      safeSendEmail(
        {
          to: rejectedSeller.email,
          subject: `Offer Update - ${rfq.productName}`,
          html: offerRejectedSellerTemplate({ rfq, sellerName: rejectedSeller.name }),
          sender: 'info',
        },
        'Offer rejected'
      );
    }
  }
});

/* ================================================================ */
/* ADMIN                                                              */
/* ================================================================ */

// @desc    Admin: get every bid on an RFQ, any status, with full
//          (unmasked) seller identity — used by the moderation modal.
// @route   GET /api/rfq/admin/:id/bids
// @access  Private (admin)
const adminGetRFQBids = asyncHandler(async (req, res) => {
  const bids = await RFQBid.find({ rfq: req.params.id })
    .populate('seller', 'name email businessName shopName role')
    .sort('-createdAt');

  res.json({ success: true, count: bids.length, bids });
});

module.exports = {
  submitOrUpdateBid,
  withdrawBid,
  getMyBids,
  getBuyerOffers,
  acceptBid,
  adminGetRFQBids,
};