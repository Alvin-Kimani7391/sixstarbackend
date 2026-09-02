const Product = require('../models/Product');
const WeightTier = require('../models/WeightTier');
const ShippingCriteria = require('../models/ShippingCriteria');
const { resolveCategoryShippingType } = require('../controllers/categoryController');

// ============================================================
// DYNAMIC SHIPPING FEE CALCULATOR
// ------------------------------------------------------------
// The single source of truth for pricing shipping across the whole
// platform — called by BOTH the public checkout "live quote" endpoint
// (POST /api/shipping/quote) AND (once wired) the authoritative,
// server-side recompute inside orderController.createOrder. Never trust
// a client-sent shipping fee — always recompute here at order time.
//
// RULES (all dynamic, all resolved live — nothing is snapshotted/stale):
//
//  1. Any line whose product is sold by a wholesaler with
//     deliveryType === 'heavy' (their own transport terms) is COMPLETELY
//     EXCLUDED from this calculation — exactly like the old standard
//     Transport fee excluded them. Their own delivery-fee logic
//     (free / fixed / quantity-based / negotiated) is untouched and
//     computed separately by existing wholesale-delivery code.
//
//  2. Every remaining line's EFFECTIVE shipping classification is
//     re-resolved LIVE from its category (resolveCategoryShippingType),
//     never trusted from Product.shippingType alone — if an admin
//     re-specializes a category, every product under it must reflect
//     that on the very next quote, not just future saves.
//
//  3. 'normal' lines: weightKg * quantity is summed across ALL normal
//     lines in the cart into ONE total, which is matched against exactly
//     ONE active WeightTier -> ONE flat fee for that whole bucket.
//
//  4. 'special' lines: each line's selected ShippingCriteria option
//     price(s) * quantity are summed PER LINE and added independently —
//     these do NOT pool together like weight does, since each special
//     item has its own individually-priced handling requirement.
//
//  5. Total shipping fee the buyer pays = normal-tier price + sum of all
//     special-item fees. There is no separate "standard transport" fee
//     anymore — this number replaces it entirely for non-heavy-wholesale
//     items.
// ============================================================

/**
 * @param {Array<{ productId: string, quantity: number }>} lines
 * @returns {Promise<{
 *   standardShippingFee: number,
 *   normalWeightTotalKg: number,
 *   normalTierApplied: { id: string, label: string, weightFrom: number, weightTo: number|null, price: number } | null,
 *   specialItemsFee: number,
 *   specialBreakdown: Array<{ productId: string, productName: string, criteriaName: string, optionLabel: string, unitPrice: number, quantity: number, lineTotal: number }>,
 *   excludedHeavyWholesaleProductIds: string[],
 *   warnings: string[],
 * }>}
 */
async function calculateDynamicShippingFee(lines) {
  const warnings = [];
  let normalWeightTotalKg = 0;
  let specialItemsFee = 0;
  const specialBreakdown = [];
  const excludedHeavyWholesaleProductIds = [];

  if (!Array.isArray(lines) || lines.length === 0) {
    return {
      standardShippingFee: 0,
      normalWeightTotalKg: 0,
      normalTierApplied: null,
      specialItemsFee: 0,
      specialBreakdown: [],
      excludedHeavyWholesaleProductIds: [],
      warnings: [],
    };
  }

  for (const line of lines) {
    if (!line || !line.productId) continue;

    const product = await Product.findById(line.productId).select(
      'sellerRole deliveryType weightKg shippingType shippingCriteriaSelections category name isActive status'
    );

    if (!product) {
      warnings.push(`A product in your cart is no longer available and was excluded from the shipping quote.`);
      continue;
    }

    const qty = Math.max(1, Number(line.quantity) || 1);

    // RULE 1 — self-delivering wholesalers are never part of this system.
    const isHeavyWholesale = product.sellerRole === 'wholesaler' && product.deliveryType === 'heavy';
    if (isHeavyWholesale) {
      excludedHeavyWholesaleProductIds.push(String(product._id));
      continue;
    }

    // RULE 2 — always re-resolve live from the category, never trust the snapshot.
    const { shippingType } = await resolveCategoryShippingType(product.category);

    if (shippingType === 'normal') {
      const weight = Number(product.weightKg);
      if (!weight || weight <= 0) {
        warnings.push(
          `"${product.name}" has no shipping weight configured — it is being treated as 0kg. Please ask the seller to update it.`
        );
      } else {
        normalWeightTotalKg += weight * qty;
      }
    } else {
      // 'special'
      if (!product.shippingCriteriaSelections || product.shippingCriteriaSelections.length === 0) {
        warnings.push(
          `"${product.name}" requires special shipping details that haven't been set — it is contributing KSh 0 to shipping. Please ask the seller to update it.`
        );
        continue;
      }

      for (const sel of product.shippingCriteriaSelections) {
        const group = await ShippingCriteria.findById(sel.criteria).select('name options isActive');
        if (!group || !group.isActive) {
          warnings.push(`A shipping option for "${product.name}" is no longer available and was skipped.`);
          continue;
        }
        const option = group.options.id(sel.option);
        if (!option || !option.isActive) {
          warnings.push(`A shipping option for "${product.name}" is no longer available and was skipped.`);
          continue;
        }

        const lineTotal = option.price * qty;
        specialItemsFee += lineTotal;
        specialBreakdown.push({
          productId: String(product._id),
          productName: product.name,
          criteriaName: group.name,
          optionLabel: option.label,
          unitPrice: option.price,
          quantity: qty,
          lineTotal,
        });
      }
    }
  }

  let normalTierApplied = null;
  let normalTierPrice = 0;

  if (normalWeightTotalKg > 0) {
    const tiers = await WeightTier.find({ isActive: true }).sort('weightFrom');
    const match = tiers.find(
      (t) => normalWeightTotalKg >= t.weightFrom && (t.weightTo == null || normalWeightTotalKg <= t.weightTo)
    );
    if (match) {
      normalTierApplied = {
        id: String(match._id),
        label: match.label,
        weightFrom: match.weightFrom,
        weightTo: match.weightTo,
        price: match.price,
      };
      normalTierPrice = match.price;
    } else {
      warnings.push(
        `No shipping weight tier is configured that covers ${normalWeightTotalKg.toFixed(
          2
        )}kg — the weight-based portion of shipping is KSh 0. Please add a matching tier in admin.`
      );
    }
  }

  return {
    standardShippingFee: normalTierPrice + specialItemsFee,
    normalWeightTotalKg,
    normalTierApplied,
    specialItemsFee,
    specialBreakdown,
    excludedHeavyWholesaleProductIds,
    warnings,
  };
}

module.exports = { calculateDynamicShippingFee };