/* ============================================================
   SIX STAR SUPPLIERS — RFQ / Bidding / Private Chat routes
   Mount in server.js with:
     app.use('/api/rfq', require('./routes/rfqRoutes'));
   ============================================================ */

const express = require('express');
const router = express.Router();

const { protect, authorize } = require('../middleware/authMiddleware');
const { uploadRFQImage, uploadRFQChatImage } = require('../middleware/uploadMiddleware');

const {
  createRFQ,
  getPublicRFQs,
  getRFQDetail,
  getMyRFQs,
  getBuyerIdentityForSeller,   // NEW — was defined/exported but never wired
  getSimilarProducts,
  closeRFQ,
  cancelRFQ,
  getMyRFQActivity,
  adminGetAllRFQs,
  adminSuspendRFQ,
  adminDeleteRFQ,
  adminGetFlaggedUsers,
  adminLiftRestriction,
} = require('../controllers/rfqController');

const {
  submitOrUpdateBid,
  withdrawBid,
  getMyBids,
  getBuyerOffers,
  acceptBid,
} = require('../controllers/rfqBidController');

const { sendMessage, getConversation } = require('../controllers/rfqMessageController');

// ------------------------------------------------------------------
// Public
// ------------------------------------------------------------------
router.get('/similar-products', getSimilarProducts);
router.get('/', getPublicRFQs);
router.get('/:id', getRFQDetail);

// ------------------------------------------------------------------
// Authenticated — profile widget (buyer or seller)
// ------------------------------------------------------------------
router.get('/profile/activity', protect, getMyRFQActivity);


// ------------------------------------------------------------------
// Buyer
// ------------------------------------------------------------------
router.post('/', protect, authorize('buyer'), uploadRFQImage, createRFQ);
router.get('/mine/list', protect, authorize('buyer'), getMyRFQs);
router.patch('/:id/close', protect, authorize('buyer'), closeRFQ);
router.patch('/:id/cancel', protect, authorize('buyer'), cancelRFQ);
router.get('/:rfqId/bids', protect, authorize('buyer'), getBuyerOffers);
router.patch('/bids/:bidId/accept', protect, authorize('buyer'), acceptBid);

// ------------------------------------------------------------------
// Seller
// ------------------------------------------------------------------
router.post('/:rfqId/bids', protect, authorize('wholesaler', 'retailer'), submitOrUpdateBid);
router.patch('/bids/:bidId/withdraw', protect, authorize('wholesaler', 'retailer'), withdrawBid);
router.get('/bids/mine/list', protect, authorize('wholesaler', 'retailer'), getMyBids);
// NEW — masked buyer identity, only unlocked once this seller has a bid on the RFQ
router.get('/:rfqId/buyer-identity', protect, authorize('wholesaler', 'retailer'), getBuyerIdentityForSeller);
// ------------------------------------------------------------------
// Chat — shared by buyer & seller, access is validated inside the
// controller (must be the RFQ's buyer, or a seller who has bid on it)
// ------------------------------------------------------------------
router.post('/:rfqId/messages', protect, uploadRFQChatImage, sendMessage);
router.get('/:rfqId/messages/:counterpartId', protect, getConversation);

// ------------------------------------------------------------------
// Admin monitoring (report section 16/17)
// ------------------------------------------------------------------
router.get('/admin/all', protect, authorize('admin'), adminGetAllRFQs);
router.patch('/admin/:id/suspend', protect, authorize('admin'), adminSuspendRFQ);
router.delete('/admin/:id', protect, authorize('admin'), adminDeleteRFQ);
router.get('/admin/flagged-users', protect, authorize('admin'), adminGetFlaggedUsers);
router.patch('/admin/users/:id/lift-restriction', protect, authorize('admin'), adminLiftRestriction);

module.exports = router;