const EmailSubscriber = require('../models/EmailSubscriber');

// Finds a subscriber by email, or by guestId (pre-capture anonymous
// activity), or creates a brand-new record. If both an existing guestId
// record AND the email are provided and they differ, the guest record is
// merged into the email record so no browsing history is lost.
async function getOrCreateSubscriber({ email, guestId, name, source, userId, role }) {
  email = (email || '').trim().toLowerCase();

  let byEmail = email ? await EmailSubscriber.findOne({ email }) : null;
  let byGuest = guestId ? await EmailSubscriber.findOne({ guestId }) : null;

  if (byEmail && byGuest && String(byEmail._id) !== String(byGuest._id)) {
    // Merge the anonymous guest history into the now-identified email record.
    byGuest.searchHistory.forEach((s) => byEmail.recordSearch(s.term));
    byGuest.viewedProducts.forEach((v) => byEmail.recordView(v.product));
    await byEmail.save();
    await EmailSubscriber.deleteOne({ _id: byGuest._id });
    byGuest = null;
  }

  let subscriber = byEmail || byGuest;

  if (!subscriber) {
    if (!email && !guestId) return null;
    subscriber = await EmailSubscriber.create({
      email: email || `guest-${guestId}@no-email.local`,
      guestId: guestId || null,
      name: name || '',
      source: source || 'guest_capture',
      userId: userId || null,
      role: role || 'guest',
    });
    return subscriber;
  }

  let changed = false;
  if (email && subscriber.email !== email) {
    subscriber.email = email;
    changed = true;
  }
  if (guestId && !subscriber.guestId) {
    subscriber.guestId = guestId;
    changed = true;
  }
  if (name && !subscriber.name) {
    subscriber.name = name;
    changed = true;
  }
  if (userId && !subscriber.userId) {
    subscriber.userId = userId;
    subscriber.role = role || subscriber.role;
    subscriber.source = source || 'registration';
    changed = true;
  }
  if (changed) await subscriber.save();
  return subscriber;
}

// Used by the campaign engine: every recipient (even ones sourced live from
// the User collection, e.g. "all buyers") gets/keeps exactly one subscriber
// record so unsubscribe + open/click tracking always has somewhere to live.
async function ensureSubscriberForRecipient({ email, name, userId, role }) {
  return getOrCreateSubscriber({ email, name, userId, role, source: userId ? 'registration' : 'manual_import' });
}

async function recordSearch({ email, guestId, term }) {
  const subscriber = await getOrCreateSubscriber({ email, guestId });
  if (!subscriber) return null;
  subscriber.recordSearch(term);
  await subscriber.save();
  return subscriber;
}

async function recordView({ email, guestId, productId }) {
  const subscriber = await getOrCreateSubscriber({ email, guestId });
  if (!subscriber) return null;
  subscriber.recordView(productId);
  await subscriber.save();
  return subscriber;
}

async function unsubscribeByToken(token) {
  const subscriber = await EmailSubscriber.findOne({ unsubscribeToken: token });
  if (!subscriber) return null;
  subscriber.status = 'unsubscribed';
  subscriber.unsubscribedAt = new Date();
  await subscriber.save();
  return subscriber;
}

module.exports = {
  getOrCreateSubscriber,
  ensureSubscriberForRecipient,
  recordSearch,
  recordView,
  unsubscribeByToken,
};