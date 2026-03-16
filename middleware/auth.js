const jwt     = require('jsonwebtoken');
const Trainer = require('../models/Trainer');

/* ── protect: أي كابتن مسجّل دخول ── */
const protect = async (req, res, next) => {
  try {
    let token;
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) token = auth.split(' ')[1];

    if (!token)
      return res.status(401).json({ success: false, message: 'غير مصرح — يرجى تسجيل الدخول أولاً' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const trainer = await Trainer.findById(decoded.id).select('-password');

    if (!trainer || !trainer.isActive)
      return res.status(401).json({ success: false, message: 'الحساب غير موجود أو محظور' });

    req.trainer = trainer;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'الـ token غير صالح أو منتهي الصلاحية' });
  }
};

/* ── requireBoss: boss فقط ── */
const requireBoss = (req, res, next) => {
  if (req.trainer?.role !== 'boss')
    return res.status(403).json({ success: false, message: 'هذه الصفحة للـ Boss فقط' });
  next();
};

module.exports = { protect, requireBoss };
