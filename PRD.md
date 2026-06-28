# MobileKhata — Product Requirements Document (PRD)

**Version:** 2.0  
**Last Updated:** June 2026  
**Status:** In Active Development

---

## 1. Product Overview

### Vision
MobileKhata is a **digital ledger and shop management app** purpose-built for Indian mobile phone shop owners. It replaces paper-based record keeping with a professional, cloud-synced mobile app.

### Problem Statement
Small mobile phone shop owners in India face these daily challenges:
- Paper registers get damaged, lost, or become unreadable
- No easy way to track which IMEI was bought from whom and sold to whom
- Manual customer KYC is error-prone and hard to retrieve during police verification
- No professional bill/invoice generation
- Business insights require manual calculation

### Target Users
- **Primary:** Small mobile phone shop owners (1–5 employees)
- **Geography:** India (Hindi/Gujarati speaking regions initially)
- **Tech comfort:** Basic smartphone users; not tech-savvy

### Success Metrics
- Number of active shops (target: 1,000 in Year 1)
- Daily active shops syncing data
- Transaction records synced to cloud
- Premium conversion rate

---

## 2. Core Features

### 2.1 Transaction Recording (MVP)
Record every business transaction with complete details:

**Transaction Types:**
- **Purchase** — Buying a phone from a vendor/customer
- **Sale** — Selling a phone to a customer
- **Repair** — Accepting a phone for repair

**Per-Transaction Data Captured:**
| Category | Fields |
|----------|--------|
| Device | Brand, Model, Storage, Color, Condition, IMEI1, IMEI2 |
| Customer | Full Name, Mobile, Address, State, District, Pin Code |
| KYC | Aadhaar Number, PAN, Aadhaar Front/Back photo, Customer Photo |
| Transaction | Type, Amount, Payment Method (Cash/Online/Cheque), Remarks, Purpose |
| Documents | Device Photos, Invoice, Bill, Warranty, Other Docs |

### 2.2 IMEI Tracking
- Each device's full lifecycle tracked by IMEI
- Query: "Who currently has this IMEI?"
- Timeline: Purchased from X → Sold to Y → Repurchased → Sold again
- Helps during police verification for stolen phone cases

### 2.3 Customer Management
- Auto-deduplication: one customer per mobile number per shop
- Full transaction history per customer
- Aadhaar/PAN stored (masked on display)

### 2.4 Cloud Sync
- Works offline — local Room SQLite database
- Syncs to cloud PostgreSQL when internet available
- Restore all data on new device via pull sync
- Conflict-free: uses android_txn_id for deduplication

### 2.5 Bill / Invoice Generation
- Create professional PDF invoices
- Share via WhatsApp, email, etc.
- Bill Book: history of all generated bills
- Custom fields: shop name, logo, GST number, bill number

### 2.6 Reports & Analytics
- Revenue by transaction type (Purchase/Sale/Repair)
- Date-range filtering
- Export to PDF
- Combined report with charts
- Current stock view (Purchased - Sold)

### 2.7 Feedback Center
- Users can submit feedback, bug reports, feature requests
- Track status of submitted tickets
- Admin can reply (visible in-app)
- Ticket statuses: Open → In Progress → Resolved → Closed

### 2.8 Premium Subscription
- Free tier: 10 transactions + 30-day trial
- Premium: Unlimited transactions, all features
- Admin manually activates premium (backend: `premium_expires_at`)
- Google Play Billing integration (in progress)

---

## 3. Feature Status

| Feature | Status | Notes |
|---------|--------|-------|
| Phone OTP Authentication | ✅ Live | Firebase Auth |
| Business Profile Setup | ✅ Live | |
| 4-Digit PIN Security | ✅ Live | |
| Purchase/Sale/Repair Recording | ✅ Live | |
| IMEI Tracking & History | ✅ Live | |
| Customer KYC & Management | ✅ Live | |
| Document Upload (Firebase Storage) | ✅ Live | |
| Cloud Sync (V1) | ✅ Live | Basic sync, no trial enforcement |
| Cloud Sync (V2) | ✅ Live | Trial days + premium expiry check |
| Bill Book | ✅ Live | |
| PDF Invoice Generation | ✅ Live | |
| Reports & Analytics | ✅ Live | |
| Search | ✅ Live | |
| Push Notifications (FCM) | ✅ Live | Admin can send to any shop |
| Feedback Center | ✅ Live | |
| Single Device Session Lockout | ✅ Live | V2 feature |
| Maintenance Mode | ✅ Live | Admin-controlled |
| Force App Update | ✅ Live | min_app_version_code in config |
| Admin Panel (Web) | ✅ Live | https://mobilekhata.onrender.com/admin |
| Premium (manual activation) | ✅ Live | Admin sets expiry date |
| Google Play Billing (in-app) | 🔄 In Progress | BillingManager.kt exists |
| Special Offers Sheet | ✅ Live | Admin-triggered via config |
| Stock Picker (from existing stock) | ✅ Live | Sale flow uses InStockPickerScreen |
| Multi-language support | ❌ Planned | Hindi planned |

---

## 4. User Flows

### 4.1 First-Time User Flow
```
Install app
  → LoginScreen (Welcome)
  → PhoneAuthScreen (Enter phone)
  → OtpVerifyScreen (OTP from Firebase)
  → BusinessSetupScreen (Shop name, address, details)
    → POST /api/v2/shop/setup
  → PinSetupScreen (Set 4-digit PIN)
  → DashboardScreen (Home)
```

### 4.2 Returning User Flow
```
Open app
  → SplashScreen (checks auth + shop setup + PIN)
  → PinEntryScreen (Enter PIN)
  → DashboardScreen
```

### 4.3 Add Purchase Entry Flow
```
DashboardScreen → FAB (Add)
  → AddEntryTypeScreen (Select: Purchase)
  → BrandPickerScreen (Select brand, e.g., Samsung)
  → ModelPickerScreen (Select model, e.g., Galaxy S23)
  → DeviceSpecsScreen (IMEI1, IMEI2, Storage, Color, Condition)
  → CustomerDetailsScreen (Name, Mobile, Address, Aadhaar)
  → DocumentUploadScreen (Photos, Aadhaar, PAN)
  → AddEntryFormScreen (Amount, Payment Method, Remarks)
  → EntrySuccessScreen
    → Background: POST /api/v2/sync/push (or queued for later)
```

### 4.4 Add Sale Entry Flow
```
AddEntryTypeScreen (Select: Sale)
  → InStockPickerScreen (Choose from existing stock)
    → OR enter new device details
  → CustomerDetailsScreen
  → DocumentUploadScreen
  → SellPriceScreen (Amount, Payment Method)
  → EntrySuccessScreen
    → Option: Generate Bill → CreateBillScreen
```

### 4.5 Sync Flow (Background)
```
WorkManager triggers sync every N minutes
  → POST /api/v2/sync/push (all unsynced Room records)
  → Server validates: premium? trial expired? entry limit?
  → Success: mark records as synced in Room
  → Failure: retain in Room, retry next sync
```

---

## 5. Technical Architecture

### 5.1 Two-Database Architecture
| Storage | Location | Purpose |
|---------|----------|---------|
| Room (SQLite) | Android device | Offline-first local storage |
| PostgreSQL (Neon) | Cloud (via Render API) | Cloud backup, multi-device sync |

### 5.2 API Versioning Strategy
The backend maintains two API versions simultaneously:

- **V1 (`/api/v1/`):** Legacy routes for old APKs still installed by users. Never broken. No new features.
- **V2 (`/api/v2/`):** All new features. Current app uses this. Has session lockout, proper trial enforcement.

This ensures zero downtime for existing users when releasing new app versions.

### 5.3 Authentication Architecture
```
Firebase Phone Auth (client-side)
  → Firebase ID Token (JWT, 1hr expiry)
  → Backend: Firebase Admin SDK verifies token
  → Attaches req.user (uid, phone) and req.shop (from DB)
  → Admin check: UID in ADMIN_UIDS env var
```

### 5.4 Session Lockout System
```
New device login:
  1. App sends POST /api/v2/shop/active-device (new deviceId)
  2. Backend stores deviceId in shops.active_device_id
  
Old device subsequent requests:
  3. App sends X-Device-Id header with old deviceId
  4. Backend detects mismatch → 401 + X-Session-Invalid: another_device
  5. Android interceptor detects header → calls SessionManager.invalidateSession()
  6. App shows "Logged in on another device" → forced logout
```

### 5.5 Feature Gating Architecture
```
Admin sets per-shop flags in user_features table
  ↓
App fetches GET /api/v2/shop/features on login
  ↓
Stores in AppPreferences (SharedPreferences)
  ↓
Each screen checks: canSell, canPurchase, canRepair, canReports
  ↓
Premium features → PremiumLockedScreen if not premium
  ↓
Server-side enforcement at sync time (can't bypass client check)
```

---

## 6. Non-Functional Requirements

### Performance
- App must work fully offline (no internet required for core features)
- Sync should complete within 10 seconds for 100 records
- App launch to dashboard: under 3 seconds

### Security
- All API communication over HTTPS
- Firebase tokens verified server-side (not trusted client claims)
- Aadhaar numbers masked in display (last 4 digits visible)
- Rate limiting on all endpoints
- Single device session enforcement on V2

### Reliability
- Sync is idempotent (safe to retry — no duplicate records)
- Database migrations are backward-compatible
- V1 API maintained for backward compatibility

### Privacy
- KYC documents stored in Firebase Storage (user's data only)
- Aadhaar/PAN fields masked in API responses
- No data shared with third parties

---

## 7. Admin Operations

### 7.1 Activating a New User
1. User registers → creates shop profile via app
2. Admin opens `/admin` dashboard
3. Finds shop → enables features: canSell, canPurchase, canRepair, canReports
4. Optionally sets premium expiry date

### 7.2 Premium Activation
1. User contacts admin (WhatsApp) and pays
2. Admin opens `/admin` → Shop detail
3. Sets `Premium Expiry` date (e.g., 1 year from today)
4. User's sync immediately becomes unlimited

### 7.3 Sending Push Notifications
1. Admin Panel → Shop detail → Send Notification
2. Enter title + body
3. Backend sends FCM message to shop's `fcm_token`
4. User sees notification on device

### 7.4 Maintenance Mode
1. Admin Panel → Settings → Toggle Maintenance Mode
2. All API requests (except admin routes) return 503
3. Android app shows maintenance screen
4. Turn off when done

### 7.5 Force App Update
1. Admin Panel → Config → `min_app_version_code`
2. Set to the minimum acceptable versionCode (integer from build.gradle)
3. Old apps see `ForceUpdateScreen` on launch, blocking access until updated

---

## 8. Known Limitations & Technical Debt

| Issue | Notes |
|-------|-------|
| Google Play Billing not fully integrated | BillingManager.kt exists but premium is manual |
| Render free tier cold starts | Server sleeps after 15min → first request ~30sec |
| Single repo with Android + Backend mixed | Ideally separate repos |
| No automated tests | All testing is manual |
| No CI/CD pipeline | Manual `git push` triggers Render auto-deploy |
| Admin panel uses localStorage for token | Not production-grade; use httpOnly cookies |
| `scratch_*.js` files committed | Should be in .gitignore |

---

## 9. Environment Configuration Reference

### Backend (.env)
```env
DATABASE_URL=postgresql://...
FIREBASE_PROJECT_ID=mobilekhata-1b8a8
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n"
ADMIN_UIDS=FirebaseUID1,FirebaseUID2
ALLOWED_ORIGINS=https://mobilekhata.onrender.com
NODE_ENV=production
PORT=3000
```

### Render Dashboard Env Vars (Live Server)
Must match above. Missing `ADMIN_UIDS` = cannot access admin panel.

### Android (RetrofitClient.kt)
```kotlin
// Production:
private const val BASE_URL = "https://mobilekhata.onrender.com/"
```

---

## 10. Repository Information

| Item | Value |
|------|-------|
| GitHub Org | `chauhandhaval334` |
| Backend Repo | `chauhandhaval334/MobileKhata` |
| Android Repo | `chauhandhaval334/MobileKhata` |
| Live Backend | https://mobilekhata.onrender.com |
| Admin Panel | https://mobilekhata.onrender.com/admin |
| Play Store | https://play.google.com/store/apps/details?id=com.mobilekhata |
| Package Name | `com.mobilekhata` |
| DB Host | Neon Cloud (PostgreSQL) |
| Media Host | Firebase Storage |
| Auth | Firebase Auth (Phone OTP) |
