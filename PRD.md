# MobileKhata Backend — Product Requirements Document (PRD)
# Version: 1.0 | Last Updated: June 2026
# Maintained by: AI + Developer

---

## 📌 Document Info

| Field | Value |
|---|---|
| Product | MobileKhata REST API Backend |
| Current Version | 1.0.0 |
| Platform | Node.js (Express.js) |
| Database | PostgreSQL (version 15+) |
| Auth Integration | Firebase Authentication (verifyIdToken) |
| File Storage | Local storage / Multer (uploads outside web root) |
| Backend Status | 🟢 Active |

---

## 1. 🎯 Product Vision

> **"Har MobileKhata app instance ka cloud brains — secure, fast, and multi-tenant."**

The MobileKhata Backend is a production-ready, secure REST API server designed to support the MobileKhata Android app. It serves as the single source of truth for shop configurations, features management, customer ledger history, devices catalog, and background sync push/pull routines. It handles critical server-side features like:
- **Offline Sync (Push/Pull):** Merging SQLite transaction data into PostgreSQL idempotently.
- **Role/Feature Gating:** Remote control of premium tiers, usage counters, and plans activation.
- **SaaS Readiness:** Multi-shop and multi-user segregation with Firebase Auth.
- **Audit Trails:** Immutable timeline events tracking the full purchase-to-sale lifecycle of any IMEI.

---

## 2. 🏛️ System Architecture

```
┌──────────────────────────────────────────────┐
│             MobileKhata Android App          │
│             (Room Database / Offline)        │
└──────────────────────┬───────────────────────┘
                       │ Retrofit Client (JWT Token Header)
                       ▼
┌──────────────────────────────────────────────┐
│            EXPRESS.JS MIDDLEWARE             │
│  - Helmet (headers protection)               │
│  - CORS / Compression                        │
│  - Rate Limiter (Global + Sync Strict)       │
│  - Firebase Auth Middleware (JWT Verify)     │
└──────────────────────┬───────────────────────┘
                       │ Validated Request
                       ▼
┌──────────────────────────────────────────────┐
│                 CONTROLLER LAYER             │
│  - Sync Controller (Push/Pull parser)        │
│  - Shop, Transaction, Stock Controllers      │
│  - Media Controller (Multer upload)          │
└──────────────────────┬───────────────────────┘
                       │ PostgreSQL Client Pool
                       ▼
┌──────────────────────────────────────────────┐
│              POSTGRESQL DATABASE             │
│  - Tables: shops, user_features, customers   │
│  - Tables: devices, transactions, media      │
│  - Views: current_stock, imei_lifecycle      │
└──────────────────────────────────────────────┘
```

---

## 3. 🗄️ Database Schema & Normalization

Unlike the flat structure of SQLite/Room on Android, the PostgreSQL schema is fully normalized to guarantee data integrity across transaction lifetimes.

```
shops (one row per registered Firebase UID)
  └── user_features (feature flags and freemium limits)
  └── customers (unique per mobile per shop)
  └── devices (unique per physical IMEI, reusable)
        └── transactions (Sale, Purchase, Repair entries)
             ├── transaction_media (secure Firebase upload reference)
             └── timeline_events (IMEI timeline audit trails)
  └── sync_log (audit trail of device synchronization history)
```

### Key Views
1. **`imei_lifecycle`:** Joins transactions, devices, and customers, showing the chronological ownership and movement chain of any IMEI (from Purchase to Sale to Repair).
2. **`current_stock`:** Displays devices currently in stock (meaning the last transaction for that IMEI was a `Purchase` and no `Sale` has occurred since).

---

## 4. 🔗 Core REST API Endpoints

All endpoints (except `/health` and `/api/v1/health`) require an `Authorization: Bearer <Firebase ID Token>` header.

### 4.1 Shop Profile & Configuration
* **`POST /api/v1/shop/setup`**
  - **Purpose:** Idempotent registration or profile updates for the shop.
  - **Process:** Creates/updates `shops` table row and ensures a default `user_features` record.
* **`GET /api/v1/shop/profile`**
  - **Purpose:** Fetch shop info (name, address, GSTIN, licence etc.).
* **`GET /api/v1/shop/stats`**
  - **Purpose:** Returns total sales amount (₹), purchase amount (₹), active stock count, customer count, and today's entries.

### 4.2 Feature Flags & Premium Plan
* **`GET /api/v1/shop/features`**
  - **Purpose:** Fetch capabilities (`canSell`, `canPurchase`, `canRepair`, `canReports`) and entry quotas.
* **`GET /api/v1/shop/plans`**
  - **Purpose:** Returns available pricing tiers and support contact information.

### 4.3 Transactions & Stock
* **`POST /api/v1/transactions`**
  - **Purpose:** Create a new transaction directly on the server.
  - **Process:** Performs device resolution, customer upsert, and transaction recording in a safe ACID database transaction.
* **`GET /api/v1/transactions`**
  - **Purpose:** List transactions with pagination and filters (`type`, `from`, `to` dates).
* **`GET /api/v1/transactions/:id`**
  - **Purpose:** View full transaction details including attached media items.
* **`DELETE /api/v1/transactions/by-android-id/:androidTxnId`**
  - **Purpose:** Delete a transaction by Android UUID (safely scoped to active shop).
* **`DELETE /api/v1/transactions/by-customer/:mobile`**
  - **Purpose:** Delete all transactions for a specific customer.
* **`GET /api/v1/stock`**
  - **Purpose:** List all devices currently in stock.
* **`GET /api/v1/stock/check/:imei`**
  - **Purpose:** Check if a specific IMEI is in stock.

### 4.4 IMEI Lifecycle
* **`GET /api/v1/imei/history/:imei`**
  - **Purpose:** Retrieves the full transaction chain/timeline of a specific IMEI.

### 4.5 Off-line Sync Integration
* **`POST /api/v1/sync/push`**
  - **Purpose:** Batch push from Android Room to PostgreSQL.
  - **Failsafe:** Rejects new entries if the shop is on the free tier and the transaction limits have been exceeded.
* **`GET /api/v1/sync/pull`**
  - **Purpose:** Pull server database updates since a specific timestamp to restore local Android data.

### 4.6 Media Uploads
* **`POST /api/v1/transactions/:txnId/media`**
  - **Purpose:** Multi-part file upload using Multer.
* **`GET /api/v1/media/:mediaId`**
  - **Purpose:** Securely serves files from the non-public directory.

---

## 5. ⚡ Security, Rate Limiting & Safety

1. **Authentication Token Verification:** Under the hood, `verifyFirebaseToken` parses Bearer tokens via Firebase Admin SDK. It maps Firebase `uid` to the local shop database identifier `shop_id`.
2. **Global Rate Limiter:** Restricted to 100 requests per 15 minutes globally per IP.
3. **Sync Rate Limiter:** Strictly restricted to 10 requests per minute to prevent sync looping or server load issues during background worker retries.
4. **Environment Controls:** Fails fast on startup in production if essential configuration like `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, or `DATABASE_URL` is missing.

---

## 6. 🛠️ Deployment & Operations

* **Server runner:** Run via PM2 using `ecosystem.config.js` to ensure zero-downtime clustering and auto-restart on crashes.
* **Reverse Proxy:** Hosted behind Nginx which handles gzip compression, SSL termination, and routes all `/api` traffic to port `3000`.
* **Database migrations:** Automated PostgreSQL migration runner using `npm run migrate`.

---

## 7. 🔮 Future Roadmap / Admin Panel Ideas

These ideas are planned for future backend & admin portal updates:
- **Premium Subscription & Plan Management:** Allow dropdown plan selection, subscription expiration dates, and quick WhatsApp text link for easy customer reminders.
- **Shop Deactivation/Suspension:** Add toggle buttons to easily mark a shop as inactive in the database to restrict access if needed.
- **KYC & Document Verification Gallery:** Review and verify uploaded customer Aadhaar and PAN cards directly on the admin dashboard.
- **Analytics & Data Visualizations:** Add Chart.js to visualize daily registration rates, active sync counts, and district-wise usage distributions.
- **Database Backup & Maintenance Utilities:** Button to trigger/download PostgreSQL dumps and a log clearing mechanism.
