/**
 * Identity-masking helpers for the RFQ / bidding / chat feature.
 *
 * Report section 12/13: public RFQs and chat participants must never see
 * each other's phone numbers, emails, or full names before a deal is
 * agreed on-platform. We show initials + a short, stable ID suffix instead
 * — enough for someone to recognise "the same seller I talked to
 * yesterday" without exposing anything they could be contacted through
 * off-platform.
 *
 * RULE OF THUMB: any controller response that goes to "the other party" in
 * an RFQ/bid/chat context should run the counterpart user through
 * maskIdentity() and must never spread the raw user document into the
 * response.
 */

function getInitials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getShortId(userId) {
  return String(userId).slice(-5).toUpperCase();
}

/**
 * Returns a masked identity object safe to send to the OTHER party in an
 * RFQ/bid/chat context.
 *
 * @param {object} user - a User document (or lean object) with at least
 *   _id, name, isVerified, and optionally businessName/shopName/location.
 * @param {'buyer'|'seller'} roleLabel
 */
function maskIdentity(user, roleLabel) {
  if (!user) return null;
  const label =
    roleLabel === 'buyer'
      ? `Verified Buyer #${getShortId(user._id)}`
      : `Seller ${getInitials(user.name)} #${getShortId(user._id)}`;

  return {
    id: user._id,
    label,
    initials: getInitials(user.name),
    isVerified: !!user.isVerified,
    // Only non-identifying business context — safe to show.
    businessName: user.businessName || user.shopName || undefined,
    location: user.location || undefined,
  };
}

module.exports = { getInitials, getShortId, maskIdentity };