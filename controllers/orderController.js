const asyncHandler = require('express-async-handler');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Agent = require('../models/Agent');

// @desc    Buyer places an order and pastes their M-Pesa confirmation message
// @route   POST /api/orders
// @access  Private (buyer)
const createOrder = asyncHandler(async (req, res) => {
  const { items, shippingAddress, mpesaMessage, agentCode } = req.body;

  if (!items || items.length === 0) {
    res.status(400);
    throw new Error('Order must contain at least one item');
  }
  if (!mpesaMessage || mpesaMessage.trim().length < 10) {
    res.status(400);
    throw new Error('Please paste your full M-Pesa confirmation message');
  }

  // Re-fetch each product server-side so buyers can never manipulate the price/stock from the client
  let totalAmount = 0;
  const orderItems = [];

  for (const item of items) {
    const product = await Product.findOne({ _id: item.productId, status: 'active', isActive: true });
    if (!product) {
      res.status(400);
      throw new Error(`Product ${item.productId} is not currently available`);
    }
    if (product.stock < item.quantity) {
      res.status(400);
      throw new Error(`Insufficient stock for ${product.name}`);
    }

    const price = product.displayPrice;
    totalAmount += price * item.quantity;

    orderItems.push({
      product: product._id,
      seller: product.seller,
      name: product.name,
      image: product.images[0],
      quantity: item.quantity,
      priceAtPurchase: price,
    });
  }

  // Optional: buyer picked an agent at checkout - validate the code and work out their commission
  let agentDoc = null;
  let commissionAmount = 0;

  if (agentCode && agentCode.trim()) {
    agentDoc = await Agent.findOne({ code: agentCode.trim().toUpperCase(), isActive: true });
    if (!agentDoc) {
      res.status(400);
      throw new Error('Invalid or inactive agent code');
    }
    commissionAmount = Math.round((totalAmount * agentDoc.commissionRate) / 100);
  }

  const order = await Order.create({
    buyer: req.user._id,
    items: orderItems,
    totalAmount,
    shippingAddress,
    mpesaMessage,
    paymentStatus: 'pending_verification',
    agent: agentDoc ? agentDoc._id : null,
    agentCode: agentDoc ? agentDoc.code : '',
    commissionAmount,
  });
  // order.orderNumber is set automatically by the pre('save') hook on the model

  // Decrement stock immediately to prevent overselling while payment is being verified
  for (const item of items) {
    await Product.findByIdAndUpdate(item.productId, { $inc: { stock: -item.quantity } });
  }

  // Credit the agent's running totals (commission is only "earned" once payment is confirmed in
  // practice, but we track it against the order now and admin verifies payment separately anyway)
  if (agentDoc) {
    await Agent.findByIdAndUpdate(agentDoc._id, {
      $inc: { totalOrders: 1, totalCommission: commissionAmount },
    });
  }

  res.status(201).json({
    success: true,
    message: 'Order placed. Your payment will be verified shortly.',
    order,
  });
});

// @desc    Buyer views their own order history
// @route   GET /api/orders/my-orders
// @access  Private (buyer)
const getMyOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ buyer: req.user._id }).sort('-createdAt');
  res.json({ success: true, count: orders.length, orders });
});

// @desc    Public order tracking by order ID + the phone number used at checkout
//          (no login required, mirrors a classic "track my order" page)
// @route   GET /api/orders/track?orderId=...&phone=...
// @access  Public
const trackOrderPublic = asyncHandler(async (req, res) => {
  const { orderId, phone } = req.query;

  if (!orderId || !phone) {
    res.status(400);
    throw new Error('Please provide both the order ID and the phone number used at checkout');
  }

  let order;
  try {
    order = await Order.findById(orderId.trim());
  } catch {
    order = null; // invalid ObjectId format
  }

  if (!order || order.shippingAddress?.phone !== phone.trim()) {
    res.status(404);
    throw new Error('No matching order found. Check your order ID and phone number.');
  }

  // Only return what a tracking page needs - never the buyer's full account data
  res.json({
    success: true,
    order: {
      id: order._id,
      orderNumber: order.orderNumber,
      items: order.items,
      totalAmount: order.totalAmount,
      paymentStatus: order.paymentStatus,
      orderStatus: order.orderStatus,
      rejectionReason: order.rejectionReason,
      createdAt: order.createdAt,
    },
  });
});

// @desc    Buyer views a single order of their own
// @route   GET /api/orders/:id
// @access  Private (buyer - owner only)
const getOrderById = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) {
    res.status(404);
    throw new Error('Order not found');
  }
  if (order.buyer.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    res.status(403);
    throw new Error('Not authorized to view this order');
  }
  res.json({ success: true, order });
});

// @desc    Seller (wholesaler/retailer) views orders containing their own products.
//          CHANGED: this used to only return orders once payment was confirmed, which
//          meant a seller never saw "someone just ordered this" in real time - they only
//          found out after the admin had verified M-Pesa, sometimes hours later. Sellers
//          now see the order the moment it's placed, with paymentStatus exposed so they
//          can tell confirmed sales from ones still awaiting verification.
// @route   GET /api/orders/seller-orders
// @access  Private (wholesaler, retailer)
const getSellerOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ 'items.seller': req.user._id })
    .populate('buyer', 'name phone')
    .sort('-createdAt');

  // Only surface this seller's own line items, not the whole cart
  const filtered = orders.map((order) => ({
    _id: order._id,
    orderNumber: order.orderNumber,
    orderStatus: order.orderStatus,
    paymentStatus: order.paymentStatus,
    createdAt: order.createdAt,
    buyer: order.buyer,
    shippingAddress: order.shippingAddress,
    items: order.items.filter((i) => i.seller.toString() === req.user._id.toString()),
  }));

  res.json({ success: true, count: filtered.length, orders: filtered });
});

// @desc    Seller/admin updates order fulfillment status
// @route   PATCH /api/orders/:id/status
// @access  Private (seller of an item in the order, or admin)
const updateOrderStatus = asyncHandler(async (req, res) => {
  const { orderStatus } = req.body;
  const validStatuses = ['processing', 'shipped', 'delivered', 'cancelled'];
  if (!validStatuses.includes(orderStatus)) {
    res.status(400);
    throw new Error('Invalid order status');
  }

  const order = await Order.findById(req.params.id);
  if (!order) {
    res.status(404);
    throw new Error('Order not found');
  }

  const isSellerOnOrder = order.items.some((i) => i.seller.toString() === req.user._id.toString());
  if (!isSellerOnOrder && req.user.role !== 'admin') {
    res.status(403);
    throw new Error('Not authorized to update this order');
  }

  order.orderStatus = orderStatus;
  await order.save();
  res.json({ success: true, order });
});

// @desc    Buyer (or admin) cancels an order that hasn't shipped yet
// @route   PATCH /api/orders/:id/cancel
// @access  Private (buyer who owns the order, or admin)
const cancelOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    res.status(404);
    throw new Error('Order not found');
  }

  // Check if the logged-in user owns this order (buyer) or is admin
  if (order.buyer.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    res.status(403);
    throw new Error('Not authorized to cancel this order');
  }

  // Check if order can be cancelled
  // An order can only be cancelled if it's still processing and payment hasn't been confirmed
  if (order.paymentStatus === 'confirmed' && order.orderStatus !== 'processing') {
    res.status(400);
    throw new Error(`Order cannot be cancelled - it has already been ${order.orderStatus}`);
  }

  // If payment is confirmed and order is shipped or delivered, cannot cancel
  if (order.orderStatus === 'shipped' || order.orderStatus === 'delivered') {
    res.status(400);
    throw new Error(`Order cannot be cancelled - it has already been ${order.orderStatus}`);
  }

  // Update order status to cancelled
  order.orderStatus = 'cancelled';
  await order.save();

  // Optionally restore product stock since we decremented it during order creation
  for (const item of order.items) {
    await Product.findByIdAndUpdate(
      item.product,
      { $inc: { stock: item.quantity } }
    );
  }

  res.json({
    success: true,
    message: 'Order cancelled successfully',
    order
  });
});


module.exports = { createOrder, getMyOrders, trackOrderPublic, getOrderById, getSellerOrders, updateOrderStatus, cancelOrder };