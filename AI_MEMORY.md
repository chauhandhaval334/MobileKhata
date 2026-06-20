# MobileKhata Backend — AI Context Memory File
# ===============================================
# Ye file AI agents ke liye hai taaki wo backend project ko bina explore kiye
# instantly samajh sake. Har session mein is file ko refer karo.
# Last Updated: June 2026

---

## 🧠 PROJECT IDENTITY

- **App Name:** MobileKhata Backend API
- **Stack:** Node.js + Express.js + PostgreSQL
- **Database Model:** Normalized Relational Database (SaaS-Ready)
- **Auth Provider:** Firebase Admin SDK (Token verification)
- **File Upload Handler:** Multer (local disk storage outside public web root)
- **Logging System:** Winston + Morgan (http logging)
- **Repo Path:** `C:\Users\dhava\Documents\mobilekhata-backend`
- **Node Engine:** >=18.0.0

---

## 🔑 CRITICAL FILES TO KNOW FIRST

When working on ANY backend task, read these files first:

| Priority | File | Why |
|---|---|---|
| 📄 Start Here | `PRD.md` (project root) | Full system design, features, and API endpoints mapping |
| 📄 Start Here | `AI_MEMORY.md` (project root) | Technical architecture overview — this file |
| 🔴 Must | `src/database/schema.sql` | Postgres schema: tables, views (`current_stock`, `imei_lifecycle`), triggers |
| 🔴 Must | `src/controllers/syncController.js` | Critical Android synchronization logic (Push & Pull handler) |
| 🔴 Must | `src/middleware/auth.js` | Firebase Bearer verification, req.shop loading, requireAdmin logic |
| 🔴 Must | `src/config/database.js` | DB Client connection pooling, transactions helper (`withTransaction`) |
| 🟡 Often | `src/controllers/transactionController.js`| CRUD logic for Sales, Purchases, and Repair entries |
| 🟡 Often | `src/config/env.js` | Centralized environment configurations validator |
| 🟡 Often | `src/app.js` | Express app initialization, rate limiters, route registrations |
| 🟢 Context | `src/server.js` | Startup entrypoint, database check, graceful server shutdown |

---

## 🗺️ ROUTE REGISTRATIONS MAP

Base Endpoint path: `/api/v1`

```
app.js (Route bindings)
 ├─→ /health                    → Server simple heartbeat (Public)
 ├─→ /api/v1/db-status          → Debug database tables checklist (Public)
 ├─→ /api/v1/shop               → Shop setups, profile fetching, stats
 ├─→ /api/v1/transactions       → Create/Retrieve/Delete Purchases & Sales, IMEI tracking
 ├─→ /api/v1/stock              → Get current stock view and IMEI inventory availability check
 ├─→ /api/v1/customers          → List customer records, customer profile history lookup
 ├─→ /api/v1/media              → Transaction documents upload & serve
 ├─→ /api/v1/reports            → Summary & daily reports range math
 ├─→ /api/v1/imei               → IMEI lifecycle histories
 ├─→ /api/v1/sync               → Mobile push/pull endpoints (Strict rate limiter)
 └─→ /api/v1/admin              → Admin-only feature-flag override settings
```

---

## 🗄️ DATABASE HIGHLIGHTS (PostgreSQL)

The Postgres implementation uses relational integrity constraints unlike SQLite:

* **`shops` table:** Linked by `firebase_uid`. Stores user's shops metadata.
* **`user_features` table:** Governs freemium limits. If user has no active features row, they fall back to a 3-entry limit.
* **`customers` table:** Unique constraint is set on `(shop_id, mobile)`. Ensures customer information is reused and stored cleanly per shop owner.
* **`devices` table:** Tracked by `imei1` and `imei2`. Multi-lifecycle entries are allowed because device ownership can transition (Purchase -> Sale -> Re-Purchase).
* **`transactions` table:** Includes `android_txn_id` and has a `UNIQUE (shop_id, android_txn_id)` constraint. This prevents duplicate synchronization pushes from Android's WorkManager database retry operations.
* **`transaction_media` table:** Maps to files on the server or Firebase download URLs. Files are stored in `uploads/` which resides outside the web root directory for security.

### Views logic:
- **`current_stock`:** Devices whose latest transaction is `Purchase` and does not have any succeeding transaction of type `Sale` associated with the device UUID.
- **`imei_lifecycle`:** Joins transactions, devices, and customers to output chronological audits.

---

## ⚡ TRANSACTION SYNC LOGIC (syncController.js)

### `pushSync` (Post)
1. Receives an array of `transactions` (mapped to Android `MobileEntryEntity` schema).
2. Verifies limits: If user is on the free tier, counts how many **new** (unsynced) entries are being pushed. If `already_synced_count + new_push_count > free_entries_limit`, rejects push with `403 FREE_LIMIT_EXCEEDED`.
3. Loops through transaction entries:
   - Queries `transactions` for existing row mapping `android_txn_id`. Skips if present.
   - Wraps database execution in `withTransaction` wrapper for ACID safety:
     - Upserts device using `imei1` (creates if missing, updates details if existing).
     - Upserts customer using `(shop_id, mobile)` composite key.
     - Inserts `transactions` entry and records timestamps.
     - Adds `timeline_events` audit event trace.
     - Registers `transaction_media` urls (mapped from Android firebase URLs).
     - Writes record in `sync_log` table.
4. Recalculates total entries and updates `free_entries_used` value in `user_features`.

### `pullSync` (Get)
1. Receives `since` millisecond timestamp query parameter.
2. Selects all transactions, customers, and devices details where `created_at >= since` for the verified `shop_id`.
3. Fetches associated media URLs.
4. Converts date structures into Android-compatible models and returns payload for local sync restore.

---

## 🚨 COMMON GOTCHAS & RULES

1. **Firebase Private Keys:** In `env.js`, `FIREBASE_PRIVATE_KEY` has `.replace(/\\n/g, '\n')` applied. This is critical when key strings are stored in environment files where newlines get escaped.
2. **ACID Transaction Handler:** Always write DB modification processes (such as creating transactions, syncing, database migrations) within the `withTransaction` utility callback function. Doing so ensures proper `ROLLBACK` on query crashes.
3. **Database Client pool exhaustion:** The Neon connection pool constraint is set to `max: 5` because Neon free tier allows very limited active connections. Never run arbitrary raw pool queries without proper parameters or release client mechanisms.
4. **Android Sync Schema Mapper:** The fields inside `syncController.js` and `transactionController.js` must exactly mirror Android Room field casings. Keep database view naming schemes matching what `MobileEntryEntity.kt` outputs.
5. **Admin Access verification:** Security calls must bind `verifyFirebaseToken` first, then run `requireShop` (for normal shopkeepers) or `requireAdmin` (for global features management).

---
