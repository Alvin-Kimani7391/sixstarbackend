const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../config/cloudinary');

// Images are streamed straight to Cloudinary, never saved to Render's local disk
// (Render's filesystem is ephemeral - anything written locally disappears on redeploy/restart)
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'ivh-marketplace/products',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 1200, height: 1200, crop: 'limit' }],
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB per image
});

// For products: up to 8 images, field name "images"
const uploadProductImages = upload.array('images', 8);

// For single images: ads, avatars, category thumbnails
const uploadSingleImage = upload.single('image');

// ---------------------------------------------------------------------------
// Shops: separate Cloudinary storage/folder so shop branding assets don't mix
// with product photos. Two named fields at once (logo + banner), both optional,
// both single-file.
// ---------------------------------------------------------------------------
const shopStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'ivh-marketplace/shops',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 1600, height: 1600, crop: 'limit' }],
  },
});

const uploadShop = multer({
  storage: shopStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB per image
});

// For shop create/edit: optional logo + optional banner in one multipart request
const uploadShopImages = uploadShop.fields([
  { name: 'logo', maxCount: 1 },
  { name: 'banner', maxCount: 1 },
]);

module.exports = { uploadProductImages, uploadSingleImage, uploadShopImages };