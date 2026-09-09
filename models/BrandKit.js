const mongoose = require('mongoose');
const { Schema } = mongoose;

// Singleton document — admin's central Brand Kit (spec §20).
const brandKitSchema = new Schema(
  {
    logo: { type: String, default: '' },
    altLogo: { type: String, default: '' },
    primaryColor: { type: String, default: '#101d31' },
    secondaryColor: { type: String, default: '#c9791f' },
    fontFamily: { type: String, default: 'Arial, sans-serif' },
    siteName: { type: String, default: 'Six Star Suppliers' },
    siteUrl: { type: String, default: 'https://sixstarsuppliers.com' },
    contactEmail: { type: String, default: 'support@sixstarsuppliers.com' },
    contactPhone: { type: String, default: '' },
    socialAccounts: {
      facebook: { type: String, default: '' },
      instagram: { type: String, default: '' },
      tiktok: { type: String, default: '' },
      x: { type: String, default: '' },
      linkedin: { type: String, default: '' },
    },
    legalText: { type: String, default: '' },
    defaultCta: { type: String, default: 'Shop Now' },
  },
  { timestamps: true }
);

brandKitSchema.statics.getOrCreate = async function () {
  let kit = await this.findOne();
  if (!kit) kit = await this.create({});
  return kit;
};

module.exports = mongoose.model('BrandKit', brandKitSchema);