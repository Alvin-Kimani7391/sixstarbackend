const mongoose = require('mongoose');
const { Schema } = mongoose;

// Definitions catalog — seeded lazily by achievementService the first time
// each key is checked, so there's no separate seed script to run.
const achievementSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    icon: { type: String, default: '🏆' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Achievement', achievementSchema);