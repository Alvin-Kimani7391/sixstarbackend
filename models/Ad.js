const mongoose = require('mongoose');
const { Schema } = mongoose;

const adSchema = new Schema(
  {
    title: { type: String, required: true },
    image: { type: String, required: true }, // Cloudinary URL
    linkUrl: { type: String, default: '' }, // where clicking the ad goes
    placement: {
      type: String,
      enum: ['homepage_hero', 'homepage_banner', 'sidebar', 'category_top', 'checkout_page'],
      required: true,
    },
    brandName: { type: String, default: '' }, // for third-party paid ads
    isActive: { type: Boolean, default: true },
    startDate: { type: Date, default: Date.now },
    endDate: { type: Date, default: null }, // null = runs indefinitely
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }, // always admin
    clickCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

adSchema.index({ placement: 1, isActive: 1 });

module.exports = mongoose.model('Ad', adSchema);
