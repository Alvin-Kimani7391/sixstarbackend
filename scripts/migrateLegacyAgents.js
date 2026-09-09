// One-off migration: backfills email + a temp password onto any legacy
// Agent documents that predate the auth system (created back when email
// was optional). Safe to re-run — it skips agents that already have both.
//
// Usage:  node scripts/migrateLegacyAgents.js
require('dotenv').config();
const mongoose = require('mongoose');
const crypto = require('crypto');
const Agent = require('../models/Agent');
const sendEmail = require('../utils/sendEmail');
const { agentWelcomeTemplate } = require('../utils/emailTemplates');

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected. Scanning for legacy agents missing email/password...');

  // Agents with no email, or a blank email that would collide on the new
  // unique index (Mongo unique indexes tolerate exactly ONE null/missing,
  // not multiple blanks, so every blank one needs a real placeholder).
  const legacyAgents = await Agent.find({
    $or: [{ email: { $exists: false } }, { email: '' }, { email: null }],
  });

  console.log(`Found ${legacyAgents.length} legacy agent(s) to backfill.`);

  for (const agent of legacyAgents) {
    const placeholderEmail = `${agent.code.toLowerCase()}@placeholder.sixstarsuppliers.com`;
    const tempPassword = crypto.randomBytes(5).toString('hex');

    agent.email = placeholderEmail;
    agent.password = tempPassword; // pre-save hook hashes it
    agent.agentType = agent.agentType || 'admin_created';
    if (!agent.status || agent.status === 'pending') {
      // Legacy agents were already usable in production (isActive was
      // presumably true) — carry that forward as 'active' rather than
      // dropping them back into the application queue.
      agent.status = agent.isActive ? 'active' : 'pending';
    }

    await agent.save();

    console.log(
      `  ${agent.code}: set placeholder email ${placeholderEmail}, temp password ${tempPassword} (status: ${agent.status})`
    );
  }

  console.log('Done. IMPORTANT: these agents have PLACEHOLDER emails — they cannot receive');
  console.log('login/reset emails until you (or they) update to a real email address via');
  console.log('PATCH /api/agents/me or the admin panel. Consider emailing/calling each of');
  console.log('them individually with their temp password and asking them to update it.');

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});