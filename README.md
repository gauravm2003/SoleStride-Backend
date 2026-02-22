# SoleMate Backend API

Custom Express backend for auth, users, admin, products, orders, reviews, wishlist, and contact flows.

## Run

1. Create env file:
   - Copy `.env.example` to `.env`
2. Install:
   - `npm install`
3. Migrate DB:
   - `npm run migrate`
4. Start server:
   - `npm run dev`

## Key Routes

- `POST /api/auth/register` (creates account, sends verification link email)
- `GET /api/auth/verify-email-link?token=...` (verifies email and redirects to frontend)
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `GET /api/auth/me`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`

- `GET /api/public/products`
- `GET /api/public/products/:productId`
- `GET /api/public/products/:productId/reviews`
- `POST /api/public/contact`

- `GET /api/user/wishlist` / `POST /api/user/wishlist` / `DELETE /api/user/wishlist/:productId`
- `GET /api/user/orders` / `POST /api/user/orders`
- `POST /api/user/reviews`

- `GET /api/admin/stats`
- `GET /api/admin/orders`
- `GET/POST/PATCH/DELETE /api/admin/products`
- `POST /api/admin/upload/product-image`

## Environment

Required variables are in `.env.example`.

Important:
- Use real DB credentials.
- For Supabase Postgres, set `DB_SSL=true`.
- Set `CORS_ORIGIN` to frontend origin.
- Configure SMTP/Gmail env values for email delivery.

## Notes

- Register does not auto-login; user must verify via email link and then login.
- Uploaded product images are served from `/uploads/products/*`.
- Migrations live in `src/database/migrations/` and are run in filename order.
