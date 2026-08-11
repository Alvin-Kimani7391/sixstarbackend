process.env.TZ = 'Africa/Nairobi';

const express = require('express');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const { notFound, errorHandler } = require('./middleware/errorMiddleware');

dotenv.config();

const app = express();

// --- Core middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// CORS: must allow credentialssdfsfddddd so the httpOnly auth cookie works across
// your Vercel frontend <-> Render backend (different domains).
// Uses a function (not a static string) so local dev, your production
// CLIENT_URL, and any Vercel/Render preview-deploy URL all work without edits.
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://www.sixstarsuppliers.com',
  'https://sixstarsuppliers.com',
  process.env.CLIENT_URL,
].filter(Boolean);

app.use(
  cors({
    origin: function (origin, callback) {
      // no origin = server-to-server, curl, mobile apps -> allow
      if (!origin) return callback(null, true);
      if (
        allowedOrigins.includes(origin) ||
        origin.endsWith('.vercel.app') || // Vercel production + preview deploys
        origin.endsWith('.onrender.com') // Render preview deploys
      ) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);

if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// --- Routes ---
app.get('/api/health', (req, res) => res.json({ success: true, message: 'API is running' }));
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/products', require('./routes/productRoutes'));
app.use('/api/categories', require('./routes/categoryRoutes'));
app.use('/api/orders', require('./routes/orderRoutes'));
app.use('/api/reviews', require('./routes/reviewRoutes'));
app.use('/api/ads', require('./routes/adRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/agents', require('./routes/agentRoutes'));
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/shops', require('./routes/shopRoutes'));
app.use('/api/shop-reviews', require('./routes/shopReviewRoutes'));
app.use('/api/seller-verification', require('./routes/sellerVerificationRoutes'));
app.use('/api/seller-profile', require('./routes/sellerProfileRoutes'));
app.use('/api/flash-sales', require('./routes/flashSaleRoutes'));
app.use('/', require('./routes/seoRoutes'));
app.use('/', require('./routes/merchantFeed.route'));

app.set('trust proxy', 1);
app.use('/api/legal-documents', require('./routes/legalDocumentRoutes'));

// --- Error handling (must be last) ---
app.use(notFound);
app.use(errorHandler);

// --- DATABASE & START ---
// The server only starts listening once MongoDB is actually connected, so you
// never get a "server is up" log while the DB is silently unreachable.
const PORT = process.env.PORT || 5000;

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log('MongoDB connected');
    app.listen(PORT, () => {
      console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  });