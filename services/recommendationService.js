const Product = require('../models/Product');

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toCard(p) {
  const price = p.discountPercent
    ? Math.round(p.finalPrice * (1 - p.discountPercent / 100))
    : p.finalPrice;
  return {
    id: p._id,
    name: p.name,
    image: (p.images && p.images[0]) || '',
    price,
    originalPrice: p.discountPercent ? p.finalPrice : null,
  };
}

// Builds a "Recommended for you" list for one subscriber, combining:
//   1. Products in the same categories as things they recently viewed
//   2. Products matching their recent search terms
//   3. A fallback of generally popular/hot-deal active products
// so the block is never empty even for a subscriber with thin history.
async function getRecommendedProducts(subscriber, limit = 4) {
  const excludeIds = (subscriber?.viewedProducts || []).map((v) => v.product);
  const picks = [];
  const seen = new Set();

  function addAll(products) {
    for (const p of products) {
      const id = String(p._id);
      if (seen.has(id)) continue;
      seen.add(id);
      picks.push(p);
      if (picks.length >= limit) return true;
    }
    return false;
  }

  // 1) Same categories as recently viewed products
  if (subscriber?.viewedProducts?.length) {
    const viewedIds = subscriber.viewedProducts.slice(0, 5).map((v) => v.product);
    const viewedDocs = await Product.find({ _id: { $in: viewedIds } }).select('category');
    const categoryIds = [...new Set(viewedDocs.map((d) => String(d.category)).filter(Boolean))];
    if (categoryIds.length) {
      const byCategory = await Product.find({
        status: 'active',
        isActive: true,
        finalPrice: { $ne: null },
        category: { $in: categoryIds },
        _id: { $nin: excludeIds },
      })
        .sort('-viewCount')
        .limit(limit * 2);
      if (addAll(byCategory)) return picks.map(toCard);
    }
  }

  // 2) Recent search terms
  if (subscriber?.searchHistory?.length) {
    const topTerms = subscriber.searchHistory.slice(0, 3);
    for (const t of topTerms) {
      if (picks.length >= limit) break;
      const regex = new RegExp(escapeRegex(t.term), 'i');
      const bySearch = await Product.find({
        status: 'active',
        isActive: true,
        finalPrice: { $ne: null },
        _id: { $nin: [...excludeIds, ...picks.map((p) => p._id)] },
        $or: [{ name: regex }, { description: regex }],
      })
        .sort('-viewCount')
        .limit(limit);
      if (addAll(bySearch)) return picks.map(toCard);
    }
  }

  // 3) Fallback — popular / hot deal actives
  if (picks.length < limit) {
    const fallback = await Product.find({
      status: 'active',
      isActive: true,
      finalPrice: { $ne: null },
      _id: { $nin: [...excludeIds, ...picks.map((p) => p._id)] },
    })
      .sort('-isHotDeal -viewCount')
      .limit(limit);
    addAll(fallback);
  }

  return picks.slice(0, limit).map(toCard);
}

module.exports = { getRecommendedProducts };