'use strict';

require('express-async-errors'); // Patches async route handlers to auto-call next(err)

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const compression = require('compression');

const env = require('./config/env');
const logger = require('./utils/logger');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

// Route modules
const shopRoutes        = require('./routes/shopRoutes');
const transactionRoutes = require('./routes/transactionRoutes');
const stockRoutes       = require('./routes/stockRoutes');
const customerRoutes    = require('./routes/customerRoutes');
const mediaRoutes       = require('./routes/mediaRoutes');
const reportRoutes      = require('./routes/reportRoutes');
const syncRoutes        = require('./routes/syncRoutes');
const imeiRoutes        = require('./routes/imeiRoutes');
const adminRoutes       = require('./routes/adminRoutes');

const app = express();

// ─── Security Middleware ───────────────────────────────────────────────────────

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-origin' },
  contentSecurityPolicy: false, // API only — no HTML served
}));

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman)
    if (!origin) return callback(null, true);
    if (env.allowedOrigins.includes(origin) || env.NODE_ENV === 'development') {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
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

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'mobilekhata-backend',
    version: '1.0.0',
    environment: env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/v1/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'mobilekhata-api',
    version: 'v1',
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

// ─── API Routes ────────────────────────────────────────────────────────────────

const API = '/api/v1';

app.use(`${API}/shop`,          shopRoutes);
app.use(`${API}/transactions`,  transactionRoutes);
app.use(`${API}/stock`,         stockRoutes);
app.use(`${API}/customers`,     customerRoutes);
app.use(`${API}/media`,         mediaRoutes);
app.use(`${API}/reports`,       reportRoutes);
app.use(`${API}/imei`,          imeiRoutes);
app.use(`${API}/sync`,          syncLimiter, syncRoutes);
app.use(`${API}/admin`,         adminRoutes);

// ─── 404 + Error Handlers ──────────────────────────────────────────────────────

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
