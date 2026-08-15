const asyncHandler = require('express-async-handler');
const RFQRequest = require('../models/RFQRequest');
const RFQBid = require('../models/RFQBid');
const RFQMessage = require('../models/RFQMessage');
const { User } = require('../models/User');
const safeSendEmail = require('../utils/safeSendEmail');
const { maskIdentity } = require('../utils/privacy');
const { scanMessage, decideAction, WARNING_NOTICE } = require('../utils/rfqModeration');
const { newMessageTemplate, messagingRestrictedTemplate } = require('../utils/emailTemplates.rfq');

/**
 * Confirms `senderId` is allowed to message `receiverId` about this RFQ,
 * and that the pairing is legitimate:
 *   - buyer -> a seller who has (at some point) bid on this RFQ
 *   - seller -> the RFQ's buyer, and only if THIS seller has bid on it
 * Sellers can never message each other or the buyer's other seller threads.
 */
async function assertValidPair(rfq, senderId, receiverId) {
  const senderIsBuyer = String(rfq.buyer) === String(senderId);
  const receiverIsBuyer = String(rfq.buyer) === String(receiverId);

  if (senderIsBuyer && receiverIsBuyer) return false; // can't message yourself
  if (!senderIsBuyer && !receiverIsBuyer) return false; // seller-to-seller not allowed

  const sellerId = senderIsBuyer ? receiverId : senderId;
  const hasBid = await RFQBid.exists({ rfq: rfq._id, seller: sellerId });
  return !!hasBid;
}

/**
 * Runs text through contact moderation and applies the graduated response
 * to the sender's account. Throws (via res) if sender is currently
 * restricted, or if this message trips the "blocked" tier.
 */
async function moderateAndTrack(rawText, senderId, res) {
  const sender = await User.findById(senderId).select('name email contactShareWarnings messagingRestricted');

  if (sender.messagingRestricted) {
    res.status(403);
    throw new Error('Your messaging privileges are currently restricted pending review. Please contact support.');
  }

  if (!rawText) return { safeText: '', moderationAction: 'none', moderationFlags: [] };

  const { flags, maskedText } = scanMessage(rawText);
  if (flags.length === 0) return { safeText: rawText, moderationAction: 'none', moderationFlags: [] };

  const { action, restrictMessaging, flagForReview } = decideAction(sender.contactShareWarnings || 0);

  sender.contactShareWarnings = (sender.contactShareWarnings || 0) + 1;
  if (restrictMessaging) {
    sender.messagingRestricted = true;
    sender.messagingRestrictedAt = new Date();
  }
  if (flagForReview) sender.flaggedForReview = true;
  await sender.save();

  if (action === 'blocked') {
    if (sender.email) {
      safeSendEmail(
        { to: sender.email, subject: 'Messaging Temporarily Restricted', html: messagingRestrictedTemplate({ recipientName: sender.name }) },
        'Messaging restricted notice'
      );
    }
    res.status(403);
    throw new Error(WARNING_NOTICE + ' Your message could not be sent and your account has been flagged for review.');
  }

  return { safeText: maskedText, moderationAction: 'masked', moderationFlags: flags, notice: WARNING_NOTICE };
}

// @desc    Send a message (text or image) in a private RFQ conversation
// @route   POST /api/rfq/:rfqId/messages
// @access  Private (buyer or a seller who has bid on this RFQ)
const sendMessage = asyncHandler(async (req, res) => {
  const { receiverId, message } = req.body;
  if (!receiverId) {
    res.status(400);
    throw new Error('receiverId is required');
  }

  const rfq = await RFQRequest.findById(req.params.rfqId);
  if (!rfq) {
    res.status(404);
    throw new Error('Request not found');
  }

  const validPair = await assertValidPair(rfq, req.user._id, receiverId);
  if (!validPair) {
    res.status(403);
    throw new Error('You are not part of this conversation');
  }

  const isImage = !!req.file;
  let safeText = '';
  let moderationAction = 'none';
  let moderationFlags = [];
  let notice;

  if (!isImage) {
    if (!message || !message.trim()) {
      res.status(400);
      throw new Error('Message cannot be empty');
    }
    const result = await moderateAndTrack(message, req.user._id, res);
    safeText = result.safeText;
    moderationAction = result.moderationAction;
    moderationFlags = result.moderationFlags;
    notice = result.notice;
  } else {
    // Still verify the sender isn't currently restricted before allowing an image.
    const sender = await User.findById(req.user._id).select('messagingRestricted');
    if (sender.messagingRestricted) {
      res.status(403);
      throw new Error('Your messaging privileges are currently restricted pending review. Please contact support.');
    }
  }

  const chatMessage = await RFQMessage.create({
    rfq: rfq._id,
    sender: req.user._id,
    receiver: receiverId,
    messageType: isImage ? 'image' : 'text',
    message: safeText,
    imageUrl: isImage ? req.file.path : undefined,
    moderationAction,
    moderationFlags,
  });

  res.status(201).json({ success: true, message: chatMessage, notice });

  const receiver = await User.findById(receiverId).select('name email');
  const sender = await User.findById(req.user._id).select('name');
  const isBuyerRecipient = String(rfq.buyer) === String(receiverId);
  if (receiver?.email) {
    safeSendEmail(
      {
        to: receiver.email,
        subject: `New Message - ${rfq.productName}`,
        html: newMessageTemplate({
          rfq,
          recipientName: receiver.name,
          isBuyer: isBuyerRecipient,
          senderLabel: maskIdentity(sender, isBuyerRecipient ? 'seller' : 'buyer').label,
        }),
      },
      'New RFQ message'
    );
  }
});

// @desc    Get the private conversation thread between the logged-in user
//          and one counterpart on one RFQ. Marks the counterpart's
//          messages as read.
// @route   GET /api/rfq/:rfqId/messages/:counterpartId
// @access  Private (participants only)
const getConversation = asyncHandler(async (req, res) => {
  const { rfqId, counterpartId } = req.params;

  const rfq = await RFQRequest.findById(rfqId).select('buyer productName');
  if (!rfq) {
    res.status(404);
    throw new Error('Request not found');
  }

  const validPair = await assertValidPair(rfq, req.user._id, counterpartId);
  if (!validPair) {
    res.status(403);
    throw new Error('You are not part of this conversation');
  }

  const messages = await RFQMessage.find({
    rfq: rfqId,
    $or: [
      { sender: req.user._id, receiver: counterpartId },
      { sender: counterpartId, receiver: req.user._id },
    ],
  }).sort('createdAt');

  await RFQMessage.updateMany(
    { rfq: rfqId, sender: counterpartId, receiver: req.user._id, read: false },
    { read: true, readAt: new Date() }
  );

  const counterpartUser = await User.findById(counterpartId).select('name isVerified businessName shopName location');
  const isCounterpartBuyer = String(rfq.buyer) === String(counterpartId);

  res.json({
    success: true,
    rfq: { _id: rfq._id, productName: rfq.productName },
    counterpart: maskIdentity(counterpartUser, isCounterpartBuyer ? 'buyer' : 'seller'),
    messages,
  });
});

/* ================================================================ */
/* ADMIN                                                              */
/* ================================================================ */

// @desc    Admin: get every message across every buyer<->seller thread on
//          an RFQ, unmasked, oldest first — used by the moderation modal's
//          thread picker.
// @route   GET /api/rfq/admin/:id/messages
// @access  Private (admin)
const adminGetRFQMessages = asyncHandler(async (req, res) => {
  const messages = await RFQMessage.find({ rfq: req.params.id })
    .populate('sender', 'name email role')
    .populate('receiver', 'name email role')
    .sort('createdAt');

  res.json({ success: true, count: messages.length, messages });
});

module.exports = {
  sendMessage,
  getConversation,
  adminGetRFQMessages,
};