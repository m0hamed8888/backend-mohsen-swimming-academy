/**
 * rateLimit.js — Express Rate Limiting Middleware
 * AquaFlow Backend Protection
 *
 * Usage:
 *   const { loginLimiter, registerLimiter, swimmerLimiter } = require('./middleware/rateLimit');
 *   router.post('/login',            loginLimiter,   async (req,res) => {...});
 *   router.post('/register-trainer', registerLimiter, async (req,res) => {...});
 *   router.post('/swimmers/register', swimmerLimiter, async (req,res) => {...});
 */

// In-memory store (يكفي لـ single-process, استبدله بـ Redis لو في cluster)
const store = new Map();

/**
 * createLimiter(options) — factory function
 * @param {number} options.max         - عدد الطلبات المسموح بها
 * @param {number} options.windowMs    - الفترة الزمنية بالـ ms
 * @param {string} options.message     - الرسالة عند تجاوز الحد
 * @param {string} options.keyPrefix   - prefix للـ key عشان تتميز الـ limiters
 */
function createLimiter({ max, windowMs, message, keyPrefix = 'rl' }) {
  return function rateLimitMiddleware(req, res, next) {
    // استخدم IP + route كـ key
    const ip  = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'unknown';
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();

    let record = store.get(key);

    // إنشاء record جديد أو reset بعد انتهاء الـ window
    if (!record || now > record.resetAt) {
      record = { count: 0, resetAt: now + windowMs };
    }

    record.count++;
    store.set(key, record);

    // headers للـ client
    const remaining = Math.max(0, max - record.count);
    res.set({
      'X-RateLimit-Limit':     max,
      'X-RateLimit-Remaining': remaining,
      'X-RateLimit-Reset':     Math.ceil(record.resetAt / 1000),
    });

    if (record.count > max) {
      const retryAfter = Math.ceil((record.resetAt - now) / 1000);
      res.set('Retry-After', retryAfter);
      return res.status(429).json({
        success: false,
        message: message || 'محاولات كثيرة، حاول لاحقاً',
        retryAfter,
      });
    }

    next();
  };
}

/* ══════════════════════════════════════
   Pre-configured limiters
   ══════════════════════════════════════ */

/** تسجيل الدخول — 5 محاولات كل دقيقتين */
const loginLimiter = createLimiter({
  max:       5,
  windowMs:  2 * 60 * 1000,
  message:   'محاولات دخول كثيرة، انتظر دقيقتين',
  keyPrefix: 'login',
});

/** إنشاء حساب — 3 محاولات كل 10 دقائق */
const registerLimiter = createLimiter({
  max:       3,
  windowMs:  10 * 60 * 1000,
  message:   'تجاوزت الحد المسموح لإنشاء الحسابات، انتظر 10 دقائق',
  keyPrefix: 'register',
});

/** تسجيل سباح جديد — 20 محاولة كل ساعة */
const swimmerLimiter = createLimiter({
  max:       20,
  windowMs:  60 * 60 * 1000,
  message:   'تجاوزت الحد المسموح لتسجيل السباحين، انتظر ساعة',
  keyPrefix: 'swimmer',
});

/** حضور — 60 عملية كل دقيقة */
const attendanceLimiter = createLimiter({
  max:       60,
  windowMs:  60 * 1000,
  message:   'طلبات كثيرة جداً، انتظر قليلاً',
  keyPrefix: 'attend',
});

/** عام — للـ routes الأخرى */
const generalLimiter = createLimiter({
  max:       100,
  windowMs:  60 * 1000,
  message:   'طلبات كثيرة جداً',
  keyPrefix: 'general',
});

/* تنظيف تلقائي للـ store كل 10 دقائق عشان ما يتملاش الميموري */
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of store.entries()) {
    if (now > record.resetAt) store.delete(key);
  }
}, 10 * 60 * 1000);

module.exports = {
  createLimiter,
  loginLimiter,
  registerLimiter,
  swimmerLimiter,
  attendanceLimiter,
  generalLimiter,
};
