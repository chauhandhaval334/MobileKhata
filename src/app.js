'use strict';

require('express-async-errors'); // Patches async route handlers to auto-call next(err)

const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const compression = require('compression');

const env = require('./config/env');
const logger = require('./utils/logger');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

// Route modules
const shopRoutesV1      = require('./routes/shopRoutesV1');
const shopRoutesV2      = require('./routes/shopRoutesV2');
const syncRoutesV1      = require('./routes/syncRoutesV1');
const syncRoutesV2      = require('./routes/syncRoutesV2');
const transactionRoutes = require('./routes/transactionRoutes');
const stockRoutes       = require('./routes/stockRoutes');
const customerRoutes    = require('./routes/customerRoutes');
const mediaRoutes       = require('./routes/mediaRoutes');
const reportRoutes      = require('./routes/reportRoutes');
const imeiRoutes        = require('./routes/imeiRoutes');
const adminRoutes       = require('./routes/adminRoutes');
const adminRoutesV2     = require('./routes/adminRoutesV2');
const feedbackRoutes    = require('./routes/feedbackRoutes');
const adminFeedbackRoutes = require('./routes/adminFeedbackRoutes');
const billRoutes        = require('./routes/billRoutes');
const websiteRoutes     = require('./routes/websiteRoutes');
const { getMaintenanceMode } = require('./utils/maintenanceStore');

const app = express();

// Trust Render/proxy X-Forwarded-For header (required for rate limiting behind reverse proxy)
app.set('trust proxy', 1);

// ─── Security Middleware ───────────────────────────────────────────────────────

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-origin' },
  contentSecurityPolicy: false, // API only — no HTML served
}));

// Build the set of allowed origins — includes the server's own URL so the
// admin panel (served from this very server) can make API calls to itself.
const SELF_URL = process.env.RENDER_EXTERNAL_URL   // e.g. https://mobilekhata.onrender.com
              || process.env.PUBLIC_URL
              || null;

const allowedOriginsSet = new Set([
  ...(env.allowedOrigins || []),
  ...(SELF_URL ? [SELF_URL] : []),
]);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, curl)
    if (!origin) return callback(null, true);
    // Allow any explicitly listed origin OR the server's own URL
    if (allowedOriginsSet.has(origin) || env.NODE_ENV === 'development') {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Id'],
  credentials: true,
}));

// ─── Rate Limiting ─────────────────────────────────────────────────────────────

const globalLimiter = rateLimit({
  windowMs: env.rateLimit.windowMs,
  max: env.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Rate limit exceeded', { ip: req.ip });
    res.status(429).json({
      success: false,
      error: 'Too many requests. Please slow down.',
      code: 'RATE_LIMIT_EXCEEDED',
    });
  },
});

// Stricter limiter for sync endpoints (prevent abuse)
const syncLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: { success: false, error: 'Sync rate limit exceeded', code: 'SYNC_RATE_LIMIT' },
});

app.use(globalLimiter);

// ─── Parsing & Compression ─────────────────────────────────────────────────────

app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ─── Request Logging ───────────────────────────────────────────────────────────

// Use morgan for HTTP access log, piped through winston
app.use(morgan('combined', {
  stream: { write: (msg) => logger.http(msg.trim()) },
  skip: (req) => req.url === '/health', // don't log health checks
}));

// ─── Health Check ──────────────────────────────────────────────────────────────

// Root /health endpoint is defined BEFORE maintenance mode middleware
// so it always returns 200 OK (critical for Render hosting health checks)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'mobilekhata-backend',
    version: '1.0.0',
    environment: env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// ─── Maintenance Mode Middleware ──────────────────────────────────────────────
app.use(async (req, res, next) => {
  // Exclude admin dashboard, static assets, and v2 admin routes
  if (
    req.path.startsWith('/admin') || 
    req.path.startsWith('/api/v2/admin') ||
    req.path.startsWith('/favicon.ico') ||
    req.path === '/' || req.path.startsWith('/assets') || req.path.startsWith('/api/v1/website')
  ) {
    return next();
  }

  const isMaintenance = await getMaintenanceMode();
  if (isMaintenance) {
    return res.status(503).json({
      success: false,
      error: 'Technical difficulties, we are improving something... patience!',
      code: 'SERVER_MAINTENANCE'
    });
  }
  next();
});

// ─── Admin Dashboard static route ──────────────────────────────────────────────
app.use('/admin', express.static(path.join(__dirname, '../public/admin')));

// ─── Public Website static route ───────────────────────────────────────────────
app.use('/', express.static(path.join(__dirname, '../public/website')));

// ─── Client API & Public Status Routes (Defined AFTER Maintenance Middleware) ───

app.get('/api/v1/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'mobilekhata-api',
    version: 'v1',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/v2/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'mobilekhata-api',
    version: 'v2',
    timestamp: new Date().toISOString(),
  });
});

// Public DB status endpoint — no auth required, for testing only
app.get('/api/v1/db-status', async (req, res) => {
  try {
    const { query } = require('./config/database');
    const result = await query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
       ORDER BY table_name`
    );
    res.json({
      success: true,
      database: 'connected',
      tables: result.rows.map(r => r.table_name),
      tableCount: result.rows.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ success: false, database: 'error', error: err.message });
  }
});

const V1 = '/api/v1';
const V2 = '/api/v2';

// ─── V1 API Routes ─────────────────────────────────────────────────────────────
app.use(`${V1}/shop`,          shopRoutesV1);
app.use(`${V1}/sync`,          syncLimiter, syncRoutesV1);
app.use(`${V1}/transactions`,  transactionRoutes);
app.use(`${V1}/stock`,         stockRoutes);
app.use(`${V1}/customers`,     customerRoutes);
app.use(`${V1}/media`,         mediaRoutes);
app.use(`${V1}/reports`,       reportRoutes);
app.use(`${V1}/imei`,          imeiRoutes);
app.use(`${V1}/admin`,         adminRoutes);
app.use(`${V1}/website`,       websiteRoutes);

// ─── V2 API Routes ─────────────────────────────────────────────────────────────
app.use(`${V2}/shop`,          shopRoutesV2);
app.use(`${V2}/sync`,          syncLimiter, syncRoutesV2);
app.use(`${V2}/transactions`,  transactionRoutes);
app.use(`${V2}/stock`,         stockRoutes);
app.use(`${V2}/customers`,     customerRoutes);
app.use(`${V2}/media`,         mediaRoutes);
app.use(`${V2}/reports`,       reportRoutes);
app.use(`${V2}/imei`,          imeiRoutes);
app.use(`${V2}/feedback`,      feedbackRoutes);
app.use(`${V2}/bills`,         billRoutes);
app.use(`${V2}/admin`,         adminRoutesV2);
app.use(`${V2}/admin/feedback`, adminFeedbackRoutes);
app.use(`${V2}/website`,       websiteRoutes);

// ─── 404 + Error Handlers ──────────────────────────────────────────────────────

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
