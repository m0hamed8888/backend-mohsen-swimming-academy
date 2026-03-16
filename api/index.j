require('dotenv').config();
const express   = require('express');
const mongoose  = require('mongoose');
const cors      = require('cors');
const { router: swimmerAuthRouter } = require('../routes/swimmer-auth');

const app = express();

/* ── Middleware ─────────────────────────────────────────────── */
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://127.0.0.1:5500',
    'http://localhost:5500',
    'http://127.0.0.1:3000',
    'http://localhost:3000',
  ],
  methods:        ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials:    true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ── Health check ────────────────────────────────────────────── */
app.get('/health', (req, res) => {
  res.json({
    status:    'ok',
    service:   'AquaElite API',
    timestamp: new Date().toISOString(),
    db:        mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});

/* ── Routes ─────────────────────────────────────────────────── */
app.use('/api/auth',         require('../routes/auth'));
app.use('/api/swimmers',     require('../routes/swimmers'));
app.use('/api/attendance',   require('../routes/attendance'));
app.use('/api/swimmer-auth', swimmerAuthRouter);

/* ── 404 handler ─────────────────────────────────────────────── */
app.use((req, res) => {
  res.status(404).json({ success: false, message: `المسار ${req.originalUrl} غير موجود` });
});

/* ── Global error handler ────────────────────────────────────── */
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'development' ? err.message : 'خطأ في الخادم',
  });
});

/* ── Connect to MongoDB ──────────────────────────────────────── */
// Vercel = serverless، مفيش app.listen هنا
mongoose.connect(process.env.MONGO_URI).catch((err) => {
  console.error('❌ MongoDB connection failed:', err.message);
});

module.exports = app;
