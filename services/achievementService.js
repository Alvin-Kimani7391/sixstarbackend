const Agent = require('../models/Agent');
const Achievement = require('../models/Achievement');
const AgentAchievement = require('../models/AgentAchievement');
const { notifyAgent } = require('./notificationService');

// Static catalog (spec §65) — evaluated against the agent's own running
// stats every time checkAchievementsForAgent() is called (after a
// commission confirms, a referral converts, etc).
const ACHIEVEMENTS = [
  { key: 'first_buyer', name: 'First Buyer', icon: '🥇', description: 'Referred your first buyer', check: (a) => a.buyersReferred >= 1 },
  { key: 'first_seller', name: 'First Seller', icon: '🏪', description: 'Referred your first seller', check: (a) => a.sellersReferred >= 1 },
  { key: 'first_sale', name: 'First Sale', icon: '💰', description: 'Earned your first confirmed commission', check: (a) => a.totalCommission > 0 },
  { key: 'buyers_10', name: '10 Buyers', icon: '👥', description: 'Referred 10 buyers', check: (a) => a.buyersReferred >= 10 },
  { key: 'buyers_25', name: '25 Buyers', icon: '👥', description: 'Referred 25 buyers', check: (a) => a.buyersReferred >= 25 },
  { key: 'sellers_10', name: '10 Sellers', icon: '🏬', description: 'Referred 10 sellers', check: (a) => a.sellersReferred >= 10 },
  { key: 'sellers_50', name: '50 Sellers', icon: '🏬', description: 'Referred 50 sellers', check: (a) => a.sellersReferred >= 50 },
  { key: 'commission_10k', name: 'KES 10,000 Commission', icon: '💵', description: 'Earned KES 10,000 in confirmed commission', check: (a) => a.totalCommission >= 10000 },
  { key: 'commission_50k', name: 'KES 50,000 Commission', icon: '💵', description: 'Earned KES 50,000 in confirmed commission', check: (a) => a.totalCommission >= 50000 },
  { key: 'top_recruiter', name: 'Top Recruiter', icon: '🚀', description: 'Referred 100 buyers or sellers combined', check: (a) => a.buyersReferred + a.sellersReferred >= 100 },
];

async function checkAchievementsForAgent(agentId) {
  const agent = await Agent.findById(agentId);
  if (!agent) return [];

  const earnedKeys = new Set(
    (await AgentAchievement.find({ agent: agentId }).populate('achievement', 'key')).map((a) => a.achievement?.key)
  );

  const newlyEarned = [];

  for (const def of ACHIEVEMENTS) {
    if (earnedKeys.has(def.key)) continue;
    if (!def.check(agent)) continue;

    let achievementDoc = await Achievement.findOne({ key: def.key });
    if (!achievementDoc) {
      achievementDoc = await Achievement.create({ key: def.key, name: def.name, description: def.description, icon: def.icon });
    }

    await AgentAchievement.create({ agent: agentId, achievement: achievementDoc._id }).catch(() => {});
    newlyEarned.push(achievementDoc);

    notifyAgent(agentId, {
      type: 'achievement',
      title: `Achievement unlocked: ${achievementDoc.name}`,
      message: achievementDoc.description,
    });
  }

  return newlyEarned;
}

module.exports = { checkAchievementsForAgent, ACHIEVEMENTS };