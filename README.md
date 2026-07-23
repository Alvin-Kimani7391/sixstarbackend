# IVH Marketplace — Backend

Multi-vendor marketplace API: wholesalers + retailers + buyers on one platform,
with an admin price-approval gate before any product goes live.

## Stack
Express + MongoDB (Mongoose) + JWT auth (httpOnly cookie) + Cloudinary (images) + Multer

## 1. Local setup

```bash
cd backend
npm install
cp .env.example .env   # then fill in real values
npm run dev
```

You need:
- A MongoDB Atlas connection string (`MONGO_URI`)
- A Cloudinary account — free tier is fine (`CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET`).
  **Do not store uploaded images on Render's local disk** — it's wiped on every
  redeploy/restart. Cloudinary (or S3) is required, not optional.
- A random long string for `JWT_SECRET`

## 2. Deploying to Render

1. Push this `backend/` folder to its own GitHub repo (or a subfolder — set Render's
   "Root Directory" to `backend` if it's part of a monorepo).
2. New Web Service on Render → connect the repo.
3. Build command: `npm install` — Start command: `npm start`
4. Add all `.env.example` variables as Environment Variables in Render's dashboard.
   Set `NODE_ENV=production` and `CLIENT_URL` to your exact Vercel URL (no trailing slash).
5. Once deployed, note your Render URL, e.g. `https://ivh-backend.onrender.com` —
   the frontend will call `https://ivh-backend.onrender.com/api/...`.

**Important CORS/cookie note:** because Vercel and Render are different domains,
the auth cookie is set with `sameSite: 'none'; secure: true` in production (already
handled in `utils/generateToken.js`). Your frontend's fetch/axios calls must include
`credentials: 'include'` or the cookie won't be sent/stored.

## 3. Core data model

- **User** (base) → discriminators: `wholesaler`, `retailer`, `buyer`, `admin` — one
  `users` collection, shared auth logic, role-specific fields.
- **Product** — belongs to a wholesaler/retailer. Lifecycle:
  `draft` → (seller submits) → `pending_review` → (admin sets `finalPrice` + approves) → `active`
  Admin can also `reject` (with reason, seller can edit and resubmit) or `suspend` a live product.
  Only `active` products with a `finalPrice` are ever returned by the public storefront endpoints.
- **Category** — admin-managed, supports nesting via `parentCategory`.
- **Review** — one per buyer per product, only after a confirmed purchase.
  Product's `ratingsAverage`/`ratingsCount` auto-recalculate via a post-save hook.
- **Order** — buyer pastes the raw M-Pesa SMS into `mpesaMessage`; a transaction code
  is auto-extracted where possible. `paymentStatus` starts `pending_verification` until
  admin manually cross-checks it against the till/paybill statement.
- **Ad** — admin-only banners/ads by placement (`homepage_hero`, `sidebar`, etc.),
  used for both your own promotions and paid third-party brand placements.

## 4. Key API routes

| Method | Route | Access | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | Public | body includes `role`: wholesaler/retailer/buyer |
| POST | `/api/auth/login` | Public | sets auth cookie |
| GET | `/api/products` | Public | storefront, filters: category, search, minPrice, maxPrice, hotDeals, sort, page |
| GET | `/api/products/my-products` | wholesaler/retailer | seller's own products, any status |
| POST | `/api/products` | wholesaler/retailer | multipart form, field `images` (up to 8) |
| PATCH | `/api/products/:id/submit` | owner | draft → pending_review |
| GET | `/api/admin/products/pending` | admin | review queue |
| PATCH | `/api/admin/products/:id/approve` | admin | body: `finalPrice`, optional `discountPercent`, `isHotDeal` |
| PATCH | `/api/admin/products/:id/reject` | admin | body: `reason` |
| POST | `/api/orders` | buyer | body: `items[]`, `shippingAddress`, `mpesaMessage` |
| GET | `/api/admin/orders/pending-payment` | admin | M-Pesa verification queue |
| PATCH | `/api/admin/orders/:id/verify-payment` | admin | body: `decision`: confirmed/rejected |
| POST | `/api/products/:productId/reviews` | buyer | requires a confirmed order for that product |
| GET | `/api/ads?placement=homepage_hero` | Public | active ads for a placement |
| POST | `/api/ads` | admin | multipart, field `image` |
| GET/POST | `/api/categories` | Public / admin | |

## 5. What's intentionally NOT included yet (next steps)

- Real M-Pesa API (Daraja/STK Push) integration — currently manual-paste + manual admin verification, by design, to launch faster
- Email/SMS notifications (order confirmed, product approved, etc.)
- Search relevance beyond MongoDB `$text` (consider Atlas Search or Algolia later)
- Rate limiting / helmet security headers — add `express-rate-limit` and `helmet` before going fully live
- Wallet/payout logic for paying wholesalers & retailers their share
