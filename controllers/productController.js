const asyncHandler = require('express-async-handler');
const Product = require('../models/Product');
const ProductVariant = require('../models/ProductVariant');
const ProductView = require('../models/ProductView');
const Category = require('../models/Category');
const ShippingCriteria = require('../models/ShippingCriteria');
const { User } = require('../models/User');
const sendEmail = require('../utils/sendEmail');
const { productSubmittedAdminTemplate } = require('../utils/emailTemplates');
const { isLeafCategory, getCategoryAttributeDefs } = require('./categoryAttributeController');
const { resolveCategoryShippingType } = require('./categoryController');
const { getApprovedShopForSeller } = require('./shopController');
const { checkAndSendStockReminder } = require('../utils/stockReminderService');

async function getAdminEmails() {
  if (process.env.ADMIN_EMAILS) {
    return process.env.ADMIN_EMAILS.split(',').map((s) => s.trim()).filter(Boolean);
  }
  const admins = await User.find({ role: 'admin' }).select('email');
  return admins.map((a) => a.email).filter(Boolean);
}

function safeSendEmail(opts, label) {
  sendEmail(opts).catch((err) => console.error(`${label} email failed:`, err.body || err.message));
}

async function notifyAdminsProductPending(product, sellerName) {
  const adminEmails = await getAdminEmails();
  adminEmails.forEach((to) => {
    safeSendEmail(
      {
        to,
        subject: `Product Awaiting Review - ${product.name}`,
        html: productSubmittedAdminTemplate({ product, sellerName }),
        sender: 'info',
      },
      'Product submitted (admin alert)'
    );
  });
}

async function getCategoryAndDescendantIds(categoryId) {
  const ids = [categoryId];
  const children = await Category.find({ parentCategory: categoryId }).select('_id');
  for (const child of children) {
    const childIds = await getCategoryAndDescendantIds(child._id);
    ids.push(...childIds);
  }
  return ids;
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildCombinationKey(combination) {
  return combination
    .map((c) => `${c.attribute}:${String(c.value).trim().toLowerCase()}`)
    .sort()
    .join('|');
}

async function validateAndPrepareAttributes(categoryId, rawAttributes, rawVariants) {
  const defs = await getCategoryAttributeDefs(categoryId);
  const variantDefs = defs.filter((d) => d.isVariantAttribute);
  const simpleDefs = defs.filter((d) => !d.isVariantAttribute);

  const attributes = [];
  for (const def of simpleDefs) {
    const match = (rawAttributes || []).find((a) => String(a.attribute) === String(def._id));
    const hasValue = match && match.value !== undefined && match.value !== '' && match.value !== null;

    if (def.isRequired && !hasValue) {
      const err = new Error(`"${def.name}" is required for this category`);
      err.status = 400;
      throw err;
    }
    if (hasValue) {
      attributes.push({ attribute: def._id, value: match.value });
    }
  }

  let variants = [];
  let stock = null;

  if (variantDefs.length > 0) {
    if (!Array.isArray(rawVariants) || rawVariants.length === 0) {
      const err = new Error(
        `This category requires at least one variant (${variantDefs.map((d) => d.name).join(', ')}) with its own stock`
      );
      err.status = 400;
      throw err;
    }

    const seenKeys = new Set();
    variants = rawVariants.map((v) => {
      const combination = variantDefs.map((def) => {
        const match = (v.combination || []).find((c) => String(c.attribute) === String(def._id));
        if (!match || match.value === undefined || match.value === '') {
          const err = new Error(`Each variant needs a value for "${def.name}"`);
          err.status = 400;
          throw err;
        }
        return { attribute: def._id, value: String(match.value) };
      });

      const key = buildCombinationKey(combination);
      if (seenKeys.has(key)) {
        const err = new Error(
          `Duplicate variant combination detected — each combination of ${variantDefs
            .map((d) => d.name)
            .join(' / ')} can only appear once`
        );
        err.status = 400;
        throw err;
      }
      seenKeys.add(key);

      const variantStock = Number(v.stock);
      if (Number.isNaN(variantStock) || variantStock < 0) {
        const err = new Error('Each variant needs a valid, non-negative stock number');
        err.status = 400;
        throw err;
      }

      return {
        combination,
        stock: variantStock,
        priceAdjustment: Number(v.priceAdjustment) || 0,
        sku: v.sku || '',
      };
    });

    stock = variants.reduce((sum, v) => sum + v.stock, 0);
  }

  return { attributes, variants, stock, variantDefs, simpleDefs };
}

function validateAndPrepareWholesaleFields(role, body) {
  if (role !== 'wholesaler') {
    return {
      deliveryType: 'simple',
      minOrderQuantity: 1,
      pricingTiers: [],
      freeDelivery: false,
      deliveryCharge: { chargeType: 'fixed', amount: 0, perUnitAmount: 0, notes: '' },
    };
  }

  const deliveryType = body.deliveryType === 'simple' ? 'simple' : 'heavy';

  let minOrderQuantity = 1;
  if (body.minOrderQuantity !== undefined && body.minOrderQuantity !== '') {
    minOrderQuantity = Number(body.minOrderQuantity);
    if (Number.isNaN(minOrderQuantity) || minOrderQuantity < 1) {
      const err = new Error('Minimum order quantity must be a whole number of 1 or more');
      err.status = 400;
      throw err;
    }
  }

  let pricingTiers = [];
  if (body.pricingTiers !== undefined && body.pricingTiers !== '') {
    let raw;
    try {
      raw = typeof body.pricingTiers === 'string' ? JSON.parse(body.pricingTiers) : body.pricingTiers;
    } catch (e) {
      const err = new Error('pricingTiers must be valid JSON');
      err.status = 400;
      throw err;
    }

    if (!Array.isArray(raw)) {
      const err = new Error('pricingTiers must be an array');
      err.status = 400;
      throw err;
    }

    pricingTiers = raw.map((t) => {
      const minQty = Number(t.minQty);
      const price = Number(t.price);
      if (Number.isNaN(minQty) || minQty < 1) {
        const err = new Error('Each pricing tier needs a valid minimum quantity of 1 or more');
        err.status = 400;
        throw err;
      }
      if (Number.isNaN(price) || price < 0) {
        const err = new Error('Each pricing tier needs a valid, non-negative price');
        err.status = 400;
        throw err;
      }
      return { minQty, price };
    });

    pricingTiers.sort((a, b) => a.minQty - b.minQty);

    const seenQty = new Set();
    for (let i = 0; i < pricingTiers.length; i++) {
      if (seenQty.has(pricingTiers[i].minQty)) {
        const err = new Error('Each pricing tier must have a unique minimum quantity');
        err.status = 400;
        throw err;
      }
      seenQty.add(pricingTiers[i].minQty);

      if (i > 0 && pricingTiers[i].price > pricingTiers[i - 1].price) {
        const err = new Error(
          'Pricing tiers must not increase in price as quantity goes up — bulk pricing should stay flat or get cheaper'
        );
        err.status = 400;
        throw err;
      }
    }

    if (pricingTiers.length > 0 && minOrderQuantity && pricingTiers[0].minQty < minOrderQuantity) {
      const err = new Error('The first pricing tier quantity cannot be lower than the minimum order quantity');
      err.status = 400;
      throw err;
    }
  }

  let freeDelivery = false;
  let deliveryCharge = { chargeType: 'fixed', amount: 0, perUnitAmount: 0, notes: '' };

  if (deliveryType === 'heavy') {
    freeDelivery = body.freeDelivery === true || body.freeDelivery === 'true';

    if (!freeDelivery) {
      let rawCharge = {};
      if (body.deliveryCharge !== undefined && body.deliveryCharge !== '') {
        try {
          rawCharge = typeof body.deliveryCharge === 'string' ? JSON.parse(body.deliveryCharge) : body.deliveryCharge;
        } catch (e) {
          const err = new Error('deliveryCharge must be valid JSON');
          err.status = 400;
          throw err;
        }
      }

      const chargeType = ['fixed', 'quantity_based', 'negotiated'].includes(rawCharge.chargeType)
        ? rawCharge.chargeType
        : 'fixed';

      if (chargeType === 'fixed') {
        const amount = Number(rawCharge.amount);
        if (Number.isNaN(amount) || amount < 0) {
          const err = new Error('Please provide a valid fixed delivery charge');
          err.status = 400;
          throw err;
        }
        deliveryCharge = { chargeType, amount, perUnitAmount: 0, notes: '' };
      } else if (chargeType === 'quantity_based') {
        const perUnitAmount = Number(rawCharge.perUnitAmount);
        if (Number.isNaN(perUnitAmount) || perUnitAmount < 0) {
          const err = new Error('Please provide a valid per-unit delivery charge');
          err.status = 400;
          throw err;
        }
        deliveryCharge = { chargeType, amount: 0, perUnitAmount, notes: '' };
      } else {
        const notes = (rawCharge.notes || '').toString().trim();
        deliveryCharge = { chargeType, amount: 0, perUnitAmount: 0, notes };
      }
    }
  }

  return { deliveryType, minOrderQuantity, pricingTiers, freeDelivery, deliveryCharge };
}

// ============================================================
// NEW — DYNAMIC SHIPPING VALIDATION
// ------------------------------------------------------------
// Resolves the category's EFFECTIVE shipping classification (live,
// inheritance-aware — see resolveCategoryShippingType) and validates/
// prepares whichever of the two shipping field sets applies:
//   'normal'  -> weightKg (required, > 0)
//   'special' -> shippingCriteriaSelections, validated against the
//                category's actual ShippingCriteria groups (one
//                selection per required group; must reference a real,
//                active option)
//
// A wholesaler product with deliveryType 'heavy' still gets a
// shippingType/weightKg recorded (for consistency/reporting), but it is
// never actually required, since heavy-wholesale items are excluded from
// the dynamic shipping calculation entirely (see shippingFeeCalculator.js).
// We still validate normally here so that if a seller later flips their
// product to 'simple' delivery, the shipping data is already correct.
// ============================================================
async function validateAndPrepareShipping(categoryId, body) {
  const { shippingType } = await resolveCategoryShippingType(categoryId);

  if (shippingType === 'normal') {
    const weightKg = Number(body.weightKg);
    if (Number.isNaN(weightKg) || weightKg <= 0) {
      const err = new Error('Weight (kg) is required for products in this category, and must be greater than 0');
      err.status = 400;
      throw err;
    }
    return { shippingType, weightKg, shippingCriteriaSelections: [] };
  }

  // 'special'
  const groups = await ShippingCriteria.find({ category: categoryId, isActive: true });

  let rawSelections = [];
  if (body.shippingCriteriaSelections !== undefined && body.shippingCriteriaSelections !== '') {
    try {
      rawSelections =
        typeof body.shippingCriteriaSelections === 'string'
          ? JSON.parse(body.shippingCriteriaSelections)
          : body.shippingCriteriaSelections;
    } catch (e) {
      const err = new Error('shippingCriteriaSelections must be valid JSON');
      err.status = 400;
      throw err;
    }
  }
  if (!Array.isArray(rawSelections)) rawSelections = [];

  const selections = [];
  for (const group of groups) {
    const match = rawSelections.find((s) => String(s.criteria) === String(group._id));

    if (!match || !match.option) {
      if (group.isRequired) {
        const err = new Error(`Please select "${group.name}" for shipping`);
        err.status = 400;
        throw err;
      }
      continue;
    }

    const option = group.options.id(match.option);
    if (!option || !option.isActive) {
      const err = new Error(`The selected option for "${group.name}" is not valid`);
      err.status = 400;
      throw err;
    }

    selections.push({ criteria: group._id, option: option._id });
  }

  return { shippingType, weightKg: null, shippingCriteriaSelections: selections };
}

// @desc    Seller creates a new product (starts as 'draft')
// @route   POST /api/products
// @access  Private (wholesaler, retailer)
const createProduct = asyncHandler(async (req, res) => {
  const { name, description, category, sellerPrice, discountPercent } = req.body;

  if (!req.files || req.files.length === 0) {
    res.status(400);
    throw new Error('At least one product image is required');
  }

  if (!category) {
    res.status(400);
    throw new Error('Category is required');
  }

  const categoryDoc = await Category.findById(category);
  if (!categoryDoc || !categoryDoc.isActive) {
    res.status(400);
    throw new Error('Category not found');
  }

  const leaf = await isLeafCategory(category);
  if (!leaf) {
    res.status(400);
    throw new Error(
      'Please choose the most specific category (one with no further subcategories) — that is where products get attached.'
    );
  }

  let rawAttributes = [];
  let rawVariants = [];
  try {
    if (req.body.attributes) rawAttributes = JSON.parse(req.body.attributes);
    if (req.body.variants) rawVariants = JSON.parse(req.body.variants);
  } catch (e) {
    res.status(400);
    throw new Error('attributes/variants must be valid JSON');
  }

  let prepared;
  try {
    prepared = await validateAndPrepareAttributes(category, rawAttributes, rawVariants);
  } catch (err) {
    res.status(err.status || 400);
    throw err;
  }

  let finalStock;
  if (prepared.variantDefs.length > 0) {
    finalStock = prepared.stock;
  } else {
    finalStock = Number(req.body.stock);
    if (Number.isNaN(finalStock) || finalStock < 0) {
      res.status(400);
      throw new Error('Stock is required');
    }
  }

  let wholesale;
  try {
    wholesale = validateAndPrepareWholesaleFields(req.user.role, req.body);
  } catch (err) {
    res.status(err.status || 400);
    throw err;
  }

  // NEW — dynamic shipping validation (weight vs criteria, resolved live from category)
  let shipping;
  try {
    shipping = await validateAndPrepareShipping(category, req.body);
  } catch (err) {
    res.status(err.status || 400);
    throw err;
  }

  const approvedShop = await getApprovedShopForSeller(req.user._id);

  const images = req.files.map((file) => file.path);

  let stockReminderEnabled = false;
  if (req.body.stockReminderEnabled !== undefined) {
    stockReminderEnabled = req.body.stockReminderEnabled === true || req.body.stockReminderEnabled === 'true';
  }
  let stockReminderThreshold = 5;
  if (req.body.stockReminderThreshold !== undefined && req.body.stockReminderThreshold !== '') {
    const t = Number(req.body.stockReminderThreshold);
    if (!Number.isNaN(t) && t >= 0) stockReminderThreshold = t;
  }

  const product = await Product.create({
    seller: req.user._id,
    sellerRole: req.user.role,
    shop: approvedShop ? approvedShop._id : null,
    name,
    description,
    images,
    category,
    stock: finalStock,
    sellerPrice,
    discountPercent: discountPercent || 0,
    status: 'draft',
    attributes: prepared.attributes,
    deliveryType: wholesale.deliveryType,
    minOrderQuantity: wholesale.minOrderQuantity,
    pricingTiers: wholesale.pricingTiers,
    freeDelivery: wholesale.freeDelivery,
    deliveryCharge: wholesale.deliveryCharge,
    // NEW — dynamic shipping
    shippingType: shipping.shippingType,
    weightKg: shipping.weightKg,
    shippingCriteriaSelections: shipping.shippingCriteriaSelections,
    stockReminderEnabled,
    stockReminderThreshold,
  });

  if (prepared.variants.length > 0) {
    await ProductVariant.insertMany(prepared.variants.map((v) => ({ ...v, product: product._id })));
  }

  checkAndSendStockReminder(product._id).catch(() => {});

  const populated = await Product.findById(product._id)
    .populate('category', 'name slug')
    .populate('attributes.attribute', 'name slug type unit')
    .populate('shop', 'shopName slug status')
    .populate('variants');

  res.status(201).json({ success: true, product: populated });
});

// @desc    Seller updates their own draft/rejected/live product
// @route   PUT /api/products/:id
// @access  Private (owner only)
const updateProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);

  if (!product) {
    res.status(404);
    throw new Error('Product not found');
  }

  if (product.seller.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error('Not authorized to edit this product');
  }

  if (!['draft', 'rejected', 'active'].includes(product.status)) {
    res.status(400);
    throw new Error('This product cannot be edited while pending review or suspended.');
  }

  const wasLive = product.status === 'active';

  const editableFields = ['name', 'description', 'sellerPrice', 'discountPercent'];
  editableFields.forEach((field) => {
    if (req.body[field] !== undefined) product[field] = req.body[field];
  });

  let categoryChanged = false;
  if (req.body.category) {
    const categoryDoc = await Category.findById(req.body.category);
    if (!categoryDoc || !categoryDoc.isActive) {
      res.status(400);
      throw new Error('Category not found');
    }
    const leaf = await isLeafCategory(req.body.category);
    if (!leaf) {
      res.status(400);
      throw new Error('Please choose the most specific category (one with no further subcategories).');
    }
    categoryChanged = String(req.body.category) !== String(product.category);
    product.category = req.body.category;
  }

  const effectiveCategory = req.body.category || product.category.toString();

  if (req.body.attributes !== undefined || req.body.variants !== undefined || req.body.category !== undefined) {
    let rawAttributes = [];
    let rawVariants = [];
    try {
      if (req.body.attributes) rawAttributes = JSON.parse(req.body.attributes);
      if (req.body.variants) rawVariants = JSON.parse(req.body.variants);
    } catch (e) {
      res.status(400);
      throw new Error('attributes/variants must be valid JSON');
    }

    let prepared;
    try {
      prepared = await validateAndPrepareAttributes(effectiveCategory, rawAttributes, rawVariants);
    } catch (err) {
      res.status(err.status || 400);
      throw err;
    }

    product.attributes = prepared.attributes;

    await ProductVariant.deleteMany({ product: product._id });
    if (prepared.variantDefs.length > 0) {
      if (prepared.variants.length > 0) {
        await ProductVariant.insertMany(prepared.variants.map((v) => ({ ...v, product: product._id })));
      }
      product.stock = prepared.stock;
    } else if (req.body.stock !== undefined) {
      product.stock = Number(req.body.stock);
    }
  } else if (req.body.stock !== undefined) {
    product.stock = Number(req.body.stock);
  }

  const wholesaleKeysSent = [
    'deliveryType',
    'minOrderQuantity',
    'pricingTiers',
    'freeDelivery',
    'deliveryCharge',
  ].some((k) => req.body[k] !== undefined);
  if (wholesaleKeysSent) {
    let wholesale;
    try {
      wholesale = validateAndPrepareWholesaleFields(req.user.role, req.body);
    } catch (err) {
      res.status(err.status || 400);
      throw err;
    }
    product.deliveryType = wholesale.deliveryType;
    product.minOrderQuantity = wholesale.minOrderQuantity;
    product.pricingTiers = wholesale.pricingTiers;
    product.freeDelivery = wholesale.freeDelivery;
    product.deliveryCharge = wholesale.deliveryCharge;
  }

  // NEW — dynamic shipping revalidation. Re-run whenever the category
  // changed (classification may now differ) OR the seller explicitly sent
  // new shipping fields (weightKg / shippingCriteriaSelections).
  const shippingKeysSent =
    categoryChanged || req.body.weightKg !== undefined || req.body.shippingCriteriaSelections !== undefined;
  if (shippingKeysSent) {
    let shipping;
    try {
      shipping = await validateAndPrepareShipping(effectiveCategory, req.body);
    } catch (err) {
      res.status(err.status || 400);
      throw err;
    }
    product.shippingType = shipping.shippingType;
    product.weightKg = shipping.weightKg;
    product.shippingCriteriaSelections = shipping.shippingCriteriaSelections;
  }

  const approvedShop = await getApprovedShopForSeller(req.user._id);
  product.shop = approvedShop ? approvedShop._id : null;

  if (req.files && req.files.length > 0) {
    product.images = req.files.map((file) => file.path);
  }

  if (product.status === 'rejected') {
    product.status = 'draft';
    product.rejectionReason = '';
  }

  if (wasLive) {
    product.status = 'pending_review';
    product.reviewedBy = null;
    product.reviewedAt = null;
  }

  await product.save();

  checkAndSendStockReminder(product._id).catch(() => {});

  const populated = await Product.findById(product._id)
    .populate('category', 'name slug')
    .populate('attributes.attribute', 'name slug type unit')
    .populate('shop', 'shopName slug status')
    .populate('variants');

  res.json({ success: true, product: populated });

  if (wasLive) {
    notifyAdminsProductPending(product, req.user.name);
  }
});

// @desc    Seller submits a draft product for admin review/pricing
// @route   PATCH /api/products/:id/submit
// @access  Private (owner only)
const submitProductForReview = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);

  if (!product) {
    res.status(404);
    throw new Error('Product not found');
  }
  if (product.seller.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error('Not authorized');
  }
  if (product.status !== 'draft') {
    res.status(400);
    throw new Error('Only draft products can be submitted for review');
  }

  product.status = 'pending_review';
  await product.save();

  res.json({ success: true, message: 'Product submitted for admin review', product });

  notifyAdminsProductPending(product, req.user.name);
});

// @desc    Get the logged-in seller's own products (any status)
// @route   GET /api/products/my-products
// @access  Private (wholesaler, retailer)
const getMyProducts = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const filter = { seller: req.user._id };
  if (status) filter.status = status;

  const products = await Product.find(filter)
    .populate('category', 'name slug')
    .populate('attributes.attribute', 'name slug type unit')
    .populate('shop', 'shopName slug status')
    .populate({ path: 'variants', match: { isActive: true } })
    .sort('-createdAt');

  res.json({ success: true, count: products.length, products });
});

// @desc    Seller deletes (soft) their own product
// @route   DELETE /api/products/:id
// @access  Private (owner only)
const deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) {
    res.status(404);
    throw new Error('Product not found');
  }
  if (product.seller.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error('Not authorized');
  }

  product.isActive = false;
  await product.save();
  res.json({ success: true, message: 'Product removed' });
});

// ---------------- PUBLIC STOREFRONT ----------------

// @desc    Get all ACTIVE products for the public buyer-facing storefront
// @route   GET /api/products
// @access  Public
const getProducts = asyncHandler(async (req, res) => {
  const {
    category,
    search,
    minPrice,
    maxPrice,
    sort,
    page = 1,
    limit = 20,
    hotDeals,
    attributes,
    sellerRole,
    freeDelivery,
    shop,
    discountOnly,
    minRating,
  } = req.query;

  const filter = { status: 'active', isActive: true, finalPrice: { $ne: null } };

  if (category) {
    const categoryIds = await getCategoryAndDescendantIds(category);
    filter.category = { $in: categoryIds };
  }

  if (hotDeals === 'true') filter.isHotDeal = true;
  if (sellerRole === 'wholesaler' || sellerRole === 'retailer') filter.sellerRole = sellerRole;
  if (shop) filter.shop = shop;
  if (freeDelivery === 'true') {
    filter.sellerRole = 'wholesaler';
    filter.deliveryType = 'heavy';
    filter.freeDelivery = true;
  }

  if (discountOnly === 'true') {
    filter.discountPercent = { $gt: 0 };
  }

  if (minRating !== undefined && minRating !== '') {
    const ratingNum = Number(minRating);
    if (Number.isFinite(ratingNum) && ratingNum > 0) {
      filter.ratingsAverage = { $gte: ratingNum };
    }
  }

  if (search && search.trim()) {
    const searchRegex = new RegExp(escapeRegex(search.trim()), 'i');

    const searchOr = [
      { name: searchRegex },
      { description: searchRegex },
      { 'attributes.value': searchRegex },
    ];

    const matchingCategories = await Category.find({ name: searchRegex, isActive: true }).select('_id');
    if (matchingCategories.length) {
      const nestedIdLists = await Promise.all(
        matchingCategories.map((c) => getCategoryAndDescendantIds(c._id))
      );
      const categoryIdsFromSearch = nestedIdLists.flat();
      searchOr.push({ category: { $in: categoryIdsFromSearch } });
    }

    filter.$or = searchOr;
  }

  if (minPrice || maxPrice) {
    filter.finalPrice = { ...filter.finalPrice };
    if (minPrice) filter.finalPrice.$gte = Number(minPrice);
    if (maxPrice) filter.finalPrice.$lte = Number(maxPrice);
  }

  if (attributes) {
    try {
      const attrFilter = JSON.parse(attributes);
      const conditions = Object.entries(attrFilter)
        .filter(([, value]) => {
          if (Array.isArray(value)) return value.length > 0;
          return value !== undefined && value !== null && value !== '';
        })
        .map(([attrId, value]) => {
          const matchValue = Array.isArray(value) ? { $in: value } : value;
          return { attributes: { $elemMatch: { attribute: attrId, value: matchValue } } };
        });
      if (conditions.length) filter.$and = (filter.$and || []).concat(conditions);
    } catch (e) {
      /* ignore malformed filter rather than failing the whole request */
    }
  }

  const sortMap = {
    price_asc: 'finalPrice',
    price_desc: '-finalPrice',
    newest: '-createdAt',
    rating: '-ratingsAverage',
  };

  const skip = (Number(page) - 1) * Number(limit);

  const [products, total] = await Promise.all([
    Product.find(filter)
      .populate('category', 'name slug')
      .populate('seller', 'name businessName shopName role')
      .populate('shop', 'shopName slug logo')
      .populate('attributes.attribute', 'name slug type unit')
      .populate({ path: 'variants', match: { isActive: true } })
      .sort(sortMap[sort] || '-createdAt')
      .skip(skip)
      .limit(Number(limit)),
    Product.countDocuments(filter),
  ]);

  res.json({
    success: true,
    count: products.length,
    total,
    page: Number(page),
    pages: Math.ceil(total / Number(limit)),
    products,
  });
});

// @desc    Get single active product by ID (public product page)
// @route   GET /api/products/:id
// @access  Public
const getProductById = asyncHandler(async (req, res) => {
  const product = await Product.findOne({
    _id: req.params.id,
    status: 'active',
    isActive: true,
  })
    .populate('category', 'name slug')
    .populate('seller', 'name businessName shopName role location')
    .populate('shop', 'shopName slug logo description')
    .populate('attributes.attribute', 'name slug type unit')
    .populate({ path: 'variants', match: { isActive: true } });

  if (!product) {
    res.status(404);
    throw new Error('Product not found or not currently available');
  }

  res.json({ success: true, product });
});

// @desc    Lightweight autocomplete suggestions for the search box
// @route   GET /api/products/suggestions?q=phone
// @access  Public
const getProductSuggestions = asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) {
    return res.json({ success: true, query: q, products: [], categories: [] });
  }

  const regex = new RegExp(escapeRegex(q), 'i');

  const [products, categories] = await Promise.all([
    Product.find({ status: 'active', isActive: true, name: regex })
      .select('name images finalPrice discountPercent')
      .limit(8),
    Category.find({ name: regex, isActive: true }).select('name slug').limit(4),
  ]);

  res.json({
    success: true,
    query: q,
    products: products.map((p) => ({
      id: p._id,
      name: p.name,
      image: (p.images && p.images[0]) || '',
      price: p.discountPercent
        ? Math.round(p.finalPrice * (1 - p.discountPercent / 100))
        : p.finalPrice,
    })),
    categories: categories.map((c) => ({ id: c._id, name: c.name, slug: c.slug })),
  });
});

// ---------------- ANALYTICS ----------------

// @desc    Fire-and-forget view tracking ping
// @route   PATCH /api/products/:id/view
// @access  Public
const trackProductViewCount = asyncHandler(async (req, res) => {
  const product = await Product.findOneAndUpdate(
    { _id: req.params.id, status: 'active', isActive: true },
    { $inc: { viewCount: 1 } },
    { new: false }
  ).select('_id seller');

  if (product) {
    ProductView.create({
      product: product._id,
      seller: product.seller,
      viewer: req.user?._id || null,
    }).catch(() => {});
  }

  res.status(204).end();
});

// @desc    Seller's product-view analytics
// @route   GET /api/products/analytics
// @access  Private (wholesaler, retailer)
const getMyProductAnalytics = asyncHandler(async (req, res) => {
  const products = await Product.find({ seller: req.user._id, isActive: true })
    .select('name images status viewCount createdAt')
    .sort('-viewCount');

  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - 13);

  const trend = await ProductView.aggregate([
    { $match: { seller: req.user._id, viewedAt: { $gte: since } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$viewedAt' } },
        count: { $sum: 1 },
      },
    },
  ]);

  const trendMap = new Map(trend.map((t) => [t._id, t.count]));
  const dailyTrend = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    dailyTrend.push({ date: key, count: trendMap.get(key) || 0 });
  }

  const totalViews = products.reduce((sum, p) => sum + (p.viewCount || 0), 0);
  const viewsLast14Days = dailyTrend.reduce((sum, d) => sum + d.count, 0);

  res.json({
    success: true,
    totalViews,
    viewsLast14Days,
    dailyTrend,
    products: products.map((p) => ({
      id: p._id,
      name: p.name,
      image: (p.images && p.images[0]) || null,
      status: p.status,
      viewCount: p.viewCount || 0,
    })),
  });
});

// ---------------- MANAGE STOCK ----------------

// @desc    Seller's full stock overview for the "Manage Stock" panel.
// @route   GET /api/products/stock-overview
// @access  Private (wholesaler, retailer)
const getMyStockOverview = asyncHandler(async (req, res) => {
  const products = await Product.find({ seller: req.user._id, isActive: true })
    .select('name images status stock stockReminderEnabled stockReminderThreshold lastStockReminderSentAt')
    .sort('stock');

  res.json({
    success: true,
    products: products.map((p) => ({
      id: p._id,
      name: p.name,
      image: (p.images && p.images[0]) || null,
      status: p.status,
      stock: p.stock,
      stockReminderEnabled: p.stockReminderEnabled,
      stockReminderThreshold: p.stockReminderThreshold,
      isLowStock: p.stockReminderEnabled ? p.stock <= p.stockReminderThreshold : false,
      lastReminderSentAt: p.lastStockReminderSentAt,
    })),
  });
});

// @desc    Seller sets/updates a product's low-stock reminder settings.
// @route   PATCH /api/products/:id/stock-reminder
// @access  Private (owner only)
const updateStockReminderSettings = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) {
    res.status(404);
    throw new Error('Product not found');
  }
  if (product.seller.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error('Not authorized');
  }

  const { stockReminderEnabled, stockReminderThreshold } = req.body;

  if (stockReminderEnabled !== undefined) {
    product.stockReminderEnabled = stockReminderEnabled === true || stockReminderEnabled === 'true';
  }

  if (stockReminderThreshold !== undefined && stockReminderThreshold !== '') {
    const threshold = Number(stockReminderThreshold);
    if (Number.isNaN(threshold) || threshold < 0) {
      res.status(400);
      throw new Error('Threshold must be a non-negative number');
    }
    product.stockReminderThreshold = threshold;
  }

  if (product.stock > product.stockReminderThreshold) {
    product.lastStockReminderSentAt = null;
  }

  await product.save();

  if (product.stockReminderEnabled && product.stock <= product.stockReminderThreshold) {
    await checkAndSendStockReminder(product._id);
  }

  res.json({
    success: true,
    product: {
      id: product._id,
      stock: product.stock,
      stockReminderEnabled: product.stockReminderEnabled,
      stockReminderThreshold: product.stockReminderThreshold,
    },
  });
});

// @desc    Bulk-set stock reminder settings for many of the seller's own products.
// @route   PATCH /api/products/stock-reminder/bulk
// @access  Private (owner only, wholesaler/retailer)
const bulkUpdateStockReminderSettings = asyncHandler(async (req, res) => {
  const { productIds, stockReminderEnabled, stockReminderThreshold } = req.body;

  if (!Array.isArray(productIds) || productIds.length === 0) {
    res.status(400);
    throw new Error('Please select at least one product');
  }

  const update = {};
  if (stockReminderEnabled !== undefined) {
    update.stockReminderEnabled = stockReminderEnabled === true || stockReminderEnabled === 'true';
  }
  if (stockReminderThreshold !== undefined && stockReminderThreshold !== '') {
    const threshold = Number(stockReminderThreshold);
    if (Number.isNaN(threshold) || threshold < 0) {
      res.status(400);
      throw new Error('Threshold must be a non-negative number');
    }
    update.stockReminderThreshold = threshold;
  }

  if (Object.keys(update).length === 0) {
    res.status(400);
    throw new Error('Nothing to update');
  }

  const owned = await Product.find({ _id: { $in: productIds }, seller: req.user._id }).select('_id');
  if (!owned.length) {
    res.status(404);
    throw new Error('No matching products found');
  }
  const ids = owned.map((p) => p._id);

  await Product.updateMany({ _id: { $in: ids } }, { $set: update });

  const updatedProducts = await Product.find({ _id: { $in: ids } });
  for (const p of updatedProducts) {
    if (p.stock > p.stockReminderThreshold && p.lastStockReminderSentAt) {
      p.lastStockReminderSentAt = null;
      await p.save();
    }
  }
  updatedProducts.forEach((p) => {
    if (p.stockReminderEnabled && p.stock <= p.stockReminderThreshold) {
      checkAndSendStockReminder(p._id).catch(() => {});
    }
  });

  res.json({ success: true, updatedCount: ids.length });
});

module.exports = {
  createProduct,
  updateProduct,
  submitProductForReview,
  getMyProducts,
  deleteProduct,
  getProducts,
  getProductById,
  getProductSuggestions,
  trackProductViewCount,
  getMyProductAnalytics,
  getMyStockOverview,
  updateStockReminderSettings,
  bulkUpdateStockReminderSettings,
};