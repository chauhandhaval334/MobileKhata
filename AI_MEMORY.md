# 📱 MobileKhata — Complete Project Documentation

> **For AI assistants, new developers, or anyone picking this up fresh.**
> This document covers both the Android app and the Node.js backend in one place. Read this before touching any code.

---

## 📋 Table of Contents

1. [What is MobileKhata?](#1-what-is-mobilekhata)
2. [System Architecture](#2-system-architecture)
3. [Repository Structure](#3-repository-structure)
4. [Backend (Node.js) — Deep Dive](#4-backend-nodejs--deep-dive)
5. [Android App — Deep Dive](#5-android-app--deep-dive)
6. [Database Schema](#6-database-schema)
7. [API Reference — V1 vs V2](#7-api-reference--v1-vs-v2)
8. [Admin Panel](#8-admin-panel)
9. [Authentication & Security](#9-authentication--security)
10. [Feature Gating & Subscription System](#10-feature-gating--subscription-system)
11. [Sync System](#11-sync-system)
12. [Deployment & Environment Setup](#12-deployment--environment-setup)
13. [Key Design Decisions](#13-key-design-decisions)

---

## 1. What is MobileKhata?

MobileKhata is a **B2B SaaS Android app** for Indian mobile phone shop owners.

**Target Users:** Small mobile shop owners who buy, sell, and repair phones. They need to:
- Record every transaction (purchase/sale/repair) with full device and customer details
- Track IMEI numbers of devices they handle
- Store KYC documents (Aadhaar, PAN, customer photo)
- Generate PDF invoices/bills
- Maintain a customer ledger
- View analytics and reports

**Core Problems Solved:**
- Most shops still use paper registers — MobileKhata digitizes everything
- IMEI tracking helps during police investigations, stolen phone recovery
- Customer KYC compliance (required by government)
- Bill generation for professional invoices

**Business Model:**
- Free tier: 10 transactions limit, 30-day trial period
- Premium tier: Unlimited transactions, all features unlocked
- Admin controls premium via backend (no in-app purchase integrated currently — manual activation)

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────┐
│                   ANDROID APP                        │
│   Kotlin + Jetpack Compose + Room (Local SQLite)    │
│                                                      │
│  Firebase Auth (Phone OTP) ──► JWT Token            │
│  Local Room DB ──► Sync Worker ──► Backend API      │
└──────────────────┬──────────────────────────────────┘
                   │ HTTPS (JWT Bearer token)
                   │ X-Device-Id header (v2 only)
                   ▼
┌─────────────────────────────────────────────────────┐
│               BACKEND (Node.js + Express)            │
│         Hosted on Render.com (free tier)             │
│   https://mobilekhata.onrender.com                  │
│                                                      │
│  /api/v1/* ── Legacy routes (old app compatibility) │
│  /api/v2/* ── New routes (current app build)        │
│  /admin    ── Static HTML admin dashboard            │
│  /         ── Static HTML public website             │
└──────────────────┬──────────────────────────────────┘
                   │ pg (node-postgres)
                   ▼
┌─────────────────────────────────────────────────────┐
│          PostgreSQL Database (Neon Cloud)             │
│       All data: shops, transactions, customers,      │
│       devices, media URLs, feature flags, etc.       │
└─────────────────────────────────────────────────────┘
                   │
          Firebase Storage (media files)
          Images uploaded directly from Android
          → URLs stored in PostgreSQL
```

**Third-Party Services Used:**
| Service | Purpose |
|---------|---------|
| Firebase Auth | Phone OTP authentication |
| Firebase Storage | Media file storage (photos, documents) |
| Firebase FCM | Push notifications |
| Neon (PostgreSQL) | Cloud database |
| Render.com | Backend hosting |
| Google Play | App distribution |
| Google Play Billing | (Planned) In-app purchase for premium |

---

## 3. Repository Structure

### Backend Repository: `mobilekhata-backend`
```
mobilekhata-backend/
├── src/
│   ├── app.js                    # Express app setup, all routes mounted here
│   ├── server.js                 # HTTP server startup + graceful shutdown
│   ├── config/
│   │   ├── database.js           # PostgreSQL connection (node-postgres pool)
│   │   ├── env.js                # Environment variable validation
│   │   └── firebase.js           # Firebase Admin SDK init
│   ├── controllers/
│   │   ├── shopController.js         # V2: Shop setup, profile, stats
│   │   ├── shopControllerV1.js       # V1: Legacy shop setup (no device capture)
│   │   ├── featuresController.js     # V2: Feature flags + trial logic
│   │   ├── featuresControllerV1.js   # V1: Legacy features (basic boolean flags)
│   │   ├── syncController.js         # (unused) — kept for reference
│   │   ├── syncControllerV1.js       # V1: Sync push/pull (no trial enforcement)
│   │   ├── syncControllerV2.js       # V2: Sync push/pull (trial days + premium check)
│   │   ├── transactionController.js  # CRUD for individual transactions
│   │   ├── customerController.js     # Customer lookup by IMEI/mobile
│   │   ├── stockController.js        # Current stock view
│   │   ├── reportController.js       # Analytics reports
│   │   ├── mediaController.js        # Firebase media URL save
│   │   └── websiteController.js      # Website config from DB
│   ├── routes/
│   │   ├── shopRoutesV1.js           # /api/v1/shop/*
│   │   ├── shopRoutesV2.js           # /api/v2/shop/*
│   │   ├── syncRoutesV1.js           # /api/v1/sync/*
│   │   ├── syncRoutesV2.js           # /api/v2/sync/*
│   │   ├── transactionRoutes.js      # Shared v1+v2
│   │   ├── customerRoutes.js         # Shared v1+v2
│   │   ├── stockRoutes.js            # Shared v1+v2
│   │   ├── reportRoutes.js           # Shared v1+v2
│   │   ├── imeiRoutes.js             # IMEI history lookup
│   │   ├── mediaRoutes.js            # Media upload callback
│   │   ├── feedbackRoutes.js         # /api/v2/feedback/* (user-facing)
│   │   ├── billRoutes.js             # /api/v2/bills/* (bill book)
│   │   ├── adminRoutes.js            # /api/v1/admin (legacy)
│   │   ├── adminRoutesV2.js          # /api/v2/admin/* (main admin API)
│   │   ├── adminFeedbackRoutes.js    # /api/v2/admin/feedback/*
│   │   └── websiteRoutes.js          # /api/v1/website/* and /api/v2/website/*
│   ├── middleware/
│   │   ├── auth.js               # verifyFirebaseToken, requireShop, requireShopV2, requireAdmin
│   │   ├── validate.js           # express-validator result handler
│   │   └── errorHandler.js       # Global 404 + 500 handlers
│   ├── services/
│   │   └── uploadService.js      # Multer config for media uploads
│   ├── database/
│   │   ├── schema.sql            # Full idempotent schema (CREATE IF NOT EXISTS)
│   │   └── migrate.js            # Runs schema.sql against live DB (safe to re-run)
│   └── utils/
│       ├── logger.js             # Winston logger
│       ├── response.js           # success/created/forbidden/paginate helpers
│       └── maintenanceStore.js   # In-memory maintenance mode flag (reads from DB)
├── public/
│   ├── admin/                    # Admin dashboard (static HTML+CSS+JS)
│   │   ├── index.html
│   │   ├── style.css
│   │   └── app.js
│   └── website/                  # Public marketing website
│       ├── index.html
│       ├── style.css
│       └── app.js
└── .env                          # NOT in git — see Environment Setup section
```

### Android Repository: `MobileKhata`
```
MobileKhata/
└── app/src/main/java/com/mobilekhata/
    ├── MainActivity.kt           # Root activity, Compose host, version check
    ├── navigation/
    │   └── MobileLedgerNavigation.kt  # All screen routes defined here
    ├── network/
    │   ├── ApiService.kt         # Retrofit interface — ALL API endpoints
    │   ├── RetrofitClient.kt     # OkHttp + Retrofit setup, auth/session interceptors
    │   └── Models.kt             # Request/response data classes
    ├── model/
    │   └── db/
    │       ├── Entities.kt       # Room database entities (local SQLite)
    │       └── LedgerDao.kt      # Room DAOs for local data access
    ├── repository/               # Data access layer between ViewModel & API/DB
    ├── viewmodel/                # ViewModels (MVVM pattern)
    ├── ui/
    │   ├── screens/              # 40 Jetpack Compose screen files
    │   └── components/           # Reusable composables
    ├── service/
    │   └── MyFirebaseMessagingService.kt  # FCM push notification handler
    ├── sync/                     # Background sync WorkManager logic
    └── utils/
        ├── AppPreferences.kt     # SharedPreferences wrapper
        ├── SessionManager.kt     # Session invalidation logic (device lockout)
        ├── BillingManager.kt     # Google Play Billing integration
        └── ShareHelper.kt        # PDF/content sharing helpers
```

---

## 4. Backend (Node.js) — Deep Dive

### Stack
- **Node.js** (v18+) + **Express 4**
- **PostgreSQL** via `node-postgres` (pg) with connection pooling
- **Firebase Admin SDK** for token verification
- **Winston** for structured logging
- **Helmet + CORS** for security
- **express-rate-limit** for abuse prevention
- **express-validator** for request validation
- **multer** for file uploads

### How a Request Flows

```
Android App
  │
  ├── HTTP Request with headers:
  │     Authorization: Bearer <Firebase ID Token>
  │     X-Device-Id: <Android device UUID>   ← v2 only
  │
  ▼
Express Middleware Pipeline:
  1. helmet()          → Sets security headers
  2. cors()            → Validates origin
  3. globalLimiter     → 100 req/15min per IP
  4. compression()     → gzip response
  5. express.json()    → Parse body
  6. morgan()          → HTTP logging
  7. maintenanceCheck  → 503 if maintenance mode ON
  8. verifyFirebaseToken → Decodes JWT, loads req.shop from DB
  9. requireShop/V2    → Ensures shop profile exists
                         V2 also checks X-Device-Id vs active_device_id
  10. validate()       → Checks express-validator results
  11. Controller       → Business logic + DB query
  12. response helper  → Sends JSON {success, data, message}
```

### Key Middleware — `auth.js`

| Middleware | Used By | What it does |
|-----------|---------|-------------|
| `verifyFirebaseToken` | All protected routes | Verifies Firebase JWT, attaches `req.user` and `req.shop` |
| `requireShop` | V1 routes | Checks `req.shop` exists (shop profile must be set up) |
| `requireShopV2` | V2 routes | Same as requireShop + active device session check |
| `requireAdmin` | Admin routes | Checks `req.user.uid` is in `ADMIN_UIDS` env var |

### Rate Limiting

| Limiter | Routes | Limit |
|---------|--------|-------|
| `globalLimiter` | All routes | 100 requests per 15 minutes per IP |
| `syncLimiter` | `/api/v*/sync/*` | 10 requests per minute per IP |

---

## 5. Android App — Deep Dive

### Stack
- **Kotlin** + **Jetpack Compose** (100% Compose UI)
- **Room** for local SQLite database
- **Retrofit 2** + **OkHttp** for HTTP
- **Firebase Auth** (Phone number OTP)
- **Firebase Storage** (media upload)
- **Firebase FCM** (push notifications)
- **Google Play Billing** (subscription management — in progress)
- **WorkManager** for background sync

### App Flow — User Journey

```
App Launch
    │
    ▼
SplashScreen → Check: logged in? shop setup? PIN set?
    │
    ├─► Not logged in → LoginScreen → PhoneAuthScreen → OtpVerifyScreen
    │                                                        │
    │                                      ┌─────────────────┘
    │                                      ▼
    │                               BusinessSetupScreen (first time)
    │                                      │
    │                               PinSetupScreen (set 4-digit PIN)
    │                                      │
    ├─► Logged in, shop set up ────────────┘
    │         │
    │         ▼
    │   PinEntryScreen (every launch after first)
    │         │
    │         ▼
    │   DashboardScreen ←──────────────────────────────────────┐
    │         │                                                 │
    │   ┌─────┴──────────────────────────────────────────────┐ │
    │   │            Bottom Navigation Tabs                   │ │
    │   │  Home  │  Add Entry  │  Search  │ Reports │ Settings │ │
    │   └───┬────┴──────┬──────┴────┬─────┴────┬────┴────┬───┘ │
    │       │           │           │          │         │      │
    │       ▼           ▼           ▼          ▼         ▼      │
    │  DashboardScreen  AddEntryTypeScreen SearchScreen ReportsScreen SettingsScreen
    │                        │                                   │
    │                   ┌────┴─────────────────────────┐        │
    │                   │  Entry Flow (multi-step):    │        │
    │                   │  1. AddEntryTypeScreen       │        │
    │                   │     (Purchase/Sale/Repair)   │        │
    │                   │  2. BrandPickerScreen         │        │
    │                   │  3. ModelPickerScreen         │        │
    │                   │  4. DeviceSpecsScreen         │        │
    │                   │  5. InStockPickerScreen (Sale)│        │
    │                   │  6. CustomerDetailsScreen     │        │
    │                   │  7. DocumentUploadScreen      │        │
    │                   │  8. SellPriceScreen           │        │
    │                   │  9. EntrySuccessScreen ───────┼────────┘
    │                   └──────────────────────────────┘
```

### All App Screens (40 screens)

| Screen | Purpose |
|--------|---------|
| `SplashScreen` | Auth check, redirects to appropriate screen |
| `LoginScreen` | Welcome/login landing |
| `PhoneAuthScreen` | Phone number input for OTP |
| `OtpVerifyScreen` | OTP verification |
| `BusinessSetupScreen` | First-time shop profile creation |
| `BusinessProfileScreen` | Edit existing shop profile |
| `PinSetupScreen` | Set 4-digit app PIN |
| `PinEntryScreen` | Enter PIN on every launch |
| `DashboardScreen` | Home with stats, recent entries |
| `AddEntryTypeScreen` | Choose Purchase/Sale/Repair |
| `AddEntryFormScreen` | Manual entry form (alternative) |
| `BrandPickerScreen` | Brand selection (searchable list) |
| `ModelPickerScreen` | Model selection per brand |
| `DeviceSpecsScreen` | IMEI, storage, color, condition |
| `InStockPickerScreen` | Pick from existing stock (for Sales) |
| `CustomerDetailsScreen` | Customer name, mobile, address, Aadhaar |
| `CustomerListScreen` | All customers list |
| `CustomerProfileScreen` | Individual customer full history |
| `DocumentUploadScreen` | Upload photos, invoice, Aadhaar, PAN |
| `SellPriceScreen` | Enter sale price + payment method |
| `EntrySuccessScreen` | Confirmation + bill generation option |
| `DeviceDetailsScreen` | Full device history, all transactions |
| `DeviceSpecsScreen` | Device specs detail view |
| `SearchScreen` | Search transactions, customers, devices |
| `ReportsScreen` | Report categories |
| `ReportGeneratorScreen` | Date-range PDF report generator |
| `CombinedReportScreen` | Analytics charts + summary |
| `BillBookScreen` | All generated bills list |
| `BillDetailsScreen` | Individual bill view + share |
| `CreateBillScreen` | Create new bill/invoice |
| `SettingsScreen` | App settings hub |
| `SecurityScreen` | PIN change, security options |
| `HelpSupportScreen` | WhatsApp support + FAQ |
| `AboutScreen` | App version, links |
| `FeedbackScreen` | Submit feedback/bug report |
| `MyFeedbackScreen` | View submitted feedback tickets |
| `FeedbackDetailScreen` | Individual feedback + reply thread |
| `SubscriptionStatusScreen` | Premium status + upgrade info |
| `PremiumLockedScreen` | Shown when feature requires premium |
| `SpecialOfferSheet` | Bottom sheet for special offers |
| `ForceUpdateScreen` | Shown when app version is too old |

---

## 6. Database Schema

### Tables Overview

```
shops              ← One row per shop (Firebase UID)
  │
  ├── user_features    ← Feature flags + premium expiry per shop
  ├── customers        ← Customer KYC data (normalized)
  ├── devices          ← Device/IMEI data (normalized)
  ├── transactions     ← Core ledger (Purchase/Sale/Repair)
  │     └── transaction_media  ← Firebase Storage URLs per transaction
  ├── sync_log         ← Audit log of every sync operation
  ├── timeline_events  ← Event history per device lifecycle
  ├── stock            ← Current stock view (purchased - sold)
  ├── bills            ← Generated invoices/bills
  ├── feedback_tickets ← User feedback/bug reports
  │     └── feedback_replies  ← Admin + user reply thread
  ├── special_offers   ← Promotional offers (admin-managed)
  ├── app_config       ← Key-value config (support numbers, URLs, etc.)
  └── admin_users      ← Admin Firebase UIDs
```

### Key Column Explanations

**`shops` table:**
- `firebase_uid` — Links to Firebase Auth UID (unique per user)
- `fcm_token` — Device push notification token (updated on every login)
- `active_device_id` — Currently registered Android device UUID (single-device lockout)

**`user_features` table:**
- `can_sell/purchase/repair/reports` — Feature flags (admin-controlled)
- `free_entries_limit` — Max transactions on free plan (default: 10)
- `free_entries_used` — Counter updated after every sync
- `premium_expires_at` — NULL = free tier, date = premium until that date
- `free_days_limit` — Days of free trial from signup (default: 30)

**`transactions` table:**
- `android_txn_id` — UUID generated on Android side; used for sync deduplication
- `txn_type` — `'Purchase'` | `'Sale'` | `'Repair'`
- `txn_date` — Actual date from Android (not server insert time)

---

## 7. API Reference — V1 vs V2

### Why Two API Versions?

When releasing the new app to Play Store, existing users have the old APK installed. If the backend changes the API, old app breaks. Solution: **keep old routes working forever** under `/api/v1`, and put all new features under `/api/v2`.

| | V1 (`/api/v1/`) | V2 (`/api/v2/`) |
|---|---|---|
| **Who uses it** | Old app versions still installed on user devices | New app builds |
| **Session lockout** | ❌ No device check | ✅ X-Device-Id checked |
| **Trial enforcement** | ❌ Basic entry count only | ✅ Days remaining + premium expiry |
| **Feedback** | ❌ Not available | ✅ Available |
| **Bill Book** | ❌ Not available | ✅ Available |
| **Sync** | `syncControllerV1.js` | `syncControllerV2.js` |
| **Shop routes** | `shopRoutesV1.js` | `shopRoutesV2.js` |

### Complete Endpoint List

#### V1 Endpoints (Legacy — Old App)
```
GET    /api/v1/health
GET    /api/v1/db-status
POST   /api/v1/shop/setup
GET    /api/v1/shop/profile
GET    /api/v1/shop/stats
GET    /api/v1/shop/features
GET    /api/v1/shop/plans
POST   /api/v1/sync/push
GET    /api/v1/sync/pull
GET    /api/v1/transactions
POST   /api/v1/transactions
GET    /api/v1/transactions/:id
DELETE /api/v1/transactions/by-android-id/:androidTxnId
DELETE /api/v1/transactions/by-customer/:mobile
GET    /api/v1/customers
GET    /api/v1/stock
GET    /api/v1/reports
GET    /api/v1/imei/:imei
POST   /api/v1/media
```

#### V2 Endpoints (Current App)
```
GET    /api/v2/health
POST   /api/v2/shop/setup
GET    /api/v2/shop/profile
GET    /api/v2/shop/stats
GET    /api/v2/shop/features
GET    /api/v2/shop/plans
POST   /api/v2/shop/fcm-token         ← Update push notification token
POST   /api/v2/shop/active-device     ← Register current device
POST   /api/v2/shop/verify-purchase   ← Verify Google Play purchase
POST   /api/v2/sync/push              ← Sync with trial/premium validation
GET    /api/v2/sync/pull
GET    /api/v2/transactions
POST   /api/v2/transactions
GET    /api/v2/transactions/:id
DELETE /api/v2/transactions/by-android-id/:androidTxnId
DELETE /api/v2/transactions/by-customer/:mobile
GET    /api/v2/customers
GET    /api/v2/stock
GET    /api/v2/reports
GET    /api/v2/imei/:imei
POST   /api/v2/media
POST   /api/v2/feedback               ← Submit feedback
GET    /api/v2/feedback               ← Get my feedback tickets
GET    /api/v2/feedback/:ticketId
POST   /api/v2/feedback/:ticketId/reply
PATCH  /api/v2/feedback/:ticketId/reopen
GET    /api/v2/bills
POST   /api/v2/bills
GET    /api/v2/bills/:billId
```

#### Admin Endpoints (requires ADMIN_UIDS)
```
GET    /api/v2/admin/stats            ← Platform-wide stats
GET    /api/v2/admin/shops            ← List all shops
GET    /api/v2/admin/shops/:shopId    ← Shop detail
PATCH  /api/v2/admin/shops/:shopId/features    ← Toggle features
PATCH  /api/v2/admin/shops/:shopId/premium     ← Set premium expiry
DELETE /api/v2/admin/shops/:shopId    ← Deactivate shop
GET    /api/v2/admin/config           ← App config key-values
PATCH  /api/v2/admin/config           ← Update config
PATCH  /api/v2/admin/maintenance      ← Toggle maintenance mode
POST   /api/v2/admin/notify/:shopId   ← Send FCM notification
GET    /api/v2/admin/feedback         ← All feedback tickets
GET    /api/v2/admin/feedback/:ticketId
POST   /api/v2/admin/feedback/:ticketId/reply
PATCH  /api/v2/admin/feedback/:ticketId/status
```

---

## 8. Admin Panel

**URL:** `https://mobilekhata.onrender.com/admin`

The admin panel is a **static HTML/JS/CSS** app served from `public/admin/`. It communicates with `/api/v2/admin/*` endpoints.

### Admin Login Flow
1. Admin opens `/admin` in browser
2. Signs in with phone OTP (Firebase Auth via browser SDK)
3. Gets Firebase ID Token
4. Backend's `requireAdmin` middleware checks if UID is in `ADMIN_UIDS` env var
5. If authorized → admin dashboard loads

### Admin Can Do:
| Action | Where |
|--------|-------|
| View all registered shops | Shops tab |
| Enable/disable features per shop (sell, purchase, repair, reports) | Shop detail |
| Set premium expiry date for a shop | Shop detail |
| Adjust free entries limit | Shop detail |
| Send push notifications to any shop | Shop detail |
| View all feedback tickets | Feedback tab |
| Reply to feedback as admin | Ticket detail |
| Change feedback status (Open/In Progress/Resolved/Closed) | Ticket detail |
| Toggle maintenance mode (puts app in 503 mode) | Settings |
| Edit app config (support WhatsApp, min app version, etc.) | Config tab |
| View platform-wide stats | Dashboard |

### Adding Admin Access
In Render environment variables, add:
```
ADMIN_UIDS=FirebaseUID1,FirebaseUID2
```
Multiple UIDs comma-separated. Restart (or redeploy) after change.

---

## 9. Authentication & Security

### Authentication Chain (every API request)

```
Android → HTTPS → Backend

1. Firebase Auth (Phone OTP on Android)
   → Firebase generates ID Token (JWT, expires 1hr)
   → Android refreshes automatically via SDK

2. Every API request:
   Header: Authorization: Bearer <Firebase ID Token>
   Header: X-Device-Id: <Android UUID>  ← V2 only

3. Backend verifies:
   a. Firebase Admin SDK verifies JWT signature + expiry
   b. Looks up shop record: SELECT * FROM shops WHERE firebase_uid = uid
   c. V2 only: Checks X-Device-Id vs shops.active_device_id
      → Mismatch? → 401 + X-Session-Invalid: another_device header
      → Android interceptor sees this header → triggers forced logout
```

### Single Device Session Lockout (V2 feature)
When a user logs in on a new device:
1. Android calls `POST /api/v2/shop/active-device` with new `deviceId`
2. Backend updates `shops.active_device_id`
3. Old device's requests fail with `SESSION_INVALID_ANOTHER_DEVICE`
4. Old device app shows "Logged in on another device" and logs out

### Security Headers
Helmet.js sets: `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Strict-Transport-Security`, etc.

---

## 10. Feature Gating & Subscription System

### Free Tier Limits
Every new shop gets:
- 10 free transaction entries (`free_entries_limit`)
- 30-day free trial (`free_days_limit`)
- All features OFF by default (admin must enable)

### Feature Flags (Admin-controlled)
| Flag | Meaning |
|------|---------|
| `can_sell` | Can record Sale transactions |
| `can_purchase` | Can record Purchase transactions |
| `can_repair` | Can record Repair transactions |
| `can_reports` | Can access Reports screen |

### What Happens at Sync (V2)
```javascript
// syncControllerV2.js logic:

1. Check if premium_expires_at > NOW()  → isPremium = true/false
2. If NOT premium:
   a. Calculate daysActive since shop creation
   b. freeDaysRemaining = free_days_limit - daysActive
   c. If freeDaysRemaining <= 0 → TRIAL_EXPIRED_TIME error
   d. Check if (current entries + new entries) > free_entries_limit
      → FREE_LIMIT_EXCEEDED error
3. If premium → skip all checks, allow unlimited sync
```

### Setting Premium for a Shop (Admin)
Via admin panel → Shop detail → Set premium expiry date.
This sets `user_features.premium_expires_at` to the chosen date.

---

## 11. Sync System

The sync system is the heart of the app — it bridges the local Room database with the cloud PostgreSQL database.

### How Sync Works

**Push (Android → Server):**
1. Android collects all local Room records modified since last sync
2. Sends as batch POST to `/api/v2/sync/push`
3. Body includes: `{ androidDeviceId, transactions: [...] }`
4. Server processes each entry idempotently (uses `android_txn_id` for dedup)
5. For each entry: upsert device → upsert customer → insert transaction → save media URLs → log sync
6. Returns: `{ synced, skipped, failed, errors, freeEntriesUsed }`

**Pull (Server → Android):**
1. Android calls `GET /api/v2/sync/pull?since=<timestamp>`
2. Server returns all transactions for this shop since that timestamp
3. Used for new device restore / data recovery

### Sync Deduplication
- Android generates a UUID (`transactionId`) for every entry
- Backend checks: `SELECT id FROM transactions WHERE shop_id=$1 AND android_txn_id=$2`
- If exists → skip (already synced)
- If not → insert fresh

### Media Sync
- Photos/documents are uploaded directly from Android to Firebase Storage
- Android sends Firebase Storage URLs as part of sync payload
- Backend stores URLs in `transaction_media` table (not the files)
- Server never handles binary files — only URLs

---

## 12. Deployment & Environment Setup

### Environment Variables (Backend `.env`)

```env
# Database
DATABASE_URL=postgresql://user:password@host/dbname

# Firebase Admin SDK
FIREBASE_PROJECT_ID=mobilekhata-1b8a8
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@mobilekhata-1b8a8.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n"

# Security
ADMIN_UIDS=FirebaseUID1,FirebaseUID2    ← Add your Firebase UID here for admin access
ALLOWED_ORIGINS=https://yourdomain.com,https://admin.yourdomain.com

# Server
NODE_ENV=production
PORT=3000
```

### Running Database Migration
```bash
# Safe to run multiple times — uses IF NOT EXISTS
node src/database/migrate.js
```

### Local Development
```bash
cd mobilekhata-backend
npm install
cp .env.example .env  # Fill in your credentials
node src/database/migrate.js  # Set up DB schema
npm run dev  # Starts with nodemon
```

### Production (Render.com)
- Auto-deploys on push to `master` branch
- Set all env vars in Render Dashboard → Environment tab
- Health check endpoint: `GET /health` (Render pings this to keep alive)
- Free tier: Service sleeps after 15min inactivity → first request takes ~30sec

### Android Release Build
```bash
cd MobileKhata

# Ensure RetrofitClient.kt has live URL:
# private const val BASE_URL = "https://mobilekhata.onrender.com/"

# Build release APK (requires keystore configured in build.gradle)
./gradlew assembleRelease

# Build release AAB for Play Store
./gradlew bundleRelease
```

---

## 13. Key Design Decisions

### Why V1/V2 API split instead of feature flags?
Once an APK is published to Play Store, you cannot force all users to update immediately. Old APKs continue working for weeks/months. The V1/V2 split ensures old app builds never break while new features can be added freely to V2.

### Why PostgreSQL instead of Firebase Firestore?
- Better querying capabilities (JOIN, aggregations, full-text search)
- Relational data (device → transaction → customer) is naturally expressed in SQL
- IMEI history tracking requires complex queries that are awkward in Firestore
- Cost-effective at scale

### Why normalize (separate tables for customers/devices)?
In the original Android Room DB, customer name/mobile/IMEI was duplicated in every transaction. On the server, normalization means:
- Customer data updated once, reflected everywhere
- Device IMEI can be tracked across multiple shops (Purchase → Sale lifecycle)
- Storage efficiency

### Why Firebase for auth instead of custom OTP?
- Firebase handles OTP sending, rate limiting, carrier integrations
- Phone verification is trusted (linked to SIM card)
- No OTP infrastructure to maintain

### Why local Room DB + cloud sync (not cloud-only)?
- Indian mobile shops often have poor/no internet
- App must work completely offline
- Data syncs to cloud when connected (backup + restore on new device)
- Room DB is source of truth on device; cloud is the backup/sync layer

### Maintenance Mode
Admin can turn on maintenance mode via admin panel. When ON:
- All API requests return `503 SERVER_MAINTENANCE`
- Android app shows maintenance screen
- Admin panel itself is NOT affected (bypassed)
- Used when running database migrations or deployments

---

*Last updated: June 2026*
*Backend: Node.js + Express + PostgreSQL on Render*
*Android: Kotlin + Jetpack Compose*
*Live Server: https://mobilekhata.onrender.com*
