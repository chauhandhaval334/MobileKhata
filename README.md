# MobileKhata Backend

> Node.js + Express REST API for the MobileKhata Android app.
> Handles authentication, data sync, feature gating, admin management, and push notifications.

**Live URL:** https://mobilekhata.onrender.com

---

## Quick Start

```bash
git clone https://github.com/chauhandhaval334/MobileKhata.git
cd MobileKhata          # or cd mobilekhata-backend if separate repo
npm install
cp .env.example .env    # Fill in your credentials (see below)
node src/database/migrate.js   # Initialize DB schema
npm run dev             # Start development server (nodemon)
```

Server runs on `http://localhost:3000`

---

## Environment Variables

Create a `.env` file in the project root:

```env
DATABASE_URL=postgresql://user:password@host/dbname
FIREBASE_PROJECT_ID=mobilekhata-1b8a8
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n"
ADMIN_UIDS=YourFirebaseUID1,YourFirebaseUID2
ALLOWED_ORIGINS=https://yourdomain.com
NODE_ENV=development
PORT=3000
```

> ⚠️ **ADMIN_UIDS**: Add your Firebase UID here to access the admin panel at `/admin`.
> To get your Firebase UID: log in to the app, check the admin panel login error page — it shows your UID.

---

## Project Structure

```
src/
├── app.js              # Express setup + all route mounts
├── server.js           # HTTP server startup
├── config/             # DB, Firebase, env config
├── controllers/        # Business logic
├── routes/             # Route definitions (V1 and V2 split)
├── middleware/         # Auth, validation, error handling
├── database/           # schema.sql + migrate.js
├── services/           # File upload service
└── utils/              # Logger, response helpers, maintenance store
public/
├── admin/              # Admin dashboard (static HTML)
└── website/            # Public marketing website (static HTML)
```

---

## API Versioning

This backend supports two API versions to ensure backward compatibility:

| Version | Base Path | Used By |
|---------|-----------|---------|
| V1 | `/api/v1/` | Old app versions (Play Store) |
| V2 | `/api/v2/` | New app builds |

**V2 additions over V1:**
- Single-device session lockout (`X-Device-Id` header)
- Trial period enforcement (days-based + entries-based)
- Premium expiry date checking
- Feedback Center endpoints
- Bill Book endpoints
- FCM token management
- Google Play purchase verification

---

## Key Endpoints

### Health
```
GET /health               → Always 200 (Render health check)
GET /api/v1/health        → V1 health
GET /api/v2/health        → V2 health
```

### Shop (requires Firebase auth)
```
POST   /api/v2/shop/setup          → Create/update shop profile
GET    /api/v2/shop/profile        → Get my shop
GET    /api/v2/shop/stats          → Dashboard stats
GET    /api/v2/shop/features       → Feature flags (premium, trial)
GET    /api/v2/shop/plans          → Subscription plans info
POST   /api/v2/shop/fcm-token      → Update FCM token
POST   /api/v2/shop/active-device  → Register active device
POST   /api/v2/shop/verify-purchase → Verify Google Play purchase
```

### Sync
```
POST   /api/v2/sync/push  → Upload local entries to server (rate limited: 10/min)
GET    /api/v2/sync/pull  → Download entries from server (for new device restore)
```

### Admin (requires ADMIN_UIDS)
```
GET    /api/v2/admin/stats               → Platform stats
GET    /api/v2/admin/shops               → All shops list
PATCH  /api/v2/admin/shops/:id/features  → Toggle features for a shop
PATCH  /api/v2/admin/shops/:id/premium   → Set premium expiry date
POST   /api/v2/admin/notify/:id          → Send push notification
PATCH  /api/v2/admin/maintenance         → Toggle maintenance mode
PATCH  /api/v2/admin/config              → Update app config values
```

---

## Admin Panel

Access at: `https://mobilekhata.onrender.com/admin`

Login with Firebase phone OTP. Your Firebase UID must be in the `ADMIN_UIDS` environment variable.

**Admin capabilities:**
- View all registered shops
- Enable/disable features per shop (sell, purchase, repair, reports)
- Set premium expiry date
- Adjust free entries limit
- Send push notifications
- Manage feedback tickets (reply, change status)
- Toggle maintenance mode
- Edit app config (support number, min app version, etc.)

---

## Database

**PostgreSQL on Neon Cloud.**

Run migrations:
```bash
node src/database/migrate.js
```

This is **idempotent** — safe to run multiple times. Uses `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ADD COLUMN IF NOT EXISTS`.

### Main Tables
| Table | Purpose |
|-------|---------|
| `shops` | One row per registered shop |
| `user_features` | Feature flags + premium expiry per shop |
| `customers` | Customer KYC data |
| `devices` | Device IMEI records |
| `transactions` | Core ledger (Purchase/Sale/Repair) |
| `transaction_media` | Firebase Storage URLs per transaction |
| `bills` | Generated invoices |
| `feedback_tickets` | User feedback submissions |
| `feedback_replies` | Reply thread per ticket |
| `app_config` | Key-value config (admin-editable) |
| `sync_log` | Audit log of sync operations |

---

## Authentication

Every API request requires:
```
Authorization: Bearer <Firebase ID Token>
X-Device-Id: <Android UUID>     ← V2 routes only
```

Firebase ID Tokens expire after 1 hour. The Android SDK refreshes them automatically.

**Admin routes** additionally require the request's Firebase UID to be listed in `ADMIN_UIDS` env var.

---

## Deployment (Render.com)

1. Push to `master` branch → Render auto-deploys
2. Set environment variables in Render Dashboard → Environment tab
3. Run migration manually once on first deploy (or SSH + run `node src/database/migrate.js`)

**Note:** Render free tier sleeps after 15min inactivity. First request after sleep takes ~30 seconds (cold start). Upgrade to paid plan to avoid this.

---

## Detailed Documentation

See [AI_MEMORY.md](./AI_MEMORY.md) for the complete project documentation including:
- Full system architecture diagram
- Complete database schema explanation
- V1 vs V2 API differences
- Feature gating logic
- Sync system internals
- Key design decisions
