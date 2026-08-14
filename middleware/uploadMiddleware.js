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

// ---------------------------------------------------------------------------
// Seller verification docs: separate folder, PDFs allowed (registration certs,
// CR12 etc. are often scanned as PDF), several optional single-file fields.
//
// NOTE: no resource_type set here on purpose — Cloudinary defaults to 'image',
// and PDFs delivered as 'image' resource type get the correct file extension
// and content-type appended automatically, so they open/preview correctly in
// a browser tab. This is why these have always worked fine.
//
// Extended for the dynamic onboarding wizard: county business permit
// (businessLicenseDoc, optional) and store branding (storeLogo / storeBanner,
// both optional) now ride along in the same multipart request as the rest of
// the verification docs, so the wizard can submit everything in one POST.
// ---------------------------------------------------------------------------
const verificationStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'ivh-marketplace/verification',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'pdf'],
    transformation: [{ width: 1600, height: 1600, crop: 'limit' }],
  },
});

const uploadVerification = multer({
  storage: verificationStorage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB — some scanned PDFs run larger
});

const uploadVerificationDocs = uploadVerification.fields([
  { name: 'idFrontImage', maxCount: 1 },
  { name: 'idBackImage', maxCount: 1 },
  { name: 'selfieWithId', maxCount: 1 },
  { name: 'kraPinCertificate', maxCount: 1 },
  { name: 'vatCertificate', maxCount: 1 },
  { name: 'registrationCertificate', maxCount: 1 },
  { name: 'cr12Document', maxCount: 1 },
  { name: 'partnershipAgreement', maxCount: 1 },
  { name: 'businessLicenseDoc', maxCount: 1 }, // county business permit — optional
  { name: 'storeLogo', maxCount: 1 }, // store profile branding — optional
  { name: 'storeBanner', maxCount: 1 }, // store profile branding — optional
]);

// ---------------------------------------------------------------------------
// Legal documents (Terms, Seller Agreement, policies): PDF only.
//
// FIX: this previously used `resource_type: 'raw'`, which is what was
// breaking document viewing. Raw delivery on Cloudinary doesn't reliably
// carry the .pdf extension or a correct Content-Type through to the final
// URL, so browsers either failed to render it inline or downloaded a file
// with no extension. Switching to 'auto' lets Cloudinary treat the PDF as
// image-deliverable content (same as verificationStorage above), which
// preserves the extension/content-type and opens correctly in a new tab.
// ---------------------------------------------------------------------------
const legalDocStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'ivh-marketplace/legal',
    allowed_formats: ['pdf'],
    resource_type: 'auto',
  },
});

const uploadLegalDoc = multer({
  storage: legalDocStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
});

const uploadLegalDocument = uploadLegalDoc.single('file');

// ---------------------------------------------------------------------------
// RFQ product photo: ONE image, attached when a buyer creates a Request for
// Quote (report section 2 — "product image"). Separate folder so these
// don't mix with actual marketplace product photos.
// ---------------------------------------------------------------------------
const rfqStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'six-star-suppliers/rfq',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 1200, height: 1200, crop: 'limit' }],
  },
});

const uploadRFQ = multer({
  storage: rfqStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

const uploadRFQImage = uploadRFQ.single('productImage');

// ---------------------------------------------------------------------------
// RFQ chat image attachments: sent inline in the private buyer<->seller
// conversation on an RFQ. Kept smaller (3MB) and in its own folder since
// these are casual in-chat photos, not storefront-quality product shots.
// ---------------------------------------------------------------------------
const rfqChatStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'six-star-suppliers/rfq-chat',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 1000, height: 1000, crop: 'limit' }],
  },
});

const uploadRFQChat = multer({
  storage: rfqChatStorage,
  limits: { fileSize: 3 * 1024 * 1024 }, // 3MB
});

const uploadRFQChatImage = uploadRFQChat.single('image');

module.exports = {
  uploadProductImages,
  uploadSingleImage,
  uploadShopImages,
  uploadVerificationDocs,
  uploadLegalDocument,
  uploadRFQImage,
  uploadRFQChatImage,
};