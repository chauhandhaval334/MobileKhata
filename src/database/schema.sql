-- ============================================================
-- MobileKhata PostgreSQL Schema
-- Version: 1.0
-- ============================================================
-- Designed from Android Room DB analysis.
-- Improvements over Room schema:
--   1. shops table (multi-user/multi-shop SaaS-ready)
--   2. devices table (normalised — IMEI no longer duplicated per transaction)
--   3. customers table (normalised — customer data not duplicated per transaction)
--   4. transactions table (clean IMEI lifecycle: who bought/sold what, when)
--   5. transaction_media (documents scoped to transaction, not entry)
--   6. imei_history view (replaces timeline_events aggregation)
--   7. sync_log table (tracks Android → Server sync state per row)
--   8. All timestamps in TIMESTAMPTZ (timezone-aware)
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- for fast ILIKE searches

-- ────────────────────────────────────────────────────────────
-- TABLE: shops
-- One row per registered shop (one per Firebase UID typically)
-- Supports future multi-shop per account
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shops (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firebase_uid     TEXT NOT NULL UNIQUE,         -- Firebase Auth UID
    phone_number     TEXT NOT NULL,                -- verified phone from Firebase
    shop_name        TEXT NOT NULL,
    shop_address     TEXT NOT NULL DEFAULT '',
    owner_name       TEXT NOT NULL DEFAULT '',
    district         TEXT NOT NULL DEFAULT '',
    gst_number       TEXT NOT NULL DEFAULT '',
    licence_number   TEXT NOT NULL DEFAULT '',
    retail_id        TEXT NOT NULL DEFAULT '',
    has_cctv         BOOLEAN NOT NULL DEFAULT FALSE,
    biz_remarks      TEXT NOT NULL DEFAULT '',
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE shops ADD COLUMN IF NOT EXISTS fcm_token TEXT DEFAULT NULL;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS active_device_id TEXT DEFAULT NULL;

CREATE TABLE IF NOT EXISTS admin_users (
  id         SERIAL PRIMARY KEY,
  uid        VARCHAR(255) UNIQUE NOT NULL,
  email      VARCHAR(255) NOT NULL,
  role       VARCHAR(50) DEFAULT 'admin',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- App Config Table
CREATE TABLE IF NOT EXISTS app_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed app_config defaults
INSERT INTO app_config (key, value) VALUES
  ('support_whatsapp',   '+918160707979'),
  ('support_email',      'support@mobilekhata.com'),
  ('privacy_policy_url', 'https://sites.google.com/view/mobilekhata/home'),
  ('min_app_version_code', '3'),
  ('app_update_url', 'https://play.google.com/store/apps/details?id=com.mobilekhata'),
  ('website_hero_title', 'Manage Your Mobile Shop with Ease'),
  ('website_hero_subtitle', 'MobileKhata is the ultimate ledger and inventory management app designed specifically for mobile shop owners. Keep track of sales, purchases, and repairs effortlessly.'),
  ('website_about_text', 'MobileKhata was built to solve the daily challenges of mobile shop owners. From tracking IMEI numbers to maintaining customer ledgers and generating professional PDF invoices, our app digitizes your entire business workflow.')
ON CONFLICT (key) DO NOTHING;


CREATE INDEX IF NOT EXISTS idx_shops_firebase_uid ON shops(firebase_uid);

-- ────────────────────────────────────────────────────────────
-- TABLE: user_features
-- Per-shop feature flags. All OFF by default — admin enables.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_features (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id             UUID NOT NULL UNIQUE REFERENCES shops(id) ON DELETE CASCADE,
    can_sell            BOOLEAN NOT NULL DEFAULT FALSE,
    can_purchase        BOOLEAN NOT NULL DEFAULT FALSE,
    can_repair          BOOLEAN NOT NULL DEFAULT FALSE,
    can_reports         BOOLEAN NOT NULL DEFAULT FALSE,
    free_entries_limit  INTEGER NOT NULL DEFAULT 10,
    free_entries_used   INTEGER NOT NULL DEFAULT 0,
    premium_expires_at  TIMESTAMPTZ DEFAULT NULL,
    free_days_limit     INTEGER NOT NULL DEFAULT 30,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Safe incremental updates for existing databases
ALTER TABLE user_features ADD COLUMN IF NOT EXISTS premium_expires_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE user_features ADD COLUMN IF NOT EXISTS free_days_limit INTEGER NOT NULL DEFAULT 30;
ALTER TABLE user_features ALTER COLUMN free_entries_limit SET DEFAULT 10;

CREATE INDEX IF NOT EXISTS idx_user_features_shop_id ON user_features(shop_id);

-- ────────────────────────────────────────────────────────────
-- TABLE: customers
-- Normalised customer entity — reused across transactions
-- One customer can have many transactions across multiple shops
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id          UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    full_name        TEXT NOT NULL,
    mobile           TEXT NOT NULL,
    address          TEXT NOT NULL DEFAULT '',
    state            TEXT NOT NULL DEFAULT '',
    district         TEXT NOT NULL DEFAULT '',
    pin_code         TEXT NOT NULL DEFAULT '',
    aadhaar_number   TEXT NOT NULL DEFAULT '',   -- masked on read
    gstin            TEXT NOT NULL DEFAULT '',
    photo_path       TEXT NOT NULL DEFAULT '',   -- relative path in uploads/
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (shop_id, mobile)                     -- one customer per mobile per shop
);

CREATE INDEX IF NOT EXISTS idx_customers_shop_id   ON customers(shop_id);
CREATE INDEX IF NOT EXISTS idx_customers_mobile    ON customers(mobile);
CREATE INDEX IF NOT EXISTS idx_customers_aadhaar   ON customers(aadhaar_number) WHERE aadhaar_number != '';

-- Trigram index for fast name search
CREATE INDEX IF NOT EXISTS idx_customers_name_trgm ON customers USING GIN (full_name gin_trgm_ops);

-- ────────────────────────────────────────────────────────────
-- TABLE: devices
-- Normalised device/IMEI entity
-- One row per physical device (identified by IMEI1)
-- Can be purchased and sold multiple times (lifecycle tracking)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS devices (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id          UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    imei1            TEXT NOT NULL,
    imei2            TEXT NOT NULL DEFAULT '',
    brand            TEXT NOT NULL,
    model            TEXT NOT NULL,
    storage          TEXT NOT NULL DEFAULT '',
    color            TEXT NOT NULL DEFAULT '',
    condition_label  TEXT NOT NULL DEFAULT '',   -- "New", "Used", "Refurbished"
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- IMEI can appear multiple times (purchase → sale → repurchase cycles)
-- No UNIQUE on imei1 at device level — transactions handle lifecycle
CREATE INDEX IF NOT EXISTS idx_devices_shop_id ON devices(shop_id);
CREATE INDEX IF NOT EXISTS idx_devices_imei1   ON devices(imei1);
CREATE INDEX IF NOT EXISTS idx_devices_imei2   ON devices(imei2) WHERE imei2 != '';
CREATE INDEX IF NOT EXISTS idx_devices_brand_model ON devices(brand, model);

-- ────────────────────────────────────────────────────────────
-- TABLE: transactions
-- Core ledger table — every purchase and sale
-- Replaces Room's mobile_entries with proper normalisation
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    android_txn_id      TEXT,                   -- transactionId from Android Room (for sync dedup)
    shop_id             UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    device_id           UUID NOT NULL REFERENCES devices(id) ON DELETE RESTRICT,
    customer_id         UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    txn_type            TEXT NOT NULL CHECK (txn_type IN ('Purchase', 'Sale', 'Repair')),
    amount              INTEGER NOT NULL CHECK (amount >= 0),
    payment_method      TEXT NOT NULL DEFAULT 'Cash' CHECK (payment_method IN ('Cash', 'Online', 'Cheque')),
    remarks             TEXT NOT NULL DEFAULT '',
    purpose             TEXT NOT NULL DEFAULT '',
    bill_number         TEXT NOT NULL DEFAULT '',
    txn_date            TIMESTAMPTZ NOT NULL,   -- actual transaction date (from Android createdAtMillis)
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Prevent duplicate sync — same Android record synced twice
    UNIQUE (shop_id, android_txn_id)
);

CREATE INDEX IF NOT EXISTS idx_transactions_shop_id    ON transactions(shop_id);
CREATE INDEX IF NOT EXISTS idx_transactions_device_id  ON transactions(device_id);
CREATE INDEX IF NOT EXISTS idx_transactions_customer_id ON transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_transactions_txn_type   ON transactions(txn_type);
CREATE INDEX IF NOT EXISTS idx_transactions_txn_date   ON transactions(txn_date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_payment    ON transactions(payment_method);

-- Composite for date-range reports
CREATE INDEX IF NOT EXISTS idx_transactions_shop_date  ON transactions(shop_id, txn_date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_shop_type_date ON transactions(shop_id, txn_type, txn_date DESC);

-- ────────────────────────────────────────────────────────────
-- TABLE: transaction_media
-- Documents attached to a transaction
-- Replaces Room's entry_media with better categorisation
-- Files stored outside web root — served via signed URLs
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transaction_media (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_id   UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    shop_id          UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    file_path        TEXT NOT NULL DEFAULT '',  -- relative path from uploads root (legacy)
    firebase_url     TEXT NOT NULL DEFAULT '',  -- Firebase Storage download URL
    file_name        TEXT NOT NULL DEFAULT '',  -- original filename
    mime_type        TEXT NOT NULL DEFAULT '',
    file_size_bytes  INTEGER NOT NULL DEFAULT 0,
    category         TEXT NOT NULL DEFAULT 'other'
                     CHECK (category IN ('aadhaar_front','aadhaar_back','pan','invoice',
                                         'customer_photo','device_image','warranty','bill','other')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_txn_media_transaction_id ON transaction_media(transaction_id);
CREATE INDEX IF NOT EXISTS idx_txn_media_shop_id        ON transaction_media(shop_id);
CREATE INDEX IF NOT EXISTS idx_txn_media_category       ON transaction_media(category);

-- ────────────────────────────────────────────────────────────
-- TABLE: timeline_events
-- Mirrors Android's timeline_events
-- Immutable audit log — one event per transaction action
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS timeline_events (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id          UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    transaction_id   UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    device_id        UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    imei1            TEXT NOT NULL,             -- denormalised for fast IMEI lookup
    imei2            TEXT NOT NULL DEFAULT '',
    event_type       TEXT NOT NULL CHECK (event_type IN ('Purchase', 'Sale', 'Repair')),
    title            TEXT NOT NULL,
    value            TEXT NOT NULL DEFAULT '',
    event_date       TIMESTAMPTZ NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_timeline_shop_id        ON timeline_events(shop_id);
CREATE INDEX IF NOT EXISTS idx_timeline_transaction_id ON timeline_events(transaction_id);
CREATE INDEX IF NOT EXISTS idx_timeline_device_id      ON timeline_events(device_id);
CREATE INDEX IF NOT EXISTS idx_timeline_imei1          ON timeline_events(imei1);
CREATE INDEX IF NOT EXISTS idx_timeline_event_date     ON timeline_events(event_date DESC);

-- ────────────────────────────────────────────────────────────
-- TABLE: sync_log
-- Tracks every Android device sync operation
-- Enables conflict resolution and delta sync
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_log (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id          UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    android_device_id TEXT NOT NULL,            -- Android device identifier
    entity_type      TEXT NOT NULL,             -- 'transaction', 'customer', 'device', 'media'
    entity_id        UUID,                      -- server-side entity UUID
    android_id       TEXT,                      -- Android local Room ID or transactionId
    operation        TEXT NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
    sync_status      TEXT NOT NULL DEFAULT 'success' CHECK (sync_status IN ('success', 'failed', 'conflict')),
    conflict_detail  JSONB,                     -- conflict resolution metadata
    synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_log_shop_id   ON sync_log(shop_id);
CREATE INDEX IF NOT EXISTS idx_sync_log_entity    ON sync_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_sync_log_synced_at ON sync_log(synced_at DESC);

-- ────────────────────────────────────────────────────────────
-- TABLE: premium_plans
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS premium_plans (
    id               TEXT PRIMARY KEY,
    sku_id           TEXT NOT NULL,
    name             TEXT NOT NULL,
    name_hi          TEXT NOT NULL DEFAULT '',
    name_gu          TEXT NOT NULL DEFAULT '',
    price            INTEGER NOT NULL,
    currency         TEXT NOT NULL DEFAULT '₹',
    duration         INTEGER NOT NULL,
    unit             TEXT NOT NULL DEFAULT 'months',
    popular          BOOLEAN NOT NULL DEFAULT FALSE,
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed initial plans
INSERT INTO premium_plans (id, sku_id, name, name_hi, name_gu, price, currency, duration, unit, popular, is_active)
VALUES
  ('plan_6m', 'play_premium_6m', '6 Months', '6 महीने', '6 મહિના', 599, '₹', 6, 'months', false, true),
  ('plan_1y', 'play_premium_1y', '1 Year', '1 साल', '1 વર્ષ', 999, '₹', 12, 'months', true, true)
ON CONFLICT (id) DO UPDATE SET
  price = EXCLUDED.price,
  sku_id = EXCLUDED.sku_id,
  updated_at = NOW();

-- ────────────────────────────────────────────────────────────
-- TABLE: shop_plan_activations
-- Tracks plan purchase / activation history
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shop_plan_activations (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id      UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    plan_id      TEXT REFERENCES premium_plans(id) ON DELETE SET NULL,
    price_paid   INTEGER NOT NULL DEFAULT 0,
    activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at   TIMESTAMPTZ NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shop_plan_activations_shop_id ON shop_plan_activations(shop_id);
CREATE INDEX IF NOT EXISTS idx_shop_plan_activations_activated_at ON shop_plan_activations(activated_at);

-- ────────────────────────────────────────────────────────────
-- TABLE: special_offers
-- One Time Offer (OTO) popup — backend-managed promotional offer
-- Admin configures discount, price, countdown timer.
-- App reads via GET /api/v1/shop/plans (offer field)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS special_offers (
    id                  TEXT PRIMARY KEY,
    is_active           BOOLEAN NOT NULL DEFAULT FALSE,
    title               TEXT NOT NULL DEFAULT 'One Time Offer',
    title_hi            TEXT NOT NULL DEFAULT 'एक बार का ऑफर',
    title_gu            TEXT NOT NULL DEFAULT 'એક વખત ઓફર',
    subtitle            TEXT NOT NULL DEFAULT 'Limited Time Offer',
    subtitle_hi         TEXT NOT NULL DEFAULT 'सीमित समय ऑफर',
    subtitle_gu         TEXT NOT NULL DEFAULT 'સીમિત સમય ઓફર',
    discount_pct        INTEGER NOT NULL DEFAULT 40,
    plan_id             TEXT REFERENCES premium_plans(id) ON DELETE SET NULL,
    original_price      INTEGER NOT NULL DEFAULT 999,
    offer_price         INTEGER NOT NULL DEFAULT 599,
    currency            TEXT NOT NULL DEFAULT '₹',
    price_unit          TEXT NOT NULL DEFAULT 'per year',
    price_unit_hi       TEXT NOT NULL DEFAULT 'प्रति वर्ष',
    price_unit_gu       TEXT NOT NULL DEFAULT 'દર વર્ષ',
    countdown_seconds   INTEGER NOT NULL DEFAULT 600,
    bg_gradient_start   TEXT NOT NULL DEFAULT '#0f0f1a',
    bg_gradient_end     TEXT NOT NULL DEFAULT '#1a0a2e',
    accent_color_start  TEXT NOT NULL DEFAULT '#FF6B6B',
    accent_color_end    TEXT NOT NULL DEFAULT '#FF8E53',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed: Default inactive offer linked to 1-year plan
INSERT INTO special_offers (
  id, is_active, title, title_hi, title_gu,
  subtitle, subtitle_hi, subtitle_gu,
  discount_pct, plan_id,
  original_price, offer_price, currency, price_unit, price_unit_hi, price_unit_gu,
  countdown_seconds, bg_gradient_start, bg_gradient_end, accent_color_start, accent_color_end
) VALUES (
  'oto_main', FALSE,
  'One Time Offer', 'एक बार का ऑफर', 'એક વખત ઓફર',
  'Limited Time Offer', 'सीमित समय ऑफर', 'સીમિત સમય ઓફર',
  40, 'plan_1y', 999, 599, '₹', 'per year', 'प्रति वर्ष', 'દર વર્ષ',
  600, '#0f0f1a', '#1a0a2e', '#FF6B6B', '#FF8E53'
) ON CONFLICT (id) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- VIEW: imei_lifecycle
-- Replaces timeline_events aggregation queries on Android
-- Shows full ownership chain for any IMEI
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW imei_lifecycle AS
SELECT
    d.imei1,
    d.imei2,
    d.brand,
    d.model,
    d.storage,
    d.color,
    t.txn_type,
    t.amount,
    t.payment_method,
    t.txn_date,
    c.full_name   AS customer_name,
    c.mobile      AS customer_mobile,
    t.shop_id,
    t.id          AS transaction_id,
    d.id          AS device_id
FROM transactions t
JOIN devices d    ON d.id = t.device_id
JOIN customers c  ON c.id = t.customer_id
ORDER BY t.txn_date ASC;

-- ────────────────────────────────────────────────────────────
-- VIEW: current_stock
-- Mirrors Android's getInStockDevices() SQL logic
-- A device is "in stock" when its latest transaction is a Purchase
-- and no Sale has occurred after that Purchase
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW current_stock AS
SELECT DISTINCT ON (d.imei1)
    d.id          AS device_id,
    d.imei1,
    d.imei2,
    d.brand,
    d.model,
    d.storage,
    d.color,
    d.condition_label,
    t.amount      AS purchase_price,
    t.payment_method,
    t.txn_date    AS purchased_at,
    t.shop_id,
    t.id          AS last_transaction_id
FROM devices d
JOIN transactions t ON t.device_id = d.id
WHERE t.txn_type = 'Purchase'
  AND NOT EXISTS (
      SELECT 1 FROM transactions s
      WHERE s.device_id = d.id
        AND s.txn_type = 'Sale'
        AND s.txn_date > t.txn_date
  )
ORDER BY d.imei1, t.txn_date DESC;

-- ────────────────────────────────────────────────────────────
-- FUNCTION: update_updated_at()
-- Auto-updates updated_at timestamp on row update
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to all tables with updated_at (DROP first to make idempotent)
DROP TRIGGER IF EXISTS trg_shops_updated_at        ON shops;
DROP TRIGGER IF EXISTS trg_customers_updated_at    ON customers;
DROP TRIGGER IF EXISTS trg_devices_updated_at      ON devices;
DROP TRIGGER IF EXISTS trg_transactions_updated_at ON transactions;
DROP TRIGGER IF EXISTS trg_premium_plans_updated_at ON premium_plans;

CREATE TRIGGER trg_shops_updated_at
    BEFORE UPDATE ON shops
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_customers_updated_at
    BEFORE UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_devices_updated_at
    BEFORE UPDATE ON devices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_transactions_updated_at
    BEFORE UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_premium_plans_updated_at
    BEFORE UPDATE ON premium_plans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ────────────────────────────────────────────────────────────
-- FEEDBACK & IMPROVEMENT CENTER TABLES
-- ────────────────────────────────────────────────────────────

-- Sequence for ticket numbering (e.g., MK-2026-000245)
CREATE SEQUENCE IF NOT EXISTS feedback_ticket_seq
    START WITH 1
    INCREMENT BY 1
    NO MAXVALUE
    CACHE 1;

-- TABLE: feedback_tickets
-- Stores main feedback tickets
CREATE TABLE IF NOT EXISTS feedback_tickets (
    id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    ticket_number     TEXT        NOT NULL UNIQUE,
    shop_id           UUID        REFERENCES shops(id) ON DELETE SET NULL,
    feedback_type     TEXT        NOT NULL DEFAULT 'other'
                      CHECK (feedback_type IN (
                        'bug_report','feature_request','improvement',
                        'ui_ux','performance','payment_issue',
                        'premium_issue','report_issue','sync_issue','other'
                      )),
    subject           TEXT        NOT NULL DEFAULT '',
    description       TEXT        NOT NULL DEFAULT '',
    status            TEXT        NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','under_review','in_progress','resolved','closed')),
    priority          TEXT        NOT NULL DEFAULT 'medium'
                      CHECK (priority IN ('critical','high','medium','low')),
    app_version       TEXT        NOT NULL DEFAULT '',
    app_version_code  TEXT        NOT NULL DEFAULT '',
    android_version   TEXT        NOT NULL DEFAULT '',
    device_brand      TEXT        NOT NULL DEFAULT '',
    device_model      TEXT        NOT NULL DEFAULT '',
    screen_resolution TEXT        NOT NULL DEFAULT '',
    app_language      TEXT        NOT NULL DEFAULT '',
    subscription_status TEXT      NOT NULL DEFAULT '',
    login_account     TEXT        NOT NULL DEFAULT '',
    firebase_uid      TEXT        NOT NULL DEFAULT '',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at       TIMESTAMPTZ DEFAULT NULL,
    closed_at         TIMESTAMPTZ DEFAULT NULL
);

-- TABLE: feedback_attachments
-- Stores attachments (screenshots, videos, voice notes) in Firebase Storage
CREATE TABLE IF NOT EXISTS feedback_attachments (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    ticket_id       UUID        NOT NULL REFERENCES feedback_tickets(id) ON DELETE CASCADE,
    shop_id         UUID        REFERENCES shops(id) ON DELETE SET NULL,
    firebase_url    TEXT        NOT NULL DEFAULT '',
    file_name       TEXT        NOT NULL DEFAULT '',
    mime_type       TEXT        NOT NULL DEFAULT '',
    file_size_bytes INTEGER     NOT NULL DEFAULT 0,
    attachment_type TEXT        NOT NULL DEFAULT 'document'
                    CHECK (attachment_type IN ('screenshot','video','voice','document')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- TABLE: feedback_replies
-- Threaded user and admin conversation
CREATE TABLE IF NOT EXISTS feedback_replies (
    id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    ticket_id     UUID        NOT NULL REFERENCES feedback_tickets(id) ON DELETE CASCADE,
    sender_type   TEXT        NOT NULL CHECK (sender_type IN ('user','admin')),
    sender_label  TEXT        NOT NULL DEFAULT '',
    message       TEXT        NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- TABLE: feedback_notes
-- Internal admin notes (not visible to user)
CREATE TABLE IF NOT EXISTS feedback_notes (
    id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    ticket_id  UUID        NOT NULL REFERENCES feedback_tickets(id) ON DELETE CASCADE,
    admin_uid  TEXT        NOT NULL DEFAULT '',
    note       TEXT        NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for feedback tables
CREATE INDEX IF NOT EXISTS idx_feedback_tickets_shop_id    ON feedback_tickets(shop_id);
CREATE INDEX IF NOT EXISTS idx_feedback_tickets_status     ON feedback_tickets(status);
CREATE INDEX IF NOT EXISTS idx_feedback_tickets_priority   ON feedback_tickets(priority);
CREATE INDEX IF NOT EXISTS idx_feedback_tickets_type       ON feedback_tickets(feedback_type);
CREATE INDEX IF NOT EXISTS idx_feedback_tickets_created_at ON feedback_tickets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_attachments_ticket ON feedback_attachments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_feedback_replies_ticket     ON feedback_replies(ticket_id);
CREATE INDEX IF NOT EXISTS idx_feedback_notes_ticket       ON feedback_notes(ticket_id);

-- Attach trigger for feedback_tickets
DROP TRIGGER IF EXISTS trg_feedback_tickets_updated_at ON feedback_tickets;
CREATE TRIGGER trg_feedback_tickets_updated_at
    BEFORE UPDATE ON feedback_tickets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ────────────────────────────────────────────────────────────
-- UNIFIED BILL BOOK TABLES
-- ────────────────────────────────────────────────────────────

-- TABLE: bills
-- Consolidated bills generated manually or from other modules
CREATE TABLE IF NOT EXISTS bills (
    id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    remote_id           UUID        UNIQUE DEFAULT uuid_generate_v4(),
    android_bill_id     BIGINT      NOT NULL DEFAULT 0,
    shop_id             UUID        REFERENCES shops(id) ON DELETE CASCADE,
    bill_number         TEXT        NOT NULL DEFAULT '',
    bill_type           TEXT        NOT NULL DEFAULT 'Invoice'
                        CHECK (bill_type IN ('Cash Bill','Estimate','Invoice','Receipt','Quotation','Custom Bill')),
    source_module       TEXT        NOT NULL DEFAULT 'manual'
                        CHECK (source_module IN (
                          'manual','mobile_sale','mobile_purchase','mobile_repair',
                          'accessories_sale','accessories_purchase'
                        )),
    payment_status      TEXT        NOT NULL DEFAULT 'Paid'
                        CHECK (payment_status IN ('Draft','Paid','Unpaid','Partial Payment','Cancelled')),
    customer_name       TEXT        NOT NULL DEFAULT '',
    customer_mobile     TEXT        NOT NULL DEFAULT '',
    customer_address    TEXT        NOT NULL DEFAULT '',
    customer_gstin      TEXT        NOT NULL DEFAULT '',
    items_json          TEXT        NOT NULL DEFAULT '[]',
    subtotal            DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    tax_percent         DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    tax_amount          DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    discount_amount     DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    grand_total         DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    payment_method      TEXT        NOT NULL DEFAULT 'Cash',
    template_type       TEXT        NOT NULL DEFAULT 'Simple',
    timeline_json       TEXT        NOT NULL DEFAULT '[]',
    created_at_millis   BIGINT      NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (shop_id, android_bill_id)
);

CREATE INDEX IF NOT EXISTS idx_bills_shop_id        ON bills(shop_id);
CREATE INDEX IF NOT EXISTS idx_bills_bill_number    ON bills(bill_number);
CREATE INDEX IF NOT EXISTS idx_bills_customer_phone ON bills(customer_mobile);
CREATE INDEX IF NOT EXISTS idx_bills_source_module  ON bills(source_module);
CREATE INDEX IF NOT EXISTS idx_bills_created_at     ON bills(created_at_millis DESC);

-- Attach trigger for bills
DROP TRIGGER IF EXISTS trg_bills_updated_at ON bills;
CREATE TRIGGER trg_bills_updated_at
    BEFORE UPDATE ON bills
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


