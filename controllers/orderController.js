const asyncHandler = require('express-async-handler');
const Order = require('../models/Order');
const Product = require('../models/Product');
const ProductVariant = require('../models/ProductVariant');
const Agent = require('../models/Agent');
const { User } = require('../models/User');
const sendEmail = require('../utils/sendEmail');
const {
  orderConfirmationTemplate,
  newOrderSellerTemplate,
  newOrderAdminTemplate,
  orderStatusUpdateTemplate,
} = require('../utils/emailTemplates');
const { getCategoryAttributeDefs } = require('./categoryAttributeController');

// Mirrors SS_CART.resolveUnitPrice on the frontend, but this is the copy that
// actually decides what gets charged — the client-side one is just a preview.
function resolveUnitPrice(basePrice, pricingTiers, qty) {
  if (!Array.isArray(pricingTiers) || pricingTiers.length === 0) return basePrice;
  const sorted = [...pricingTiers].sort((a, b) => a.minQty - b.minQty);
  let price = basePrice;
  for (const tier of sorted) {
    if (qty >= tier.minQty) price = tier.price;
  }
  return price;
}

// Wholesale delivery cost for one line, computed straight from the product's own
// deliveryCharge terms (set by the seller) — never from anything the buyer sends.
function computeWholesaleDeliveryForItem(product, qty) {
  if (product.sellerRole !== 'wholesaler') return { fee: 0, note: '' };
  if (product.freeDelivery) return { fee: 0, note: '' };
  const dc = product.deliveryCharge || {};
  if (dc.chargeType === 'fixed') return { fee: Number(dc.amount) || 0, note: '' };
  if (dc.chargeType === 'quantity_based') return { fee: (Number(dc.perUnitAmount) || 0) * qty, note: '' };
  return { fee: 0, note: dc.notes || 'Delivery terms to be agreed directly with the seller' };
}

// Best-effort admin recipient list: explicit env override first, otherwise every
// user with role "admin". A logging failure here should never break checkout.
async function getAdminEmails() {
  if (process.env.ADMIN_EMAILS) {
    return process.env.ADMIN_EMAILS.split(',').map((s) => s.trim()).filter(Boolean);
  }
  const admins = await User.find({ role: 'admin' }).select('email');
  return admins.map((a) => a.email).filter(Boolean);
}

// Fire-and-forget wrapper so a SendGrid hiccup never fails the HTTP response.
function safeSendEmail(opts, label) {
  sendEmail(opts).catch((err) => console.error(`${label} email failed:`, err.response?.body || err.message));
}

// @desc    Buyer places an order and pastes their M-Pesa confirmation message
// @route   POST /api/orders
// @access  Private (buyer)
const createOrder = asyncHandler(async (req, res) => {
  const { items, shippingAddress, mpesaMessage, agentCode, transportFee } = req.body;

  if (!items || items.length === 0) {
    res.status(400);
    throw new Error('Order must contain at least one item');
  }
  if (!mpesaMessage || mpesaMessage.trim().length < 10) {
    res.status(400);
    throw new Error('Please paste your full M-Pesa confirmation message');
  }

  // ---------------- PASS 1: validate everything, mutate nothing ----------------
  // If item #4 fails validation we don't want items #1-3's stock already decremented.
  let itemsTotal = 0;
  let wholesaleDeliveryTotal = 0;
  let hasRetailItem = false;
  const deliveryNotes = [];
  const prepared = []; // { product, variantDoc, quantity, unitPrice, sellerUnitPrice, deliveryFee }

  for (const reqItem of items) {
    const product = await Product.findOne({ _id: reqItem.productId, status: 'active', isActive: true });
    if (!product) {
      res.status(400);
      throw new Error(`Product ${reqItem.productId} is not currently available`);
    }

    const quantity = Math.max(1, Number(reqItem.quantity) || 1);

    // --- Wholesale MOQ, enforced here regardless of what the client sent ---
    if (product.sellerRole === 'wholesaler') {
      const moq = product.minOrderQuantity || 1;
      if (quantity < moq) {
        res.status(400);
        throw new Error(`"${product.name}" requires a minimum order of ${moq} units`);
      }
    } else {
      hasRetailItem = true;
    }

    // --- Does this product's category require a variant selection (e.g. Color/Size)? ---
    const attrDefs = await getCategoryAttributeDefs(product.category);
    const variantAttrDefs = attrDefs.filter((d) => d.isVariantAttribute);
    const requiresVariant = variantAttrDefs.length > 0;

    let variantDoc = null;
    if (requiresVariant) {
      if (!reqItem.variantId) {
        res.status(400);
        throw new Error(
          `Please select ${variantAttrDefs.map((d) => d.name).join(' / ')} for "${product.name}"`
        );
      }
      variantDoc = await ProductVariant.findOne({
        _id: reqItem.variantId,
        product: product._id,
        isActive: true,
      });
      if (!variantDoc) {
        res.status(400);
        throw new Error(`Selected option for "${product.name}" is no longer available`);
      }
      if (variantDoc.stock < quantity) {
        res.status(400);
        throw new Error(
          `Insufficient stock for "${product.name}" (${variantDoc.combination.map((c) => c.value).join(' / ')})`
        );
      }
    } else if (product.stock < quantity) {
      res.status(400);
      throw new Error(`Insufficient stock for ${product.name}`);
    }

    // --- Buyer-facing price: server-computed and tier-aware, never trust a client-submitted price ---
    const basePrice = product.displayPrice;
    if (basePrice == null) {
      res.status(400);
      throw new Error(`"${product.name}" is not yet priced and cannot be purchased`);
    }
    const unitPrice = resolveUnitPrice(basePrice, product.pricingTiers, quantity) + (variantDoc?.priceAdjustment || 0);
    itemsTotal += unitPrice * quantity;

    // --- Seller's own price snapshot (what the seller sees in their dashboard),
    // independent of admin markup/discount. Locked in at purchase time so it
    // never drifts if the seller later edits the product. ---
    const sellerUnitPrice = (product.sellerPrice || 0) + (variantDoc?.priceAdjustment || 0);

    // --- Wholesale delivery, computed from the seller's own terms on the product ---
    const { fee, note } = computeWholesaleDeliveryForItem(product, quantity);
    wholesaleDeliveryTotal += fee;
    if (note) deliveryNotes.push(`${product.name}: ${note}`);

    prepared.push({ product, variantDoc, quantity, unitPrice, sellerUnitPrice, deliveryFee: fee });
  }

  // ---------------- PASS 2: everything validated — now commit stock + build order ----------------
  const orderItems = prepared.map(({ product, variantDoc, quantity, unitPrice, sellerUnitPrice, deliveryFee }) => ({
    product: product._id,
    variant: variantDoc ? variantDoc._id : null,
    variantLabel: variantDoc ? variantDoc.combination.map((c) => c.value).join(' / ') : '',
    seller: product.seller,
    sellerRole: product.sellerRole,
    name: product.name,
    image: product.images[0],
    quantity,
    priceAtPurchase: unitPrice,
    sellerPriceAtPurchase: sellerUnitPrice,
    deliveryFee,
  }));

  for (const { product, variantDoc, quantity } of prepared) {
    if (variantDoc) {
      await ProductVariant.findByIdAndUpdate(variantDoc._id, { $inc: { stock: -quantity } });
    }
    await Product.findByIdAndUpdate(product._id, { $inc: { stock: -quantity } });
  }

  // --- Retail transport (region/town) — no server-side rate table yet, so this
  // stays client-supplied like shippingAddress, just sanity-clamped to >= 0.
  // Wholesale delivery above is fully server-computed and authoritative. ---
  const retailTransportFee = hasRetailItem ? Math.max(0, Number(transportFee) || 0) : 0;
  const deliveryFeeTotal = retailTransportFee + wholesaleDeliveryTotal;
  const totalAmount = itemsTotal + deliveryFeeTotal;

  // --- Optional agent commission ---
  let agentDoc = null;
  let commissionAmount = 0;
  if (agentCode && agentCode.trim()) {
    agentDoc = await Agent.findOne({ code: agentCode.trim().toUpperCase(), isActive: true });
    if (!agentDoc) {
      res.status(400);
      throw new Error('Invalid or inactive agent code');
    }
    commissionAmount = Math.round((itemsTotal * agentDoc.commissionRate) / 100);
  }

  const order = await Order.create({
    buyer: req.user._id,
    items: orderItems,
    totalAmount,
    deliveryFee: deliveryFeeTotal,
    deliveryDetails: {
      transportFee: retailTransportFee,
      wholesaleDeliveryFee: wholesaleDeliveryTotal,
      notes: deliveryNotes,
    },
    shippingAddress,
    mpesaMessage,
    paymentStatus: 'pending_verification',
    agent: agentDoc ? agentDoc._id : null,
    agentCode: agentDoc ? agentDoc.code : '',
    commissionAmount,
  });
  // order.orderNumber is set automatically by the pre('save') hook on the model

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

  // ---------------- EMAILS (fire-and-forget, never block the response) ----------------
  sendOrderEmails(order, req.user).catch((err) =>
    console.error('createOrder email dispatch failed:', err)
  );
});

async function sendOrderEmails(order, buyer) {
  // 1) Buyer confirmation
  safeSendEmail(
    {
      to: buyer.email,
      subject: `Order Confirmation - ${order.orderNumber}`,
      html: orderConfirmationTemplate({ order, buyerName: buyer.name }),
    },
    'Buyer order confirmation'
  );

  // 2) One email per seller, containing only that seller's items
  const sellerIds = [...new Set(order.items.map((i) => i.seller.toString()))];
  const sellers = await User.find({ _id: { $in: sellerIds } }).select('name email');
  const sellerMap = new Map(sellers.map((s) => [s._id.toString(), s]));

  for (const sellerId of sellerIds) {
    const seller = sellerMap.get(sellerId);
    if (!seller || !seller.email) continue;
    const items = order.items.filter((i) => i.seller.toString() === sellerId);
    safeSendEmail(
      {
        to: seller.email,
        subject: `New Order - ${order.orderNumber}`,
        html: newOrderSellerTemplate({ order, sellerName: seller.name, items }),
      },
      'Seller new-order notification'
    );
  }

  // 3) Admin alert — payment needs verification
  const adminEmails = await getAdminEmails();
  adminEmails.forEach((to) => {
    safeSendEmail(
      {
        to,
        subject: `New Order Needs Payment Verification - ${order.orderNumber}`,
        html: newOrderAdminTemplate({ order, buyerName: buyer.name }),
      },
      'Admin new-order alert'
    );
  });
}

// @desc    Buyer views their own order history
// @route   GET /api/orders/my-orders
// @access  Private (buyer)
const getMyOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ buyer: req.user._id }).sort('-createdAt');
  res.json({ success: true, count: orders.length, orders });
});

// @desc    Public order tracking by order ID + the phone number used at checkout
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

  res.json({
    success: true,
    order: {
      id: order._id,
      orderNumber: order.orderNumber,
      items: order.items,
      totalAmount: order.totalAmount,
      deliveryFee: order.deliveryFee,
      deliveryDetails: order.deliveryDetails,
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
// @route   GET /api/orders/seller-orders
// @access  Private (wholesaler, retailer)
const getSellerOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ 'items.seller': req.user._id })
    .populate('buyer', 'name phone')
    .sort('-createdAt');

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

  const order = await Order.findById(req.params.id).populate('buyer', 'name email');
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

  if (order.buyer?.email) {
    safeSendEmail(
      {
        to: order.buyer.email,
        subject: `Order Update - ${order.orderNumber}`,
        html: orderStatusUpdateTemplate({ order, buyerName: order.buyer.name, status: orderStatus }),
      },
      'Order status update'
    );
  }
});

// @desc    Buyer (or admin) cancels an order that hasn't shipped yet
// @route   PATCH /api/orders/:id/cancel
// @access  Private (buyer who owns the order, or admin)
const cancelOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id).populate('buyer', 'name email');

  if (!order) {
    res.status(404);
    throw new Error('Order not found');
  }

  if (order.buyer._id.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    res.status(403);
    throw new Error('Not authorized to cancel this order');
  }

  if (order.paymentStatus === 'confirmed' && order.orderStatus !== 'processing') {
    res.status(400);
    throw new Error(`Order cannot be cancelled - it has already been ${order.orderStatus}`);
  }
  if (order.orderStatus === 'shipped' || order.orderStatus === 'delivered') {
    res.status(400);
    throw new Error(`Order cannot be cancelled - it has already been ${order.orderStatus}`);
  }

  order.orderStatus = 'cancelled';
  await order.save();

  // Restore stock — both the aggregate product stock and, if this line had a
  // variant, that variant's own stock (previously only product.stock was restored,
  // which would have silently drifted the variant totals out of sync).
  for (const item of order.items) {
    await Product.findByIdAndUpdate(item.product, { $inc: { stock: item.quantity } });
    if (item.variant) {
      await ProductVariant.findByIdAndUpdate(item.variant, { $inc: { stock: item.quantity } });
    }
  }

  res.json({
    success: true,
    message: 'Order cancelled successfully',
    order,
  });

  if (order.buyer?.email) {
    safeSendEmail(
      {
        to: order.buyer.email,
        subject: `Order Cancelled - ${order.orderNumber}`,
        html: orderStatusUpdateTemplate({ order, buyerName: order.buyer.name, status: 'cancelled' }),
      },
      'Order cancellation'
    );
  }
});

module.exports = {
  createOrder,
  getMyOrders,
  trackOrderPublic,
  getOrderById,
  getSellerOrders,
  updateOrderStatus,
  cancelOrder,
  getAdminEmails,
};