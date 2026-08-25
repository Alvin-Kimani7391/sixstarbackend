const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');
const Order = require('../models/Order');
const Product = require('../models/Product');
const ProductVariant = require('../models/ProductVariant');
const Agent = require('../models/Agent');
const FlashSale = require('../models/FlashSale');
const { User } = require('../models/User');
const safeSendEmail = require('../utils/safeSendEmail');
const getAdminEmails = require('../utils/getAdminEmails');
const {
  orderConfirmationTemplate,
  newOrderSellerTemplate,
  newOrderAdminTemplate,
  orderStatusUpdateTemplate,
} = require('../utils/emailTemplates');
const { getCategoryAttributeDefs } = require('./categoryAttributeController');
const { resolveCategoryCommissionRate } = require('./categoryController');

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
//
// FIX: this used to ignore product.deliveryType entirely, so a wholesaler's
// 'simple' (light) product — meant to ship exactly like a retail item via the
// buyer's regional Transport fee — silently got 0 delivery fee from BOTH this
// function AND the regional transportFee (because it was never counted as a
// "retail-like" item below), meaning it shipped with no delivery charge at all.
function computeWholesaleDeliveryForItem(product, qty) {
  if (product.sellerRole !== 'wholesaler') return { fee: 0, note: '' };
  if (product.deliveryType === 'simple') return { fee: 0, note: '' }; // handled via regional transportFee instead
  if (product.freeDelivery) return { fee: 0, note: '' };
  const dc = product.deliveryCharge || {};
  if (dc.chargeType === 'fixed') return { fee: Number(dc.amount) || 0, note: '' };
  if (dc.chargeType === 'quantity_based') return { fee: (Number(dc.perUnitAmount) || 0) * qty, note: '' };
  return { fee: 0, note: dc.notes || 'Delivery terms to be agreed directly with the seller' };
}

// Whether a product needs a courier-visible delivery address, i.e. the seller
// negotiates delivery directly rather than it riding a fixed courier fee.
function isNegotiatedDelivery(product) {
  return (
    product.sellerRole === 'wholesaler' &&
    product.deliveryType === 'heavy' &&
    !product.freeDelivery &&
    product.deliveryCharge?.chargeType === 'negotiated'
  );
}

// Resolves the marketplace commission for a single unit at the given unit
// price, using the product's category commission chain (own rate, inherited
// from an ancestor category, or the platform default). Returns per-unit
// figures — callers multiply by quantity themselves so rounding happens
// consistently against the line total rather than accumulating per-unit
// rounding error across large quantities.
async function resolveLineCommission(categoryId, unitPrice) {
  const { rate } = await resolveCategoryCommissionRate(categoryId);
  const commissionAmountPerUnit = Math.round(unitPrice * (rate / 100));
  const sellerPayoutPerUnit = unitPrice - commissionAmountPerUnit;
  return { rate, commissionAmountPerUnit, sellerPayoutPerUnit };
}

// @desc    Buyer places an order and pastes their M-Pesa confirmation message
// @route   POST /api/orders
// @access  Private (buyer)
// @desc    Buyer places an order and pastes their M-Pesa confirmation message
// @route   POST /api/orders
// @access  Private (buyer)
const createOrder = asyncHandler(async (req, res) => {
  const { items, shippingAddress, mpesaMessage, agentCode, transportFee, paymentMethod } = req.body;
const method = paymentMethod === 'stk' ? 'stk' : 'manual';

if (!items || items.length === 0) {
  res.status(400);
  throw new Error('Order must contain at least one item');
}
// Manual payment still requires the pasted M-Pesa SMS up front. STK orders
// are created "unpaid" — payment is initiated separately via
// POST /api/payments/initiate-stk right after this order exists.
if (method === 'manual' && (!mpesaMessage || mpesaMessage.trim().length < 10)) {
  res.status(400);
  throw new Error('Please paste your full M-Pesa confirmation message');
}
  // ---------------- PASS 1: validate everything, mutate nothing ----------------
  let itemsTotal = 0;
  let wholesaleDeliveryTotal = 0;
  let hasRetailItem = false;
  let hasNegotiatedItem = false;
  const deliveryNotes = [];
  const prepared = []; // { product, variantDoc, quantity, unitPrice, sellerUnitPrice, deliveryFee, flashSale?, commissionRate, commissionAmountUnit, sellerPayoutUnit }

  for (const reqItem of items) {
    const product = await Product.findOne({ _id: reqItem.productId, status: 'active', isActive: true });
    if (!product) {
      res.status(400);
      throw new Error(`Product ${reqItem.productId} is not currently available`);
    }

    const quantity = Math.max(1, Number(reqItem.quantity) || 1);

    // ============================================================
    // FLASH SALE LINE — its price and stock pool come from the FlashSale
    // document, not the product's regular sellerPrice/pricingTiers/stock.
    // Everything is re-derived server-side here — the client only ever
    // supplies which flashSaleId it wants, never a price.
    // ============================================================
    if (reqItem.flashSaleId) {
      const flashSale = await FlashSale.findById(reqItem.flashSaleId);
      if (!flashSale || flashSale.product.toString() !== product._id.toString()) {
        res.status(400);
        throw new Error(`Flash Sale for "${product.name}" is no longer available`);
      }

      const now = new Date();
      const isLive =
        ['scheduled', 'active'].includes(flashSale.status) &&
        flashSale.startAt <= now &&
        flashSale.endAt >= now;
      if (!isLive) {
        res.status(400);
        throw new Error(`The Flash Sale for "${product.name}" has ended or hasn't started yet`);
      }

      const remaining = flashSale.stockAllocated - flashSale.stockSold;
      if (remaining < quantity) {
        res.status(400);
        throw new Error(
          `Only ${remaining} unit(s) left in the "${product.name}" Flash Sale — please reduce the quantity`
        );
      }

      // Belt-and-braces: the Flash Sale allocation is drawn from the product's
      // real stock, so it can never sell more than the product actually has on
      // hand right now (covers cases where stock dropped after allocation, e.g.
      // a manual admin adjustment or a race with another order).
      if (product.stock < quantity) {
        res.status(400);
        throw new Error(`Insufficient stock for "${product.name}"`);
      }

      // Flash Sale items are treated as standard (retail-style) delivery,
      // regardless of the underlying seller's usual wholesale terms — the
      // Flash Sale model doesn't carry its own delivery-charge config.
      hasRetailItem = true;

      const unitPrice = flashSale.flashSalePrice;
      itemsTotal += unitPrice * quantity;

      // Marketplace commission still applies to Flash Sale lines, resolved off
      // the product's own category exactly like a normal line — the discount
      // just means it's computed against the lower Flash Sale price.
      const { rate: fsCommissionRate, commissionAmountPerUnit: fsCommissionAmountUnit, sellerPayoutPerUnit: fsSellerPayoutUnit } =
        await resolveLineCommission(product.category, unitPrice);

      prepared.push({
        product,
        variantDoc: null,
        quantity,
        unitPrice,
        sellerUnitPrice: unitPrice, // no separate admin markup modeled for Flash Sale pricing
        deliveryFee: 0,
        flashSale,
        commissionRate: fsCommissionRate,
        commissionAmountUnit: fsCommissionAmountUnit,
        sellerPayoutUnit: fsSellerPayoutUnit,
      });

      continue; // skip all the regular-product pricing/variant/stock logic below
    }

    // --- Wholesale MOQ, enforced here regardless of what the client sent ---
    if (product.sellerRole === 'wholesaler') {
      const moq = product.minOrderQuantity || 1;
      if (quantity < moq) {
        res.status(400);
        throw new Error(`"${product.name}" requires a minimum order of ${moq} units`);
      }
      if (product.deliveryType === 'simple') {
        hasRetailItem = true;
      }
    } else {
      hasRetailItem = true;
    }

    if (isNegotiatedDelivery(product)) {
      hasNegotiatedItem = true;
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

    const basePrice = product.displayPrice;
    if (basePrice == null) {
      res.status(400);
      throw new Error(`"${product.name}" is not yet priced and cannot be purchased`);
    }
    const unitPrice = resolveUnitPrice(basePrice, product.pricingTiers, quantity) + (variantDoc?.priceAdjustment || 0);
    itemsTotal += unitPrice * quantity;

    const sellerUnitPrice = (product.sellerPrice || 0) + (variantDoc?.priceAdjustment || 0);

    const { fee, note } = computeWholesaleDeliveryForItem(product, quantity);
    wholesaleDeliveryTotal += fee;
    if (note) deliveryNotes.push(`${product.name}: ${note}`);

    // Marketplace commission — resolved from this product's category chain
    // (own rate, inherited from an ancestor, or the platform default) and
    // computed against the buyer-facing unit price actually charged.
    const { rate: commissionRate, commissionAmountPerUnit: commissionAmountUnit, sellerPayoutPerUnit: sellerPayoutUnit } =
      await resolveLineCommission(product.category, unitPrice);

    prepared.push({
      product,
      variantDoc,
      quantity,
      unitPrice,
      sellerUnitPrice,
      deliveryFee: fee,
      commissionRate,
      commissionAmountUnit,
      sellerPayoutUnit,
    });
  }

  if (hasNegotiatedItem) {
    const addressDetail = (shippingAddress?.notes || shippingAddress?.address || '').trim();
    if (addressDetail.length < 8) {
      res.status(400);
      throw new Error(
        'One or more items in your order require delivery to be arranged directly with the seller. Please provide a delivery address or landmark.'
      );
    }
  }

  // ---------------- PASS 2: everything validated — now commit stock + build order ----------------
  const orderItems = prepared.map(
    ({
      product,
      variantDoc,
      quantity,
      unitPrice,
      sellerUnitPrice,
      deliveryFee,
      flashSale,
      commissionRate,
      commissionAmountUnit,
      sellerPayoutUnit,
    }) => ({
      product: product._id,
      variant: variantDoc ? variantDoc._id : null,
      variantLabel: variantDoc ? variantDoc.combination.map((c) => c.value).join(' / ') : '',
      seller: product.seller,
      sellerRole: product.sellerRole,
      name: product.name,
      // Snapshot the FULL absolute Cloudinary URL at time of purchase. If
      // product.images ever ends up empty for a line (deleted image, race
      // condition, etc.), this stays '' and orderItemsTable() in
      // emailTemplates.js falls back to a themed placeholder instead of a
      // broken-image icon.
      image: product.images && product.images[0] ? product.images[0] : '',
      quantity,
      priceAtPurchase: unitPrice,
      sellerPriceAtPurchase: sellerUnitPrice,
      deliveryFee,
      isFlashDeal: !!flashSale,
      flashSale: flashSale ? flashSale._id : null,
      // Marketplace commission snapshot — see the field comments on
      // orderItemSchema in models/Order.js for why these are stored rather
      // than resolved live on every read.
      commissionRate,
      commissionAmount: commissionAmountUnit * quantity,
      sellerPayout: sellerPayoutUnit * quantity,
    })
  );

  for (const { product, variantDoc, quantity, flashSale } of prepared) {
    if (flashSale) {
      // Flash Sale stock is its own pool — deplete it and flip to sold_out the
      // instant it runs dry, same as recordFlashSaleSale() does, but against
      // the exact FlashSale doc we already validated above (avoids re-querying
      // "the active one for this product", which matters if a product ever
      // has more than one historical Flash Sale entry).
      const updated = await FlashSale.findByIdAndUpdate(
        flashSale._id,
        { $inc: { stockSold: quantity } },
        { new: true }
      );
      if (updated && updated.stockSold >= updated.stockAllocated) {
        updated.status = 'sold_out';
        await updated.save();
      }

      // FIX: Flash Sale units are still real inventory drawn from the same
      // product — this used to skip the Product.stock decrement entirely
      // ("continue" below, with no decrement), which meant a buyer could keep
      // purchasing the product at its regular price/listing for the full
      // original stock count on top of whatever sold via the Flash Sale, and
      // seller/admin dashboards (which read Product.stock, not FlashSale.stockSold)
      // never reflected Flash Sale sales at all. Keep it in sync, same as a
      // normal line. (Flash Sale items don't support variants yet, so no
      // variant-level decrement here.)
      await Product.findByIdAndUpdate(product._id, { $inc: { stock: -quantity } });
      continue; // no separate variant stock decrement for Flash Sale lines
    }

    if (variantDoc) {
      await ProductVariant.findByIdAndUpdate(variantDoc._id, { $inc: { stock: -quantity } });
    }
    await Product.findByIdAndUpdate(product._id, { $inc: { stock: -quantity } });
  }

  const retailTransportFee = hasRetailItem ? Math.max(0, Number(transportFee) || 0) : 0;
  const deliveryFeeTotal = retailTransportFee + wholesaleDeliveryTotal;
  const totalAmount = itemsTotal + deliveryFeeTotal;

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
    paymentMethod: method,                                   // NEW
  mpesaMessage: method === 'manual' ? mpesaMessage : '',    // NEW
    deliveryFee: deliveryFeeTotal,
    deliveryDetails: {
      transportFee: retailTransportFee,
      wholesaleDeliveryFee: wholesaleDeliveryTotal,
      notes: deliveryNotes,
    },
    shippingAddress,
    
    paymentStatus: 'pending_verification',
    agent: agentDoc ? agentDoc._id : null,
    agentCode: agentDoc ? agentDoc.code : '',
    commissionAmount,
  });

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

  sendOrderEmails(order, req.user).catch((err) =>
    console.error('createOrder email dispatch failed:', err)
  );
});

async function sendOrderEmails(order, buyer) {
  // Every order email below uses sender: 'info' — order confirmations,
  // seller notifications, and admin alerts are review/status notifications,
  // not OTP/account-security codes.

  // 1) Buyer confirmation
  safeSendEmail(
    {
      to: buyer.email,
      subject: `Order Confirmation - ${order.orderNumber}`,
      html: orderConfirmationTemplate({ order, buyerName: buyer.name }),
      sender: 'info',
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
        sender: 'info',
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
        sender: 'info',
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

// ===================================================================
// @desc    Seller's own earnings dashboard — total sales, marketplace
//          commission taken, net payout, a 30-day trend, and top/least
//          selling products. Mirrors the admin order-detail commission
//          math (see orderItemSchema in models/Order.js) but scoped to
//          just this seller's own line items and aggregated server-side
//          so the dashboard stays fast even with a large order history.
//
//          Only lines from orders whose payment is 'confirmed' AND whose
//          orderStatus isn't 'cancelled' count toward the seller's real
//          earnings — a pending M-Pesa confirmation or a cancelled order
//          was never actually money in hand. Those are surfaced
//          separately as "pending" figures so sellers can still see
//          what's in the pipeline without it being double-counted as
//          confirmed income.
// @route   GET /api/orders/my-earnings
// @access  Private (wholesaler, retailer)
// ===================================================================
const getMyEarnings = asyncHandler(async (req, res) => {
  const sellerId = new mongoose.Types.ObjectId(req.user._id);

  // 30-day window (including today) for the daily trend chart.
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - 29);

  const pipeline = [
    // Cheap pre-filter on the indexed top-level array field before unwinding,
    // so we're not unwinding every order in the collection.
    { $match: { 'items.seller': sellerId } },
    { $unwind: '$items' },
    { $match: { 'items.seller': sellerId } },
    {
      $addFields: {
        lineRevenue: { $multiply: ['$items.priceAtPurchase', '$items.quantity'] },
        isConfirmed: {
          $and: [{ $eq: ['$paymentStatus', 'confirmed'] }, { $ne: ['$orderStatus', 'cancelled'] }],
        },
        isPending: { $eq: ['$paymentStatus', 'pending_verification'] },
      },
    },
    {
      $facet: {
        // ---- Confirmed, real earnings ----
        totals: [
          { $match: { isConfirmed: true } },
          {
            $group: {
              _id: null,
              totalRevenue: { $sum: '$lineRevenue' },
              totalCommission: { $sum: '$items.commissionAmount' },
              totalPayout: { $sum: '$items.sellerPayout' },
              totalUnitsSold: { $sum: '$items.quantity' },
              orderIds: { $addToSet: '$_id' },
            },
          },
        ],
        // ---- Still awaiting M-Pesa confirmation — shown separately, never
        // folded into the confirmed totals above ----
        pending: [
          { $match: { isPending: true } },
          {
            $group: {
              _id: null,
              pendingRevenue: { $sum: '$lineRevenue' },
              pendingPayout: { $sum: '$items.sellerPayout' },
              orderIds: { $addToSet: '$_id' },
            },
          },
        ],
        // ---- Per-product breakdown (confirmed sales only), used for both
        // the top-sellers and least-sellers lists on the frontend ----
        byProduct: [
          { $match: { isConfirmed: true } },
          {
            $group: {
              _id: '$items.product',
              name: { $first: '$items.name' },
              image: { $first: '$items.image' },
              unitsSold: { $sum: '$items.quantity' },
              revenue: { $sum: '$lineRevenue' },
              commission: { $sum: '$items.commissionAmount' },
              payout: { $sum: '$items.sellerPayout' },
            },
          },
          { $sort: { unitsSold: -1 } },
        ],
        // ---- Daily trend, last 30 days (confirmed sales only) ----
        dailyTrend: [
          { $match: { isConfirmed: true, createdAt: { $gte: since } } },
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
              revenue: { $sum: '$lineRevenue' },
              payout: { $sum: '$items.sellerPayout' },
            },
          },
        ],
      },
    },
  ];

  const [result] = await Order.aggregate(pipeline);

  const totals = (result?.totals || [])[0] || {
    totalRevenue: 0,
    totalCommission: 0,
    totalPayout: 0,
    totalUnitsSold: 0,
    orderIds: [],
  };
  const pending = (result?.pending || [])[0] || {
    pendingRevenue: 0,
    pendingPayout: 0,
    orderIds: [],
  };
  const byProduct = result?.byProduct || [];

  const topProducts = byProduct.slice(0, 5);
  // Least-selling, but still genuinely selling — an unsold product isn't
  // "underperforming," it's just never been ordered, so it has no place on
  // a "least sold" list built from actual sales.
  const leastProducts = [...byProduct].sort((a, b) => a.unitsSold - b.unitsSold).slice(0, 5);

  // Zero-filled 30-day trend so the frontend can draw a continuous chart
  // even on days with no sales at all.
  const trendMap = new Map((result?.dailyTrend || []).map((d) => [d._id, d]));
  const dailyTrend = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const row = trendMap.get(key);
    dailyTrend.push({ date: key, revenue: row ? row.revenue : 0, payout: row ? row.payout : 0 });
  }

  const confirmedOrderCount = (totals.orderIds || []).length;

  res.json({
    success: true,
    totalRevenue: totals.totalRevenue || 0,
    totalCommission: totals.totalCommission || 0,
    totalPayout: totals.totalPayout || 0,
    totalUnitsSold: totals.totalUnitsSold || 0,
    confirmedOrderCount,
    averageOrderValue: confirmedOrderCount ? Math.round((totals.totalPayout || 0) / confirmedOrderCount) : 0,
    // Effective commission rate across everything sold, handy for a single
    // "you're paying about X% on average" headline figure.
    effectiveCommissionRate:
      totals.totalRevenue > 0 ? Math.round(((totals.totalCommission || 0) / totals.totalRevenue) * 1000) / 10 : 0,
    pendingRevenue: pending.pendingRevenue || 0,
    pendingPayout: pending.pendingPayout || 0,
    pendingOrderCount: (pending.orderIds || []).length,
    topProducts,
    leastProducts,
    dailyTrend,
  });
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
        sender: 'info',
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
  //
  // FIX: Flash Sale lines now also release their FlashSale.stockSold allocation.
  // Previously a Flash Sale purchase never decremented Product.stock (see the
  // createOrder fix above) but this loop unconditionally restored it anyway —
  // meaning cancelling a Flash Sale order used to ADD phantom stock that was
  // never actually subtracted, AND left the Flash Sale's stockSold permanently
  // "used up" (possibly stuck at sold_out) even though the units were never
  // delivered. Now that Product.stock is correctly decremented on purchase,
  // restoring it here is correct — and we also give the FlashSale its
  // allocation back so those units are buyable again.
  for (const item of order.items) {
    await Product.findByIdAndUpdate(item.product, { $inc: { stock: item.quantity } });
    if (item.variant) {
      await ProductVariant.findByIdAndUpdate(item.variant, { $inc: { stock: item.quantity } });
    }

    if (item.isFlashDeal && item.flashSale) {
      const restored = await FlashSale.findByIdAndUpdate(
        item.flashSale,
        { $inc: { stockSold: -item.quantity } },
        { new: true }
      );
      // If releasing this allocation pulls it back under capacity, and the
      // scheduler had already marked it 'sold_out', flip it back to whatever
      // its time-based status should actually be right now so it becomes
      // buyable again instead of staying stuck at sold_out.
      if (restored && restored.status === 'sold_out' && restored.stockSold < restored.stockAllocated) {
        const now = new Date();
        restored.status =
          restored.endAt < now ? 'ended' : restored.startAt <= now ? 'active' : 'scheduled';
        await restored.save();
      }
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
        sender: 'info',
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
  getMyEarnings,
  updateOrderStatus,
  cancelOrder,
  getAdminEmails,
};