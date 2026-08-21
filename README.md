# Kaynova — E-commerce Website with Admin Panel, Razorpay & Consignment Tracking

A complete, self-hosted e-commerce web app built with **Node.js, Express, EJS, and SQLite**.

## Features

**Customer Storefront**
- Product listing with category filter & search
- Product detail pages
- Cart (persisted in browser localStorage)
- Checkout with **Razorpay** payment integration (test & live mode)
- Order confirmation page
- **Consignment/shipment tracking** — customers can look up any order by Order Number or Tracking Number and see a full status timeline
- **Phone OTP login** — customers log in with just their mobile number (no password). A 6-digit OTP is sent, verified server-side, and a session is created. Logged-in customers get a **"My Orders"** page showing all their past orders (matched by phone number), each with the full shipment timeline, plus an editable profile (name/email)

**Admin Panel** (`/admin/login`)
- Secure session-based login (bcrypt password hashing)
- Dashboard with sales stats (revenue, orders, pending shipments)
- Product management: add / edit / delete, image upload or image URL, stock & category management
- Order management: view every order, customer & payment details
- **Shipment/consignment tracking management**: update order status (placed → confirmed → packed → shipped → out for delivery → delivered / cancelled / returned), assign courier name & tracking number, and add timeline entries with location/notes — these appear instantly on the customer-facing tracking page

**Payments**
- Razorpay Orders API used to create an order server-side
- Razorpay Checkout.js opens the payment popup
- Payment signature is verified server-side with HMAC SHA256 before an order is marked "paid"
- Stock is decremented only after successful, verified payment

## Tech Stack
- Node.js + Express
- EJS templates (server-rendered, no separate frontend build needed)
- better-sqlite3 (file-based DB — zero setup, no external DB server required)
- express-session for admin auth
- bcryptjs for password hashing
- Razorpay Node SDK
- multer for product image uploads

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment variables
Copy the example file and fill in your details:
```bash
cp .env.example .env
```

Edit `.env`:
```
PORT=3000
SESSION_SECRET=some_long_random_string

RAZORPAY_KEY_ID=rzp_test_XXXXXXXXXXXX
RAZORPAY_KEY_SECRET=your_key_secret

ADMIN_USERNAME=admin
ADMIN_PASSWORD=Admin@12345
```

Get your Razorpay test keys from **Dashboard → Settings → API Keys** at https://dashboard.razorpay.com/app/keys (use test mode while developing — no real money moves).

### 3. Run the app
```bash
npm start
```

- Storefront: http://localhost:3000
- Admin panel: http://localhost:3000/admin/login (default credentials created automatically from your `.env` on first run — check the console output too)
- Track an order: http://localhost:3000/track

The SQLite database file is created automatically at `db/store.db` on first run, along with a default admin account and a few sample products, so you can try everything immediately.

## How the pieces fit together

### Checkout & Payment flow
1. Customer fills shipping details on `/checkout` and clicks "Pay with Razorpay".
2. Browser calls `POST /api/create-order` → server re-validates cart prices/stock, creates a Razorpay order via the SDK, and stores a `pending` order in the DB.
3. Razorpay Checkout popup opens using the returned `order_id`.
4. On success, Razorpay calls the `handler` callback with `razorpay_payment_id` and `razorpay_signature`.
5. Browser calls `POST /api/verify-payment` → server recomputes the HMAC signature and compares it. Only if it matches does the order get marked `paid`, stock gets decremented, and the first shipment timeline entry ("Order Confirmed") is created.

### Customer OTP Login flow
1. Customer enters their 10-digit mobile number at `/login`.
2. `POST /login/send-otp` generates a random 6-digit code, stores it in the `otp_codes` table with a 5-minute expiry, and calls `sendOtpSms()` (see `utils/sms.js`).
3. **By default, no real SMS is sent** — the OTP is printed to your server console (`📱 [DEV MODE] OTP for ...`), so you can test the whole flow for free. To send real SMS in production, open `utils/sms.js` and plug in a gateway like MSG91, Twilio, or Fast2SMS (example code is commented in that file) — nothing else in the app needs to change.
4. Customer enters the code; `POST /login/verify-otp` checks it against the DB (expiry, attempt limit of 5, one-time use). On success, a `customers` row is created if one didn't already exist for that phone number, and `req.session.customerId` is set.
5. Logged-in customers see "My Orders" (`/account/orders`) — every order placed with that phone number, matched automatically, no separate "link my order" step needed. They can also edit their name/email at `/account`.
6. Guest checkout still works exactly as before — login is optional, not required to place an order.

### Consignment Tracking flow
1. Every order has an `order_status` (placed/confirmed/packed/shipped/out_for_delivery/delivered/cancelled/returned), plus optional `courier_name` and `tracking_number`.
2. Every status change is also logged as a row in `shipment_updates` (status, location, note, timestamp) — this is the timeline shown to customers.
3. Admins update all of this from **Admin → Orders → (select order) → "Update Consignment / Shipment Status"**.
4. Customers see the same timeline at `/track` by entering their Order Number or Tracking Number — no login required.

## Going to production
- Switch Razorpay keys from `rzp_test_...` to your live keys once you complete Razorpay KYC/activation.
- Put the app behind HTTPS (e.g. via Nginx + Let's Encrypt, or a platform like Render/Railway/a VPS).
- Change `SESSION_SECRET` to a long random value and set `cookie.secure = true` in `server.js` once served over HTTPS.
- Consider adding a real Razorpay **webhook** endpoint as a backup confirmation path (in case a customer closes the browser right after paying but before the client-side verification call completes) — Razorpay webhooks docs: https://razorpay.com/docs/webhooks/
- Back up `db/store.db` regularly, or migrate to Postgres/MySQL for higher traffic (the SQL is intentionally simple to port).
- Add rate-limiting (e.g. `express-rate-limit`) on `/admin/login` and the tracking form to prevent brute-forcing.

## Project Structure
```
ecommerce-app/
├── server.js                 # App entry point
├── db/
│   └── database.js           # SQLite schema, seed data, default admin
├── middleware/
│   ├── auth.js                 # requireAdmin session guard
│   └── customerAuth.js         # requireCustomer session guard
├── utils/
│   └── sms.js                  # Pluggable OTP SMS sender (console in dev)
├── routes/
│   ├── store.js                # Public storefront routes
│   ├── api.js                  # Cart validation + Razorpay order/verify APIs
│   ├── admin.js                 # Admin auth, products CRUD, orders & tracking
│   └── customerAuth.js          # Customer OTP login/logout + account/order history
├── views/                     # EJS templates (storefront + admin)
├── public/
│   ├── css/style.css
│   └── uploads/                # Uploaded product images
└── .env.example
```
