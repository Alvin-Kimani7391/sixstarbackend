const asyncHandler = require('express-async-handler');
const Order = require('../models/Order');
const Product = require('../models/Product');

// @desc    Buyer places an order and pastes their M-Pesa confirmation message
// @route   POST /api/orders
// @access  Private (buyer)
const createOrder = asyncHandler(async (req, res) => {
  const { items, shippingAddress, mpesaMessage } = req.body;

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

  const order = await Order.create({
    buyer: req.user._id,
    items: orderItems,
    totalAmount,
    shippingAddress,
    mpesaMessage,
    paymentStatus: 'pending_verification',
  });

  // Decrement stock immediately to prevent overselling while payment is being verified
  for (const item of items) {
    await Product.findByIdAndUpdate(item.productId, { $inc: { stock: -item.quantity } });
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

// @desc    Seller (wholesaler/retailer) views orders containing their own products
// @route   GET /api/orders/seller-orders
// @access  Private (wholesaler, retailer)
const getSellerOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ 'items.seller': req.user._id, paymentStatus: 'confirmed' }).sort(
    '-createdAt'
  );

  // Only surface this seller's own line items, not the whole cart
  const filtered = orders.map((order) => ({
    _id: order._id,
    orderStatus: order.orderStatus,
    createdAt: order.createdAt,
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

module.exports = { createOrder, getMyOrders, getOrderById, getSellerOrders, updateOrderStatus };
