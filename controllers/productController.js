const asyncHandler = require('express-async-handler');
const Product = require('../models/Product');
const ProductVariant = require('../models/ProductVariant');
const Category = require('../models/Category');
const { isLeafCategory, getCategoryAttributeDefs } = require('./categoryAttributeController');

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
// Wholesale-only validation: MOQ, quantity-based pricing tiers, and delivery
// terms. Only ever runs for sellers whose role is 'wholesaler' — retailers
// never see or send these fields, and the fields are reset to their defaults
// for them so nothing wholesale-specific leaks onto a retail product.
// ---------------------------------------------------------------------------
function validateAndPrepareWholesaleFields(role, body, currentSellerPrice) {
  if (role !== 'wholesaler') {
    // Retailers: force these back to defaults regardless of what was sent.
    return {
      minOrderQuantity: 1,
      pricingTiers: [],
      freeDelivery: false,
      deliveryCharge: { chargeType: 'fixed', amount: 0, perUnitAmount: 0, notes: '' },
    };
  }

  // --- MOQ ---
  let minOrderQuantity = 1;
  if (body.minOrderQuantity !== undefined && body.minOrderQuantity !== '') {
    minOrderQuantity = Number(body.minOrderQuantity);
    if (Number.isNaN(minOrderQuantity) || minOrderQuantity < 1) {
      const err = new Error('Minimum order quantity must be a whole number of 1 or more');
      err.status = 400;
      throw err;
    }
  }

  // --- Quantity-based pricing tiers ---
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

  // --- Delivery terms ---
  const freeDelivery = body.freeDelivery === true || body.freeDelivery === 'true';
  let deliveryCharge = { chargeType: 'fixed', amount: 0, perUnitAmount: 0, notes: '' };

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

  return { minOrderQuantity, pricingTiers, freeDelivery, deliveryCharge };
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

  const images = req.files.map((file) => file.path);

  const product = await Product.create({
    seller: req.user._id,
    sellerRole: req.user.role,
    name,
    description,
    images,
    category,
    stock: finalStock,
    sellerPrice,
    discountPercent: discountPercent || 0,
    status: 'draft',
    attributes: prepared.attributes,
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
    .populate('variants');

  res.status(201).json({ success: true, product: populated });
});

// @desc    Seller updates their own draft/rejected product
// @route   PUT /api/products/:id
// @access  Private (owner only)
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
  // wholesaler doesn't wipe out previously-saved tiers/delivery terms.
  const wholesaleKeysSent = ['minOrderQuantity', 'pricingTiers', 'freeDelivery', 'deliveryCharge'].some(
    (k) => req.body[k] !== undefined
  );
  if (wholesaleKeysSent) {
    let wholesale;
    try {
      wholesale = validateAndPrepareWholesaleFields(req.user.role, req.body);
    } catch (err) {
      res.status(err.status || 400);
      throw err;
    }
    product.minOrderQuantity = wholesale.minOrderQuantity;
    product.pricingTiers = wholesale.pricingTiers;
    product.freeDelivery = wholesale.freeDelivery;
    product.deliveryCharge = wholesale.deliveryCharge;
  }

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
    .populate('variants');

  res.json({ success: true, product: populated });
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
  } = req.query;

  const filter = { status: 'active', isActive: true, finalPrice: { $ne: null } };

  if (category) filter.category = category;
  if (hotDeals === 'true') filter.isHotDeal = true;
  if (sellerRole === 'wholesaler' || sellerRole === 'retailer') filter.sellerRole = sellerRole;
  if (freeDelivery === 'true') {
    filter.sellerRole = 'wholesaler';
    filter.freeDelivery = true;
  }
  if (search) filter.$text = { $search: search };
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
    .populate('attributes.attribute', 'name slug type unit')
    .populate({ path: 'variants', match: { isActive: true } });

  if (!product) {
    res.status(404);
    throw new Error('Product not found or not currently available');
  }

  res.json({ success: true, product });
});

module.exports = {
  createProduct,
  updateProduct,
  submitProductForReview,
  getMyProducts,
  deleteProduct,
  getProducts,
  getProductById,
};