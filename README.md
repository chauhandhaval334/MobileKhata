# MobileKhata Backend

Production-ready REST API backend for the MobileKhata Android app.

**Stack:** Node.js · Express.js · PostgreSQL · Firebase Admin SDK · Multer · PM2

---

## Project Structure

```
mobilekhata-backend/
├── src/
│   ├── config/
│   │   ├── env.js          # All environment variables (single source of truth)
│   │   ├── database.js     # PostgreSQL pool + query helpers
│   │   └── firebase.js     # Firebase Admin SDK init
│   ├── middleware/
│   │   ├── auth.js         # Firebase JWT verification + shop lookup
│   │   ├── errorHandler.js # Global error + 404 handler
│   │   └── validate.js     # express-validator result checker
│   ├── controllers/
│   │   ├── shopController.js         # Shop setup, profile, stats
│   │   ├── transactionController.js  # Purchase/Sale CRUD
│   │   ├── stockController.js        # Current stock view
│   │   ├── customerController.js     # Customer list + profile
│   │   ├── mediaController.js        # Secure file upload/serve/delete
│   │   ├── reportController.js       # Summary + daily reports
│   │   └── syncController.js         # Android ↔ Server sync
│   ├── routes/
│   │   ├── shopRoutes.js
│   │   ├── transactionRoutes.js
│   │   ├── stockRoutes.js
│   │   ├── customerRoutes.js
│   │   ├── mediaRoutes.js
│   │   ├── reportRoutes.js
│   │   └── syncRoutes.js
│   ├── services/
│   │   └── uploadService.js  # Multer config + file helpers
│   ├── database/
│   │   ├── schema.sql        # Full PostgreSQL schema
│   │   └── migrate.js        # Migration runner
│   ├── utils/
│   │   ├── logger.js         # Winston logger
│   │   └── response.js       # Standardised API response helpers
│   ├── app.js                # Express app setup
│   └── server.js             # Server entry point + graceful shutdown
├── uploads/                  # File storage (outside web root)
├── logs/                     # Log files
├── ecosystem.config.js       # PM2 config
├── .env.example              # Environment template
└── package.json
```

---

## API Reference

All endpoints require `Authorization: Bearer <Firebase ID Token>` header.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check (no auth) |
| `POST` | `/api/v1/shop/setup` | Create/update shop profile |
| `GET` | `/api/v1/shop/profile` | Get shop profile |
| `GET` | `/api/v1/shop/stats` | Dashboard stats |
| `POST` | `/api/v1/transactions` | Create purchase or sale |
| `GET` | `/api/v1/transactions` | List transactions (paginated, filtered) |
| `GET` | `/api/v1/transactions/:id` | Get transaction detail |
| `GET` | `/api/v1/transactions/imei/:imei` | Full IMEI lifecycle history |
| `GET` | `/api/v1/stock` | Current in-stock devices |
| `GET` | `/api/v1/stock/check/:imei` | Check if IMEI is in stock |
| `GET` | `/api/v1/customers` | List customers |
| `GET` | `/api/v1/customers/:mobile` | Customer profile + transactions |
| `POST` | `/api/v1/transactions/:txnId/media` | Upload documents/images |
| `GET` | `/api/v1/media/:mediaId` | Serve protected file |
| `DELETE` | `/api/v1/media/:mediaId` | Delete file |
| `GET` | `/api/v1/reports/summary` | Date-range report |
| `GET` | `/api/v1/reports/daily` | Daily report |
| `POST` | `/api/v1/sync/push` | Android → Server batch sync |
| `GET` | `/api/v1/sync/pull` | Server → Android data restore |

---

## Setup on Hostinger VPS

### 1. Install dependencies

```bash
sudo apt update
sudo apt install -y nodejs npm postgresql nginx
npm install -g pm2
```

### 2. Clone and install

```bash
git clone <your-repo> /var/www/mobilekhata-backend
cd /var/www/mobilekhata-backend
npm install --production
```

### 3. Configure environment

```bash
cp .env.example .env
nano .env   # Fill in DB credentials, Firebase keys
```

### 4. Setup PostgreSQL

```bash
sudo -u postgres psql
CREATE DATABASE mobilekhata;
CREATE USER mobilekhata_user WITH ENCRYPTED PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE mobilekhata TO mobilekhata_user;
\q
```

### 5. Run database migration

```bash
npm run migrate
```

### 6. Create upload and log directories

```bash
mkdir -p /var/www/mobilekhata-backend/uploads
mkdir -p /var/log/mobilekhata
chown -R www-data:www-data /var/www/mobilekhata-backend/uploads
```

### 7. Start with PM2

```bash
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup   # Follow instructions to enable auto-start
```

### 8. Nginx reverse proxy

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;

        # Security: uploads are never served by Nginx directly
        location ~* ^/uploads/ {
            deny all;
        }
    }
}
```

### 9. SSL with Certbot

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d api.yourdomain.com
```

---

## Firebase Service Account

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Project `mobilekhata-1b8a8` → Project Settings → Service Accounts
3. Click **Generate new private key** → download JSON
4. Copy values into `.env`:
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_CLIENT_EMAIL`
   - `FIREBASE_PRIVATE_KEY`

---

## Database Schema Overview

```
shops           ← one per Firebase UID (shop owner)
  └── customers ← one per mobile number per shop
  └── devices   ← one per IMEI (reused across purchase/sale cycles)
       └── transactions ← every purchase or sale
            └── transaction_media ← photos, aadhaar, invoices
            └── timeline_events   ← immutable audit log
  └── sync_log  ← Android sync audit trail
```

Views:
- `current_stock` — devices in stock right now
- `imei_lifecycle` — full ownership history per IMEI
