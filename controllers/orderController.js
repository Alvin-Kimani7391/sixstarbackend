const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');
const Order = require('../models/Order');
const Product = require('../models/Product');
const ProductVariant = require('../models/ProductVariant');
const Agent = require('../models/Agent');
const Commission = require('../models/Commission'); // NEW — agent commission now lives here, not order.commissionAmount
const FlashSale = require('../models/FlashSale');
const { User } = require('../models/User');
const safeSendEmail = require('../utils/safeSendEmail');
const getAdminEmails = require('../utils/getAdminEmails');
const commissionService = require('../services/commissionService'); // NEW — Phase 5 commission engine hooks
const { calculateDynamicShippingFee } = require('../utils/shippingFeeCalculator');
const {
  orderConfirmationTemplate,
  newOrderSellerTemplate,
  newOrderAdminTemplate,
  orderStatusUpdateTemplate,
} = require('../utils/emailTemplates');
const { getCategoryAttributeDefs } = require('./categoryAttributeController');
const { resolveCategoryCommissionRate } = require('./categoryController');
const { resolveTransactionFee } = require('./transactionFeeController');
const { checkAndSendStockReminder } = require('../utils/stockReminderService'); // NEW

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
  if (product.deliveryType === 'simple') return { fee: 0, note: '' };
  if (product.freeDelivery) return { fee: 0, note: '' };
  const dc = product.deliveryCharge || {};
  if (dc.chargeType === 'fixed') return { fee: Number(dc.amount) || 0, note: '' };
  if (dc.chargeType === 'quantity_based') return { fee: (Number(dc.perUnitAmount) || 0) * qty, note: '' };
  return { fee: 0, note: dc.notes || 'Delivery terms to be agreed directly with the seller' };
}

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
// from an ancestor category, or the platform default).
async function resolveLineCommission(categoryId, unitPrice) {
  const { rate } = await resolveCategoryCommissionRate(categoryId);
  const commissionAmountPerUnit = Math.round(unitPrice * (rate / 100));
  const sellerPayoutPerUnit = unitPrice - commissionAmountPerUnit;
  return { rate, commissionAmountPerUnit, sellerPayoutPerUnit };
}

// @desc    Buyer places an order
// @route   POST /api/orders
// @access  Private (buyer)
const createOrder = asyncHandler(async (req, res) => {
  const { items, shippingAddress, mpesaMessage, agentCode, transportFee, paymentMethod } = req.body;
  const method = paymentMethod === 'stk' ? 'stk' : 'manual';

  if (!items || items.length === 0) {
    res.status(400);
    throw new Error('Order must contain at least one item');
  }
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
  const prepared = [];

  for (const reqItem of items) {
    const product = await Product.findOne({ _id: reqItem.productId, status: 'active', isActive: true });
    if (!product) {
      res.status(400);
      throw new Error(`Product ${reqItem.productId} is not currently available`);
    }

    const quantity = Math.max(1, Number(reqItem.quantity) || 1);

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

      if (product.stock < quantity) {
        res.status(400);
        throw new Error(`Insufficient stock for "${product.name}"`);
      }

      hasRetailItem = true;

      const unitPrice = flashSale.flashSalePrice;
      itemsTotal += unitPrice * quantity;

      const { rate: fsCommissionRate, commissionAmountPerUnit: fsCommissionAmountUnit, sellerPayoutPerUnit: fsSellerPayoutUnit } =
        await resolveLineCommission(product.category, unitPrice);

      prepared.push({
        product,
        variantDoc: null,
        quantity,
        unitPrice,
        sellerUnitPrice: unitPrice,
        deliveryFee: 0,
        flashSale,
        commissionRate: fsCommissionRate,
        commissionAmountUnit: fsCommissionAmountUnit,
        sellerPayoutUnit: fsSellerPayoutUnit,
      });

      continue;
    }

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

  // ---------------- Seller transaction fees ----------------
  const sellerSubtotals = new Map();
  for (const { product, unitPrice, quantity } of prepared) {
    const sellerId = product.seller.toString();
    sellerSubtotals.set(sellerId, (sellerSubtotals.get(sellerId) || 0) + unitPrice * quantity);
  }

  const sellerFees = [];
  for (const [sellerId, subtotal] of sellerSubtotals.entries()) {
    const { fee, tier } = await resolveTransactionFee(subtotal);
    sellerFees.push({
      seller: sellerId,
      subtotal,
      transactionFee: fee,
      tier: tier
        ? { id: tier.id, amountFrom: tier.amountFrom, amountTo: tier.amountTo, label: tier.label }
        : { id: null, amountFrom: null, amountTo: null, label: '' },
    });
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
      image: product.images && product.images[0] ? product.images[0] : '',
      quantity,
      priceAtPurchase: unitPrice,
      sellerPriceAtPurchase: sellerUnitPrice,
      deliveryFee,
      isFlashDeal: !!flashSale,
      flashSale: flashSale ? flashSale._id : null,
      commissionRate,
      commissionAmount: commissionAmountUnit * quantity,
      sellerPayout: sellerPayoutUnit * quantity,
    })
  );

  for (const { product, variantDoc, quantity, flashSale } of prepared) {
    if (flashSale) {
      const updated = await FlashSale.findByIdAndUpdate(
        flashSale._id,
        { $inc: { stockSold: quantity } },
        { new: true }
      );
      if (updated && updated.stockSold >= updated.stockAllocated) {
        updated.status = 'sold_out';
        await updated.save();
      }

      await Product.findByIdAndUpdate(product._id, { $inc: { stock: -quantity } });
      checkAndSendStockReminder(product._id).catch(() => {});
      continue;
    }

    if (variantDoc) {
      await ProductVariant.findByIdAndUpdate(variantDoc._id, { $inc: { stock: -quantity } });
    }
    await Product.findByIdAndUpdate(product._id, { $inc: { stock: -quantity } });
    checkAndSendStockReminder(product._id).catch(() => {});
  }

  // ---------------- DYNAMIC SHIPPING ----------------
  const shippingLines = prepared.map(({ product, quantity }) => ({
    productId: product._id,
    quantity,
  }));
  const shippingResult = await calculateDynamicShippingFee(shippingLines);
  const retailTransportFee = shippingResult.standardShippingFee || 0;

  const deliveryFeeTotal = retailTransportFee + wholesaleDeliveryTotal;
  const totalAmount = itemsTotal + deliveryFeeTotal;

  // ============================================================
  // AGENT COMMISSION — NEW: computed from MARKETPLACE COMMISSION
  // (the sum of every item's commissionAmount above), NOT from the
  // buyer-facing sale total. Rate is resolved through CommissionRule
  // (your admin Rules tab: audience + badge + priority), falling back
  // to the agent's own flat commissionRate only if no rule matches —
  // same resolution commissionService already uses for seller-referral
  // commissions, so both referral types are now priced consistently.
  // ============================================================
  let agentDoc = null;
  let agentCommissionRate = 0;
  let agentCommissionAmount = 0;
  let totalMarketplaceProfit = 0;

  if (agentCode && agentCode.trim()) {
    // FIX: was `isActive: true`, which only matches status === 'active'
    // and silently rejected any approved-but-not-yet-active agent's code,
    // failing the entire checkout. Matches the same two statuses the
    // agent dashboard and trackReferralClick already treat as "working".
    agentDoc = await Agent.findOne({
      code: agentCode.trim().toUpperCase(),
      status: { $in: ['approved', 'active'] },
    });
    if (!agentDoc) {
      res.status(400);
      throw new Error('Invalid or inactive agent code');
    }

    totalMarketplaceProfit = prepared.reduce(
      (sum, p) => sum + p.commissionAmountUnit * p.quantity,
      0
    );

    agentCommissionRate = await commissionService.resolveCommissionRate(agentDoc, 'buyer');
    agentCommissionAmount = Math.round(totalMarketplaceProfit * (agentCommissionRate / 100));
  }

  const order = await Order.create({
    buyer: req.user._id,
    items: orderItems,
    totalAmount,
    paymentMethod: method,
    mpesaMessage: method === 'manual' ? mpesaMessage : '',
    deliveryFee: deliveryFeeTotal,
    deliveryDetails: {
      transportFee: retailTransportFee,
      wholesaleDeliveryFee: wholesaleDeliveryTotal,
      notes: deliveryNotes,
      normalWeightTotalKg: shippingResult.normalWeightTotalKg || 0,
      normalTierApplied: shippingResult.normalTierApplied
        ? {
            id: shippingResult.normalTierApplied.id,
            label: shippingResult.normalTierApplied.label,
            weightFrom: shippingResult.normalTierApplied.weightFrom,
            weightTo: shippingResult.normalTierApplied.weightTo,
            price: shippingResult.normalTierApplied.price,
          }
        : { id: null, label: '', weightFrom: null, weightTo: null, price: 0 },
      specialShippingBreakdown: shippingResult.specialBreakdown || [],
    },
    shippingAddress,
    paymentStatus: 'pending_verification',
    agent: agentDoc ? agentDoc._id : null,
    agentCode: agentDoc ? agentDoc.code : '',
    // Kept for quick display on admin order rows/emails — NOT the source
    // of truth for payout anymore. The Commission doc below is.
    commissionAmount: agentCommissionAmount,
    sellerFees,
  });

  // NEW — creates a real Commission ledger entry instead of crediting
  // agent.totalCommission immediately. Starts 'pending' and is carried
  // through confirm/cancel/reverse by commissionService's existing hooks
  // (onOrderDelivered / onOrderCancelled / onOrderRefunded), which already
  // query Commission.find({ order: order._id, ... }) with no filter on
  // referralType — so this flows through the exact same lifecycle your
  // seller-referral commissions already use. totalOrders can increment
  // right away since that's just a count, not money; totalCommission is
  // only touched once the Commission is actually confirmed on delivery.
  if (agentDoc && agentCommissionAmount > 0) {
    await Commission.create({
      agent: agentDoc._id,
      order: order._id,
      referralType: 'buyer_referral',
      buyer: req.user._id,
      saleAmount: totalAmount,
      marketplaceProfit: totalMarketplaceProfit,
      badge: agentDoc.badge,
      commissionRate: agentCommissionRate,
      commissionAmount: agentCommissionAmount,
      status: 'pending',
    });
  }
  if (agentDoc) {
    await Agent.findByIdAndUpdate(agentDoc._id, { $inc: { totalOrders: 1 } });
  }

  res.status(201).json({
    success: true,
    message:
      method === 'stk'
        ? 'Order created. Complete the M-Pesa prompt to confirm your order.'
        : 'Order placed. Your payment will be verified shortly.',
    order,
  });

  if (method === 'manual') {
    sendOrderEmails(order, req.user).catch((err) =>
      console.error('createOrder email dispatch failed:', err)
    );
  }
});

async function sendOrderEmails(order, buyer, { skipAdminVerificationAlert = false } = {}) {
  safeSendEmail(
    {
      to: buyer.email,
      subject: `Order Confirmation - ${order.orderNumber}`,
      html: orderConfirmationTemplate({ order, buyerName: buyer.name }),
      sender: 'info',
    },
    'Buyer order confirmation'
  );

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

  if (!skipAdminVerificationAlert) {
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
}

const getMyOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ buyer: req.user._id }).sort('-createdAt');
  res.json({ success: true, count: orders.length, orders });
});

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
    order = null;
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

const getSellerOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ 'items.seller': req.user._id })
    .populate('buyer', 'name phone')
    .sort('-createdAt');

  const filtered = orders.map((order) => {
    const myFee = (order.sellerFees || []).find((f) => f.seller.toString() === req.user._id.toString());
    return {
      _id: order._id,
      orderNumber: order.orderNumber,
      orderStatus: order.orderStatus,
      paymentStatus: order.paymentStatus,
      createdAt: order.createdAt,
      buyer: order.buyer,
      shippingAddress: order.shippingAddress,
      items: order.items.filter((i) => i.seller.toString() === req.user._id.toString()),
      transactionFee: myFee ? myFee.transactionFee : 0,
      transactionFeeTier: myFee ? myFee.tier : null,
    };
  });

  res.json({ success: true, count: filtered.length, orders: filtered });
});

const getMyEarnings = asyncHandler(async (req, res) => {
  const sellerId = new mongoose.Types.ObjectId(req.user._id);

  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - 29);

  const pipeline = [
    { $match: { $or: [{ 'items.seller': sellerId }, { 'sellerFees.seller': sellerId }] } },
    {
      $addFields: {
        isConfirmed: {
          $and: [{ $eq: ['$paymentStatus', 'confirmed'] }, { $ne: ['$orderStatus', 'cancelled'] }],
        },
        isPending: { $eq: ['$paymentStatus', 'pending_verification'] },
      },
    },
    {
      $facet: {
        totals: [
          { $unwind: '$items' },
          { $match: { 'items.seller': sellerId, isConfirmed: true } },
          { $addFields: { lineRevenue: { $multiply: ['$items.priceAtPurchase', '$items.quantity'] } } },
          {
            $group: {
              _id: null,
              totalRevenue: { $sum: '$lineRevenue' },
              totalCommission: { $sum: '$items.commissionAmount' },
              totalGrossPayout: { $sum: '$items.sellerPayout' },
              totalUnitsSold: { $sum: '$items.quantity' },
              orderIds: { $addToSet: '$_id' },
            },
          },
        ],
        pending: [
          { $unwind: '$items' },
          { $match: { 'items.seller': sellerId, isPending: true } },
          { $addFields: { lineRevenue: { $multiply: ['$items.priceAtPurchase', '$items.quantity'] } } },
          {
            $group: {
              _id: null,
              pendingRevenue: { $sum: '$lineRevenue' },
              pendingGrossPayout: { $sum: '$items.sellerPayout' },
              orderIds: { $addToSet: '$_id' },
            },
          },
        ],
        byProduct: [
          { $unwind: '$items' },
          { $match: { 'items.seller': sellerId, isConfirmed: true } },
          {
            $group: {
              _id: '$items.product',
              name: { $first: '$items.name' },
              image: { $first: '$items.image' },
              unitsSold: { $sum: '$items.quantity' },
              revenue: { $sum: { $multiply: ['$items.priceAtPurchase', '$items.quantity'] } },
              commission: { $sum: '$items.commissionAmount' },
              payout: { $sum: '$items.sellerPayout' },
            },
          },
          { $sort: { unitsSold: -1 } },
        ],
        dailyTrend: [
          { $unwind: '$items' },
          { $match: { 'items.seller': sellerId, isConfirmed: true, createdAt: { $gte: since } } },
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
              revenue: { $sum: { $multiply: ['$items.priceAtPurchase', '$items.quantity'] } },
              payout: { $sum: '$items.sellerPayout' },
            },
          },
        ],
        txnFeesConfirmed: [
          { $unwind: '$sellerFees' },
          { $match: { 'sellerFees.seller': sellerId, isConfirmed: true } },
          { $group: { _id: null, totalFees: { $sum: '$sellerFees.transactionFee' } } },
        ],
        txnFeesPending: [
          { $unwind: '$sellerFees' },
          { $match: { 'sellerFees.seller': sellerId, isPending: true } },
          { $group: { _id: null, totalFees: { $sum: '$sellerFees.transactionFee' } } },
        ],
      },
    },
  ];

  const [result] = await Order.aggregate(pipeline);

  const totals = (result?.totals || [])[0] || {
    totalRevenue: 0,
    totalCommission: 0,
    totalGrossPayout: 0,
    totalUnitsSold: 0,
    orderIds: [],
  };
  const pending = (result?.pending || [])[0] || {
    pendingRevenue: 0,
    pendingGrossPayout: 0,
    orderIds: [],
  };
  const txnFeesConfirmed = (result?.txnFeesConfirmed || [])[0]?.totalFees || 0;
  const txnFeesPending = (result?.txnFeesPending || [])[0]?.totalFees || 0;
  const byProduct = result?.byProduct || [];

  const topProducts = byProduct.slice(0, 5);
  const leastProducts = [...byProduct].sort((a, b) => a.unitsSold - b.unitsSold).slice(0, 5);

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

  const totalPayout = (totals.totalGrossPayout || 0) - txnFeesConfirmed;
  const pendingPayout = (pending.pendingGrossPayout || 0) - txnFeesPending;

  res.json({
    success: true,
    totalRevenue: totals.totalRevenue || 0,
    totalCommission: totals.totalCommission || 0,
    totalTransactionFees: txnFeesConfirmed,
    totalPayout,
    totalUnitsSold: totals.totalUnitsSold || 0,
    confirmedOrderCount,
    averageOrderValue: confirmedOrderCount ? Math.round(totalPayout / confirmedOrderCount) : 0,
    effectiveCommissionRate:
      totals.totalRevenue > 0 ? Math.round(((totals.totalCommission || 0) / totals.totalRevenue) * 1000) / 10 : 0,
    pendingRevenue: pending.pendingRevenue || 0,
    pendingTransactionFees: txnFeesPending,
    pendingPayout,
    pendingOrderCount: (pending.orderIds || []).length,
    topProducts,
    leastProducts,
    dailyTrend,
  });
});

const getMyEarningsTransactions = asyncHandler(async (req, res) => {
  const sellerId = req.user._id;
  const { status = 'all', page = 1, limit = 10 } = req.query;

  const filter = { 'items.seller': sellerId };
  if (status === 'confirmed') {
    filter.paymentStatus = 'confirmed';
    filter.orderStatus = { $ne: 'cancelled' };
  } else if (status === 'pending') {
    filter.paymentStatus = 'pending_verification';
  } else if (status === 'rejected') {
    filter.paymentStatus = 'rejected';
  }

  const skip = (Number(page) - 1) * Number(limit);

  const [orders, total] = await Promise.all([
    Order.find(filter).sort('-createdAt').skip(skip).limit(Number(limit)),
    Order.countDocuments(filter),
  ]);

  const transactions = orders.map((order) => {
    const myItems = order.items.filter((i) => i.seller.toString() === sellerId.toString());
    const grossRevenue = myItems.reduce((s, i) => s + i.priceAtPurchase * i.quantity, 0);
    const commission = myItems.reduce((s, i) => s + (i.commissionAmount || 0), 0);
    const grossPayout = myItems.reduce((s, i) => s + (i.sellerPayout || 0), 0);
    const feeEntry = (order.sellerFees || []).find((f) => f.seller.toString() === sellerId.toString());
    const transactionFee = feeEntry ? feeEntry.transactionFee : 0;
    const netPayout = grossPayout - transactionFee;

    const isConfirmed = order.paymentStatus === 'confirmed' && order.orderStatus !== 'cancelled';
    const isPending = order.paymentStatus === 'pending_verification';

    return {
      orderId: order._id,
      orderNumber: order.orderNumber,
      createdAt: order.createdAt,
      paymentStatus: order.paymentStatus,
      orderStatus: order.orderStatus,
      earningsStatus: isConfirmed ? 'confirmed' : isPending ? 'pending' : 'rejected',
      itemCount: myItems.reduce((s, i) => s + i.quantity, 0),
      items: myItems.map((i) => ({
        name: i.name,
        image: i.image,
        quantity: i.quantity,
        unitPrice: i.priceAtPurchase,
        lineTotal: i.priceAtPurchase * i.quantity,
        commissionRate: i.commissionRate,
        commissionAmount: i.commissionAmount,
        sellerPayout: i.sellerPayout,
      })),
      grossRevenue,
      commission,
      transactionFee,
      transactionFeeTier: feeEntry?.tier || null,
      netPayout,
    };
  });

  res.json({
    success: true,
    count: transactions.length,
    total,
    page: Number(page),
    pages: Math.ceil(total / Number(limit)),
    transactions,
  });
});

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

  if (orderStatus === 'delivered') {
    commissionService.onOrderDelivered(order).catch((err) => console.error('Commission confirm failed:', err));
  } else if (orderStatus === 'cancelled') {
    commissionService.onOrderCancelled(order).catch((err) => console.error('Commission cancel failed:', err));
    commissionService.onOrderRefunded(order).catch((err) => console.error('Commission reverse failed:', err));
  }

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

  commissionService.onOrderCancelled(order).catch((err) => console.error('Commission cancel failed:', err));
  commissionService.onOrderRefunded(order).catch((err) => console.error('Commission reverse failed:', err));

  for (const item of order.items) {
    await Product.findByIdAndUpdate(item.product, { $inc: { stock: item.quantity } });
    checkAndSendStockReminder(item.product).catch(() => {});
    if (item.variant) {
      await ProductVariant.findByIdAndUpdate(item.variant, { $inc: { stock: item.quantity } });
    }

    if (item.isFlashDeal && item.flashSale) {
      const restored = await FlashSale.findByIdAndUpdate(
        item.flashSale,
        { $inc: { stockSold: -item.quantity } },
        { new: true }
      );
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
  getMyEarningsTransactions,
  updateOrderStatus,
  cancelOrder,
  getAdminEmails,
  sendOrderEmails,
};