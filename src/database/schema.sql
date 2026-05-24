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

CREATE INDEX IF NOT EXISTS idx_shops_firebase_uid ON shops(firebase_uid);

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
    txn_type            TEXT NOT NULL CHECK (txn_type IN ('Purchase', 'Sale')),
    amount              INTEGER NOT NULL CHECK (amount >= 0),
    payment_method      TEXT NOT NULL DEFAULT 'Cash' CHECK (payment_method IN ('Cash', 'Online', 'Cheque')),
    remarks             TEXT NOT NULL DEFAULT '',
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
    file_path        TEXT NOT NULL,             -- relative path from uploads root
    file_name        TEXT NOT NULL,             -- original filename
    mime_type        TEXT NOT NULL DEFAULT '',
    file_size_bytes  INTEGER NOT NULL DEFAULT 0,
    category         TEXT NOT NULL DEFAULT 'other'
                     CHECK (category IN ('aadhaar_front','aadhaar_back','pan','invoice',
                                         'customer_photo','device_image','warranty','other')),
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
    event_type       TEXT NOT NULL CHECK (event_type IN ('Purchase', 'Sale')),
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
