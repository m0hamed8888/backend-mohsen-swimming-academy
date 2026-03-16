const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const Trainer = require('../models/Trainer');
const Swimmer = require('../models/Swimmer');
const { protect, requireBoss } = require('../middleware/auth');

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

/* ────────────────────────────────────────────────────────────
   POST /api/auth/login
   ──────────────────────────────────────────────────────────── */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ success: false, message: 'اسم المستخدم وكلمة المرور مطلوبان' });

    const trainer = await Trainer.findOne({ username: username.toLowerCase() }).select('+password');
    if (!trainer || !(await trainer.comparePassword(password)))
      return res.status(401).json({ success: false, message: 'بيانات الدخول غير صحيحة' });
    if (!trainer.isActive)
      return res.status(403).json({ success: false, message: 'الحساب محظور' });

    const token = signToken(trainer._id);
    res.json({
      success: true, token,
      trainer: { id: trainer._id, name: trainer.name, username: trainer.username, role: trainer.role },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في تسجيل الدخول' });
  }
});

/* ────────────────────────────────────────────────────────────
   POST /api/auth/register-trainer  — Boss فقط
   ──────────────────────────────────────────────────────────── */
router.post('/register-trainer', protect, requireBoss, async (req, res) => {
  try {
    const { name, username, password, role } = req.body;
    const exists = await Trainer.findOne({ username: username?.toLowerCase() });
    if (exists)
      return res.status(400).json({ success: false, message: 'اسم المستخدم موجود بالفعل' });

    const trainer = await Trainer.create({ name, username, password, role: role || 'trainer' });
    res.status(201).json({
      success: true,
      message: 'تم إنشاء حساب الكابتن بنجاح',
      trainer: { id: trainer._id, name: trainer.name, username: trainer.username, role: trainer.role },
    });
  } catch (err) {
    if (err.name === 'ValidationError') {
      const msgs = Object.values(err.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: msgs.join(' — ') });
    }
    res.status(500).json({ success: false, message: 'خطأ في إنشاء الحساب' });
  }
});

/* ────────────────────────────────────────────────────────────
   GET /api/auth/trainers  — Boss: جلب كل الكابتنات
   ──────────────────────────────────────────────────────────── */
/* ────────────────────────────────────────────────────────────
   GET /api/auth/public-trainers  — عام، بدون token
   قائمة الكابتنات للسباح عند التسجيل
   ──────────────────────────────────────────────────────────── */
router.get('/public-trainers', async (req, res) => {
  try {
    const trainers = await Trainer.find({ role: 'trainer', isActive: true })
      .select('name _id')
      .sort({ name: 1 });
    res.json({ success: true, data: trainers });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في الخادم' });
  }
});

router.get('/trainers', protect, requireBoss, async (req, res) => {
  try {
    const trainers = await Trainer.find({ role: 'trainer' })
      .select('-password')
      .sort({ createdAt: -1 });

    // إحصائيات لكل كابتن
    const data = await Promise.all(trainers.map(async (t) => {
      const total    = await Swimmer.countDocuments({ trainer: t._id });
      const active   = await Swimmer.countDocuments({ trainer: t._id, isActive: true });
      return {
        id:        t._id,
        name:      t.name,
        username:  t.username,
        isActive:  t.isActive,
        createdAt: t.createdAt,
        total,
        active,
        inactive: total - active,
      };
    }));

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في الخادم' });
  }
});

/* ────────────────────────────────────────────────────────────
   GET /api/auth/trainers/:id  — Boss: بيانات كابتن معين
   ──────────────────────────────────────────────────────────── */
router.get('/trainers/:id', protect, requireBoss, async (req, res) => {
  try {
    const trainer = await Trainer.findById(req.params.id).select('-password');
    if (!trainer)
      return res.status(404).json({ success: false, message: 'الكابتن غير موجود' });
    res.json({ success: true, data: trainer });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في الخادم' });
  }
});

/* ────────────────────────────────────────────────────────────
   PUT /api/auth/trainers/:id  — Boss: تعديل بيانات كابتن
   Body: { name?, username?, isActive? }
   ──────────────────────────────────────────────────────────── */
router.put('/trainers/:id', protect, requireBoss, async (req, res) => {
  try {
    const { name, username, isActive } = req.body;
    const trainer = await Trainer.findById(req.params.id);
    if (!trainer)
      return res.status(404).json({ success: false, message: 'الكابتن غير موجود' });
    if (trainer.role === 'boss')
      return res.status(403).json({ success: false, message: 'لا يمكن تعديل حساب الـ Boss' });

    // التحقق من تكرار اليوزرنيم
    if (username && username.toLowerCase() !== trainer.username) {
      const exists = await Trainer.findOne({ username: username.toLowerCase() });
      if (exists)
        return res.status(400).json({ success: false, message: 'اسم المستخدم موجود بالفعل' });
      trainer.username = username.toLowerCase();
    }
    if (name      !== undefined) trainer.name     = name.trim();
    if (isActive  !== undefined) trainer.isActive = isActive === true || isActive === 'true';

    await trainer.save();
    res.json({
      success: true,
      message: 'تم تحديث بيانات الكابتن',
      data: { id: trainer._id, name: trainer.name, username: trainer.username, isActive: trainer.isActive },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في التحديث: ' + err.message });
  }
});

/* ────────────────────────────────────────────────────────────
   PUT /api/auth/trainers/:id/password  — Boss: تغيير باسورد
   Body: { newPassword }
   ──────────────────────────────────────────────────────────── */
router.put('/trainers/:id/password', protect, requireBoss, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6)
      return res.status(400).json({ success: false, message: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });

    const trainer = await Trainer.findById(req.params.id).select('+password');
    if (!trainer)
      return res.status(404).json({ success: false, message: 'الكابتن غير موجود' });
    if (trainer.role === 'boss')
      return res.status(403).json({ success: false, message: 'لا يمكن تغيير باسورد الـ Boss من هنا' });

    trainer.password = newPassword;   // الـ pre-save hook هيعمل hash تلقائياً
    await trainer.save();

    res.json({ success: true, message: 'تم تغيير كلمة المرور بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في تغيير الباسورد' });
  }
});

/* ────────────────────────────────────────────────────────────
   DELETE /api/auth/trainers/:id  — Boss: حذف كابتن
   ──────────────────────────────────────────────────────────── */
router.delete('/trainers/:id', protect, requireBoss, async (req, res) => {
  try {
    const trainer = await Trainer.findById(req.params.id);
    if (!trainer)
      return res.status(404).json({ success: false, message: 'الكابتن غير موجود' });
    if (trainer.role === 'boss')
      return res.status(403).json({ success: false, message: 'لا يمكن حذف حساب الـ Boss' });

    // تحويل مشتركي الكابتن المحذوف إلى null (أو يمكن نقلهم)
    await Swimmer.updateMany({ trainer: trainer._id }, { trainer: null });
    await Trainer.findByIdAndDelete(trainer._id);

    res.json({ success: true, message: `تم حذف الكابتن "${trainer.name}" بنجاح` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في الحذف' });
  }
});

/* ────────────────────────────────────────────────────────────
   GET /api/auth/me
   ──────────────────────────────────────────────────────────── */
router.get('/me', protect, (req, res) => {
  res.json({ success: true, trainer: req.trainer });
});

module.exports = router;