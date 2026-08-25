const asyncHandler = require('express-async-handler');
const Order = require('../models/Order');
const Payment = require('../models/Payment');
const { sendOrderEmails } = require('./orderController');
const safeSendEmail = require('../utils/safeSendEmail');
const getAdminEmails = require('../utils/getAdminEmails');
const { paymentDecisionTemplate, stkPaymentReceivedAdminTemplate } = require('../utils/emailTemplates');
const { initiateStkPush: callPayHeroInitiate } = require('../utils/payhero');

// @desc    Buyer triggers an M-Pesa STK Push prompt for an order they already created
// @route   POST /api/payments/initiate-stk
// @access  Private (buyer)
const initiateStkPush = asyncHandler(async (req, res) => {
  const { orderId, phone } = req.body;

  if (!orderId || !phone) {
    res.status(400);
    throw new Error('orderId and phone are required');
  }
  if (!/^0\d{9}$/.test(phone) && !/^254(7|1)\d{8}$/.test(phone)) {
    res.status(400);
    throw new Error('Enter a valid Safaricom number, e.g. 0712345678');
  }

  const order = await Order.findById(orderId);
  if (!order) {
    res.status(404);
    throw new Error('Order not found');
  }
  if (order.buyer.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error('Not authorized for this order');
  }
  if (order.paymentMethod !== 'stk') {
    res.status(400);
    throw new Error('This order was not set up for STK Push payment');
  }
  if (order.paymentStatus === 'confirmed') {
    res.status(400);
    throw new Error('This order has already been paid for');
  }

  // Normalize to 2547XXXXXXXX / 2541XXXXXXXX — the format PayHero expects.
  const normalizedPhone = phone.startsWith('0') ? `254${phone.slice(1)}` : phone;

  const callbackUrl = `${process.env.BACKEND_URL}/api/payments/callback`;

  let phResponse;
  try {
    phResponse = await callPayHeroInitiate({
      amount: Math.round(order.totalAmount),
      phone_number: normalizedPhone,
      channel_id: Number(process.env.PAYHERO_CHANNEL_ID),
      provider: 'm-pesa',
      external_reference: order.orderNumber,
      customer_name: req.user.name || 'Six Star Suppliers Buyer',
      callback_url: callbackUrl,
    });
  } catch (err) {
    console.error('PayHero initiate STK error:', err.message);
    res.status(502);
    throw new Error('Could not reach M-Pesa right now. Please try again, or pay manually instead.');
  }

  if (!phResponse || phResponse.success !== true) {
    res.status(502);
    throw new Error(phResponse?.error_message || 'M-Pesa did not accept this request. Please try again.');
  }

  const payment = await Payment.create({
    order: order._id,
    buyer: req.user._id,
    amount: order.totalAmount,
    phone: normalizedPhone,
    externalReference: order.orderNumber,
    payheroReference: phResponse.reference || '',
    checkoutRequestId: phResponse.CheckoutRequestID || '',
    status: 'queued',
    rawInitiateResponse: phResponse,
  });

  order.stk = {
    reference: payment.payheroReference,
    checkoutRequestId: payment.checkoutRequestId,
    status: 'queued',
    phone: normalizedPhone,
    lastAttemptAt: new Date(),
  };
  await order.save();

  res.json({
    success: true,
    message: 'Check your phone and enter your M-Pesa PIN to complete payment.',
    paymentId: payment._id,
    reference: payment.payheroReference,
  });
});

// @desc    PayHero webhook — fired automatically once the customer enters (or
//          cancels) their M-Pesa PIN. This is what actually confirms the order.
// @route   POST /api/payments/callback
// @access  Public (server-to-server — PayHero cannot send your app's auth cookie)
const handleCallback = asyncHandler(async (req, res) => {
  // Acknowledge immediately — PayHero doesn't need us to finish processing
  // first, and a slow/failed ack just triggers pointless retries.
  res.status(200).json({ received: true });

  try {
    const body = req.body || {};
    const result = body.response || body; // tolerate either shape
    const {
      CheckoutRequestID,
      MerchantRequestID,
      ExternalReference,
      MpesaReceiptNumber,
      ResultCode,
      ResultDesc,
    } = result;

    if (!CheckoutRequestID && !ExternalReference) {
      console.error('PayHero callback missing identifiers:', body);
      return;
    }

    const payment = await Payment.findOne(
      CheckoutRequestID ? { checkoutRequestId: CheckoutRequestID } : { externalReference: ExternalReference }
    ).sort('-createdAt');

    if (!payment) {
      console.error('PayHero callback: no matching Payment for', CheckoutRequestID, ExternalReference);
      return;
    }

    // Idempotency — PayHero can retry a callback; never double-process a
    // payment that's already been settled.
    if (payment.status !== 'queued') return;

    payment.rawCallbackPayload = body;
    payment.resultCode = typeof ResultCode === 'number' ? ResultCode : Number(ResultCode);
    payment.resultDesc = ResultDesc || '';
    payment.merchantRequestId = MerchantRequestID || payment.merchantRequestId;
    payment.mpesaReceiptNumber = MpesaReceiptNumber || '';

    const succeeded = payment.resultCode === 0;
    payment.status = succeeded ? 'success' : 'failed';
    await payment.save();

    const order = await Order.findById(payment.order).populate('buyer', 'name email');
    if (!order) return;

    order.stk = {
      reference: order.stk?.reference || payment.payheroReference,
      checkoutRequestId: order.stk?.checkoutRequestId || payment.checkoutRequestId,
      status: payment.status,
      phone: order.stk?.phone || payment.phone,
      lastAttemptAt: order.stk?.lastAttemptAt || new Date(),
    };

    if (succeeded) {
      order.paymentStatus = 'confirmed';
      order.verifiedAt = new Date();
      order.mpesaCode = MpesaReceiptNumber || order.mpesaCode;
      order.mpesaMessage = order.mpesaMessage || `M-Pesa STK Push — Receipt ${MpesaReceiptNumber}`;
    } else {
      order.rejectionReason = ResultDesc || 'M-Pesa payment was not completed';
    }
    await order.save();

    if (succeeded && order.buyer?.email) {
      // NEW — this is the buyer "order confirmation" + seller "new order,
      // prepare for dispatch" emails that used to fire prematurely at order
      // CREATION time (see orderController.js's createOrder). For STK orders
      // they now fire HERE instead — only once payment is actually confirmed.
      // skipAdminVerificationAlert: true because the "needs verification"
      // admin email doesn't apply here — this order is already confirmed,
      // and the stkPaymentReceivedAdminTemplate email below covers admin
      // instead, with accurate "already paid" language.
      sendOrderEmails(order, order.buyer, { skipAdminVerificationAlert: true }).catch((err) =>
        console.error('STK order confirmation email dispatch failed:', err)
      );

      safeSendEmail(
        {
          to: order.buyer.email,
          subject: `Payment Confirmed - ${order.orderNumber}`,
          html: paymentDecisionTemplate({ order, buyerName: order.buyer.name, decision: 'confirmed' }),
          sender: 'info',
        },
        'STK payment confirmation (buyer)'
      );

      const adminEmails = await getAdminEmails();
      adminEmails.forEach((to) => {
        safeSendEmail(
          {
            to,
            subject: `M-Pesa Payment Received (Auto) - ${order.orderNumber}`,
            html: stkPaymentReceivedAdminTemplate({ order, buyerName: order.buyer.name }),
            sender: 'info',
          },
          'STK payment confirmation (admin)'
        );
      });
    }
    // Deliberately no email at all on failure/cancellation — the buyer is
    // still on the checkout page and sees it live via the status-polling
    // endpoint. Sellers and admin never hear about an order that was never
    // actually paid for.
  } catch (err) {
    console.error('PayHero callback processing error:', err);
  }
});

// @desc    Buyer polls this while the STK prompt is on their phone
// @route   GET /api/payments/status/:orderId
// @access  Private (buyer who owns the order, or admin)
const checkPaymentStatus = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.orderId);
  if (!order) {
    res.status(404);
    throw new Error('Order not found');
  }
  if (order.buyer.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    res.status(403);
    throw new Error('Not authorized');
  }

  res.json({
    success: true,
    paymentStatus: order.paymentStatus, // pending_verification | confirmed | rejected
    stkStatus: order.stk?.status || '', // '' | queued | success | failed
    orderNumber: order.orderNumber,
    orderId: order._id,
    rejectionReason: order.rejectionReason || '',
  });
});

module.exports = { initiateStkPush, handleCallback, checkPaymentStatus };