const asyncHandler = require('express-async-handler');
const Product = require('../models/Product');
const ProductVariant = require('../models/ProductVariant');
const ProductView = require('../models/ProductView');
const Category = require('../models/Category');
const { User } = require('../models/User');
const sendEmail = require('../utils/sendEmail');
const { productSubmittedAdminTemplate } = require('../utils/emailTemplates');
const { isLeafCategory, getCategoryAttributeDefs } = require('./categoryAttributeController');
const { getApprovedShopForSeller } = require('./shopController');

// Best-effort admin recipient list: explicit env override first, otherwise every
// user with role "admin".
async function getAdminEmails() {
  if (process.env.ADMIN_EMAILS) {
    return process.env.ADMIN_EMAILS.split(',').map((s) => s.trim()).filter(Boolean);
  }
  const admins = await User.find({ role: 'admin' }).select('email');
  return admins.map((a) => a.email).filter(Boolean);
}

function safeSendEmail(opts, label) {
  // Brevo errors surface on err.body (see utils/sendEmail.js), not
  // err.response.body like the old SendGrid SDK did.
  sendEmail(opts).catch((err) => console.error(`${label} email failed:`, err.body || err.message));
}

// Notifies every admin that a product needs review (used for both first-time
// submission and re-submission after a live product is edited).
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

// ---------------------------------------------------------------------------
// Recursively collects a category's own ID plus every descendant category ID
// underneath it (children, grandchildren, ...). Needed because products are
// ALWAYS assigned to a LEAF category only (see the isLeafCategory() checks in
// createProduct/updateProduct below) — so filtering the public storefront by
// an exact match on a parent or mid-level category id would return nothing.
// This widens a category filter to "this category, or any category nested
// under it, at any depth," so clicking a top-level or mid-level category
// (from the mega-menu, drawer accordion, or the product.html cascade filter)
// shows every product underneath it immediately, with no narrowing required.
// ---------------------------------------------------------------------------
async function getCategoryAndDescendantIds(categoryId) {
  const ids = [categoryId];
  const children = await Category.find({ parentCategory: categoryId }).select('_id');
  for (const child of children) {
    const childIds = await getCategoryAndDescendantIds(child._id);
    ids.push(...childIds);
  }
  return ids;
}

// Escapes regex special characters in free-text user input before it's
// dropped into a RegExp — otherwise a search like "iPhone (2023)" would throw
// or behave unexpectedly.
function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Shared validation: given a leaf category plus whatever attributes/variants
// the seller sent, checks them against that category's attribute rules and
// returns the shapes ready to save. Throws an Error with `.status` on failure.
// ---------------------------------------------------------------------------
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

  // ---- product-level attributes (Brand, Material, Gender, ...) ----
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

  // ---- variant-defining attributes (Size, Color, ...) ----
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

// ---------------------------------------------------------------------------
// Wholesale-only validation: delivery type (simple/heavy), MOQ, quantity-based
// pricing tiers, and delivery terms.
//
//  - Retailers never see any of this — everything is forced back to the
//    'simple'-equivalent defaults regardless of what was sent.
//  - Wholesalers always get MOQ + pricing tiers (bulk buying still applies
//    either way).
//  - Only when deliveryType === 'heavy' do freeDelivery/deliveryCharge get
//    validated and saved. deliveryType === 'simple' means "this ships like a
//    normal retail product" — no special transport terms, the buyer just pays
//    the regular regional delivery fee at checkout like anyone else.
// ---------------------------------------------------------------------------
function validateAndPrepareWholesaleFields(role, body) {
  if (role !== 'wholesaler') {
    // Retailers: force these back to defaults regardless of what was sent.
    return {
      deliveryType: 'simple',
      minOrderQuantity: 1,
      pricingTiers: [],
      freeDelivery: false,
      deliveryCharge: { chargeType: 'fixed', amount: 0, perUnitAmount: 0, notes: '' },
    };
  }

  const deliveryType = body.deliveryType === 'simple' ? 'simple' : 'heavy';

  // --- MOQ (applies to every wholesale product, simple or heavy) ---
  let minOrderQuantity = 1;
  if (body.minOrderQuantity !== undefined && body.minOrderQuantity !== '') {
    minOrderQuantity = Number(body.minOrderQuantity);
    if (Number.isNaN(minOrderQuantity) || minOrderQuantity < 1) {
      const err = new Error('Minimum order quantity must be a whole number of 1 or more');
      err.status = 400;
      throw err;
    }
  }

  // --- Quantity-based pricing tiers (also applies either way) ---
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

    // Sort ascending by quantity, then make sure the price actually drops (or stays flat)
    // as quantity increases — otherwise the tiers don't make sense as "bulk" pricing.
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

  // --- Delivery terms: only meaningful for 'heavy' products ---
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
        // negotiated
        const notes = (rawCharge.notes || '').toString().trim();
        deliveryCharge = { chargeType, amount: 0, perUnitAmount: 0, notes };
      }
    }
  }
  // deliveryType === 'simple' -> freeDelivery/deliveryCharge stay at their defaults above;
  // the product ships like a normal retail item and standard checkout transport fees apply.

  return { deliveryType, minOrderQuantity, pricingTiers, freeDelivery, deliveryCharge };
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

  // attributes/variants travel as JSON strings inside the multipart body
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

  // Wholesale-specific fields (no-op / defaults for retailers)
  let wholesale;
  try {
    wholesale = validateAndPrepareWholesaleFields(req.user.role, req.body);
  } catch (err) {
    res.status(err.status || 400);
    throw err;
  }

  // --- Shop auto-attach (silent) ---
  // If this seller has an APPROVED shop, the new product is automatically tied
  // to it. No client input is trusted for this — it's derived purely from the
  // seller's own shop status server-side. Sellers with no shop, or a shop
  // that's pending/rejected/suspended, simply get shop: null (today's behavior).
  const approvedShop = await getApprovedShopForSeller(req.user._id);

  const images = req.files.map((file) => file.path);

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
  });

  if (prepared.variants.length > 0) {
    await ProductVariant.insertMany(prepared.variants.map((v) => ({ ...v, product: product._id })));
  }

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

  // Sellers can edit a draft, a rejected product, or a currently-live product.
  // Editing a live product pulls it back into review (handled below) so buyers
  // never see unreviewed changes on the storefront. Pending/suspended products
  // can't be touched until admin resolves them.
  if (!['draft', 'rejected', 'active'].includes(product.status)) {
    res.status(400);
    throw new Error('This product cannot be edited while pending review or suspended.');
  }

  const wasLive = product.status === 'active';

  const editableFields = ['name', 'description', 'sellerPrice', 'discountPercent'];
  editableFields.forEach((field) => {
    if (req.body[field] !== undefined) product[field] = req.body[field];
  });

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
    product.category = req.body.category;
  }

  const effectiveCategory = req.body.category || product.category.toString();

  // Only re-validate/replace attributes+variants if the seller actually sent them,
  // or changed category (in which case the old attributes may no longer apply).
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
    // simple (non-variant) products can just update stock directly
    product.stock = Number(req.body.stock);
  }

  // Wholesale-specific fields — only re-validated/applied when the seller actually
  // sent one of these keys, so a plain "just editing the description" PUT from a
  // wholesaler doesn't wipe out previously-saved tiers/delivery terms. Changing
  // deliveryType counts as a wholesale-key change too, since it flips which of
  // freeDelivery/deliveryCharge are even meaningful.
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

  // Keep the shop link in sync with the seller's CURRENT shop status on every
  // save — same "derive it silently, never trust the client" rule as creation.
  // Covers cases like: product was created before the shop got approved, or
  // the shop was later suspended.
  const approvedShop = await getApprovedShopForSeller(req.user._id);
  product.shop = approvedShop ? approvedShop._id : null;

  if (req.files && req.files.length > 0) {
    product.images = req.files.map((file) => file.path);
  }

  // Editing after rejection sends it back into the review queue as a draft
  // (seller still has to hit "Submit" — matches the normal draft flow).
  if (product.status === 'rejected') {
    product.status = 'draft';
    product.rejectionReason = '';
  }

  // Editing a LIVE product pulls it from the storefront immediately and sends it
  // straight back to admin's pending queue — no separate "submit" step, since the
  // seller already made an explicit decision to change something that's selling.
  if (wasLive) {
    product.status = 'pending_review';
    product.reviewedBy = null;
    product.reviewedAt = null;
  }

  await product.save();

  const populated = await Product.findById(product._id)
    .populate('category', 'name slug')
    .populate('attributes.attribute', 'name slug type unit')
    .populate('shop', 'shopName slug status')
    .populate('variants');

  res.json({ success: true, product: populated });

  // A previously-live product just went back to pending_review — admins need to know.
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
    sellerRole, // 'wholesaler' | 'retailer' — lets the storefront show "Wholesale" sections
    freeDelivery, // 'true' — powers the "Free Delivery Wholesale Products" section
    shop, // shop id — lets a shop's own storefront page filter to just its products
  } = req.query;

  const filter = { status: 'active', isActive: true, finalPrice: { $ne: null } };

  // Widen a category filter to include every descendant category too — see
  // getCategoryAndDescendantIds() above for why (products only ever live on
  // LEAF categories, so an exact match on a parent/mid-level id would
  // otherwise return nothing). A leaf category id just resolves to a
  // single-element array, so this is a no-op change in behaviour for leaf
  // selections and only widens things for parent/mid-level selections.
  if (category) {
    const categoryIds = await getCategoryAndDescendantIds(category);
    filter.category = { $in: categoryIds };
  }

  if (hotDeals === 'true') filter.isHotDeal = true;
  if (sellerRole === 'wholesaler' || sellerRole === 'retailer') filter.sellerRole = sellerRole;
  if (shop) filter.shop = shop;
  if (freeDelivery === 'true') {
    // free delivery only ever applies to 'heavy' wholesale products — 'simple' ones
    // ship like retail and never carry the free-delivery tag.
    filter.sellerRole = 'wholesaler';
    filter.deliveryType = 'heavy';
    filter.freeDelivery = true;
  }

  // ---------------------------------------------------------------------
  // SEARCH — matches product name/description, the product's Brand/other
  // attribute values (e.g. "Nike"), AND the category name it belongs to
  // (e.g. typing "Electronics" or "Smartphones" surfaces every product
  // under that category, same as clicking it). Case-insensitive, partial
  // match on all three.
  //
  // Deliberately NOT using MongoDB's $text here: $text queries cannot be
  // nested inside an $or clause alongside other conditions, which is
  // exactly what's needed to search name + category + attributes together
  // in one query. A plain case-insensitive regex search across a modest
  // product catalog is simpler, combinable, and fast enough.
  // ---------------------------------------------------------------------
  if (search && search.trim()) {
    const searchRegex = new RegExp(escapeRegex(search.trim()), 'i');

    const searchOr = [
      { name: searchRegex },
      { description: searchRegex },
      { 'attributes.value': searchRegex },
    ];

    // Category-name match: find every category whose name matches, then widen
    // each to its full descendant set (same logic as the category filter above),
    // so e.g. searching "Electronics" also returns everything nested under it.
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

  // Optional attribute filtering, e.g. ?attributes={"<brandAttrId>":"Nike"}
  // Only filters product-level attributes; variant-level (Size/Color) filtering
  // is a follow-up once the storefront UI for it exists.
  if (attributes) {
    try {
      const attrFilter = JSON.parse(attributes);
      const conditions = Object.entries(attrFilter).map(([attrId, value]) => ({
        attributes: { $elemMatch: { attribute: attrId, value } },
      }));
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



/**
 * ADD THIS to backend/controllers/productController.js
 * -----------------------------------------------------------------------
 * Paste the function below anywhere among your other exported controllers
 * (e.g. right after getProductById), and add `getProductSuggestions` to
 * the module.exports list at the bottom of the file.
 *
 * Reuses the same escapeRegex() helper and 'active'/'isActive' filtering
 * your existing getProducts() already uses, just trimmed down to a fast,
 * small-payload response suited for calling on every keystroke.
 * -----------------------------------------------------------------------
 */

// @desc    Lightweight autocomplete suggestions for the search box —
//          matching product names + matching categories, capped small
//          so it's cheap enough to call on every keystroke (debounced
//          client-side).
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

// Then add getProductSuggestions to module.exports, e.g.:
//
// module.exports = {
//   createProduct,
//   updateProduct,
//   submitProductForReview,
//   getMyProducts,
//   deleteProduct,
//   getProducts,
//   getProductById,
//   getProductSuggestions,   // <-- add this line
//   trackProductViewCount,
//   getMyProductAnalytics,
// };



// ---------------- ANALYTICS ----------------

// @desc    Fire-and-forget: increments a product's lifetime view counter and logs
//          a timestamped row for the seller's trend chart. Called once per
//          product-detail-page load, for logged-in buyers and guests alike.
// @route   PATCH /api/products/:id/view
// @access  Public
const trackProductViewCount = asyncHandler(async (req, res) => {
  const product = await Product.findOneAndUpdate(
    { _id: req.params.id, status: 'active', isActive: true },
    { $inc: { viewCount: 1 } },
    { new: false }
  ).select('_id seller');

  if (product) {
    // Best-effort log — never let a logging failure affect the response.
    ProductView.create({
      product: product._id,
      seller: product.seller,
      viewer: req.user?._id || null,
    }).catch(() => {});
  }

  res.status(204).end();
});

// @desc    Seller's product-view analytics: lifetime + 14-day totals, a daily
//          trend (zero-filled so the frontend can draw a continuous chart),
//          and a per-product breakdown sorted by most-viewed first.
// @route   GET /api/products/analytics
// @access  Private (wholesaler, retailer)
const getMyProductAnalytics = asyncHandler(async (req, res) => {
  const products = await Product.find({ seller: req.user._id, isActive: true })
    .select('name images status viewCount createdAt')
    .sort('-viewCount');

  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - 13); // last 14 days including today

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
};