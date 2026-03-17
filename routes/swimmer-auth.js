/**
 * routes/swimmer-auth.js  — v3
 * - city مع SwimmerUser
 * - level (LV 1-10) من الكابتن أو البوس
 */

const express     = require('express');
const router      = express.Router();
const jwt         = require('jsonwebtoken');
const SwimmerUser = require('../models/SwimmerUser');
const Swimmer     = require('../models/Swimmer');
const { registerLimiter, loginLimiter, swimmerLimiter } = require('../middleware/rateLimit');

const signToken = (id) =>
  jwt.sign({ id, type: 'swimmer' }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '30d',
  });

const protectSwimmer = async (req, res, next) => {
  try {
    let token;
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) token = auth.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'غير مصرح' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== 'swimmer')
      return res.status(401).json({ success: false, message: 'token غير صالح' });
    const user = await SwimmerUser.findById(decoded.id);
    if (!user || !user.isActive)
      return res.status(401).json({ success: false, message: 'الحساب غير موجود أو محظور' });
    req.swimmerUser = user;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'الـ token غير صالح' });
  }
};

const { protect: protectTrainer, requireBoss } = require('../middleware/auth');

/* ── POST /register ── */
router.post('/register', registerLimiter, async (req, res) => {
  try {
    const { username, password, displayName, phone, city } = req.body;
    if (!username || !password)
      return res.status(400).json({ success: false, message: 'اسم المستخدم وكلمة المرور مطلوبان' });

    const exists = await SwimmerUser.findOne({ username: username.toLowerCase() });
    if (exists)
      return res.status(400).json({ success: false, message: 'اسم المستخدم مستخدم بالفعل' });

    const user  = await SwimmerUser.create({ username, password, displayName: displayName || '', phone: phone || '', city: city || null });
    const token = signToken(user._id);

    res.status(201).json({
      success: true, message: 'تم إنشاء الحساب بنجاح', token,
      user: { id: user._id, username: user.username, displayName: user.displayName, phone: user.phone, city: user.city, createdAt: user.createdAt, swimmers: [] },
    });
  } catch (err) {
    if (err.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: Object.values(err.errors).map(e => e.message).join(' — ') });
    }
    res.status(500).json({ success: false, message: 'خطأ في إنشاء الحساب' });
  }
});

/* ── POST /login ── */
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ success: false, message: 'اسم المستخدم وكلمة المرور مطلوبان' });
    const user = await SwimmerUser.findOne({ username: username.toLowerCase() }).select('+password');
    if (!user || !(await user.comparePassword(password)))
      return res.status(401).json({ success: false, message: 'بيانات الدخول غير صحيحة' });
    if (!user.isActive)
      return res.status(403).json({ success: false, message: 'الحساب محظور' });
    const token = signToken(user._id);
    res.json({
      success: true, token,
      user: { id: user._id, username: user.username, displayName: user.displayName, phone: user.phone, city: user.city, createdAt: user.createdAt, swimmerCount: user.swimmers.length },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في تسجيل الدخول' });
  }
});

/* ── POST /add-swimmer ── */
router.post('/add-swimmer', protectSwimmer, swimmerLimiter, async (req, res) => {
  try {
    const { fullName, dob, phone, swamBefore, egyptStars, starsCount, goal, sessionsCount, trainingDays, restDay, trainingTime, subscriptionExpiry, trainerId, trainerName } = req.body;
    if (!fullName || !dob || !goal || !sessionsCount)
      return res.status(400).json({ success: false, message: 'اكمل الحقول المطلوبة' });

    const sessCount = Number(sessionsCount);
    let finalDays = trainingDays?.map(Number) || [];
    if (sessCount === 24 && restDay !== undefined)
      finalDays = [0,1,2,3,4,5,6].filter(d => d !== Number(restDay));

    const expected = { 8:2, 12:3, 24:6 }[sessCount];
    if (expected && finalDays.length !== expected)
      return res.status(400).json({ success: false, message: `اشتراك ${sessCount} حصة يتطلب ${expected} أيام` });

    const swimmer = await Swimmer.create({
      fullName: fullName.trim(), dob,
      phone: phone || req.swimmerUser.phone || '',
      swamBefore: swamBefore || 'no',
      egyptStars: swamBefore === 'yes' ? (egyptStars || null) : null,
      starsCount:  swamBefore === 'yes' ? (starsCount  || null) : null,
      goal, sessionsCount: sessCount, trainingDays: finalDays,
      restDay: sessCount === 24 ? Number(restDay) : null,
      trainingSchedule: 'custom',
      trainingTime: trainingTime || null,
      subscriptionExpiry: subscriptionExpiry || null,
      trainerName: trainerName || null,
      trainer: trainerId || null,
      rating: 0,
    });

    req.swimmerUser.swimmers.push(swimmer._id);
    await req.swimmerUser.save();

    res.status(201).json({ success: true, message: 'تم إضافة بياناتك بنجاح', data: { subscriptionId: swimmer.subscriptionId, fullName: swimmer.fullName } });
  } catch (err) {
    if (err.name === 'ValidationError')
      return res.status(400).json({ success: false, message: Object.values(err.errors).map(e => e.message).join(' — ') });
    res.status(500).json({ success: false, message: 'خطأ في الحفظ' });
  }
});

/* ── GET /my-swimmers ── */
router.get('/my-swimmers', protectSwimmer, async (req, res) => {
  try {
    const user = await SwimmerUser.findById(req.swimmerUser._id).populate({ path: 'swimmers', select: '-__v' });
    res.json({ success: true, total: user.swimmers.length, swimmers: user.swimmers });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب البيانات' });
  }
});

/* ── GET /me ── */
router.get('/me', protectSwimmer, async (req, res) => {
  const user = await SwimmerUser.findById(req.swimmerUser._id);
  res.json({ success: true, user: { id: user._id, username: user.username, displayName: user.displayName, phone: user.phone, city: user.city, swimmerCount: user.swimmers.length, createdAt: user.createdAt } });
});

/* ── PUT /swimmers/:subscriptionId/rating — نجوم 1-5 ── */
router.put('/swimmers/:subscriptionId/rating', protectTrainer, async (req, res) => {
  try {
    const { rating, ratingNote } = req.body;
    if (!rating || rating < 1 || rating > 5)
      return res.status(400).json({ success: false, message: 'التقييم يجب أن يكون من 1 إلى 5' });
    const isBoss = req.trainer.role === 'boss';
    const filter = { subscriptionId: req.params.subscriptionId };
    if (!isBoss) filter.trainer = req.trainer._id;
    const swimmer = await Swimmer.findOneAndUpdate(filter, { rating, ratingNote: ratingNote || '', ratingUpdatedBy: req.trainer.name, ratingUpdatedAt: new Date() }, { new: true });
    if (!swimmer)
      return res.status(404).json({ success: false, message: 'السباح غير موجود أو لا تملك صلاحية تقييمه' });
    res.json({ success: true, message: 'تم تحديث التقييم', data: { rating: swimmer.rating, ratingNote: swimmer.ratingNote } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في التقييم' });
  }
});

/* ── PUT /swimmers/:subscriptionId/level — LV 1-10 ── */
router.put('/swimmers/:subscriptionId/level', protectTrainer, async (req, res) => {
  try {
    const { level, levelNote } = req.body;
    if (!level || level < 1 || level > 10)
      return res.status(400).json({ success: false, message: 'اللِيفِل يجب أن يكون من 1 إلى 10' });
    const isBoss = req.trainer.role === 'boss';
    const filter = { subscriptionId: req.params.subscriptionId };
    if (!isBoss) filter.trainer = req.trainer._id;
    const swimmer = await Swimmer.findOneAndUpdate(filter, { level, levelNote: levelNote || '', levelUpdatedBy: req.trainer.name, levelUpdatedAt: new Date() }, { new: true });
    if (!swimmer)
      return res.status(404).json({ success: false, message: 'السباح غير موجود أو لا تملك صلاحية تعديله' });
    res.json({ success: true, message: 'تم تحديث اللِيفِل', data: { level: swimmer.level, levelNote: swimmer.levelNote } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في تحديث اللِيفِل' });
  }
});

/* ── GET /all-users — Boss ── */
router.get('/all-users', protectTrainer, requireBoss, async (req, res) => {
  try {
    const users = await SwimmerUser.find().select('-__v').sort({ createdAt: -1 });
    res.json({ success: true, total: users.length, data: users });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في الخادم' });
  }
});

/* ── PUT /users/:id — Boss ── */
router.put('/users/:id', protectTrainer, requireBoss, async (req, res) => {
  try {
    const { displayName, username, phone, email, city, isActive, password } = req.body;
    const user = await SwimmerUser.findById(req.params.id).select('+password');
    if (!user) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    if (username && username.toLowerCase() !== user.username) {
      const exists = await SwimmerUser.findOne({ username: username.toLowerCase() });
      if (exists) return res.status(400).json({ success: false, message: 'اسم المستخدم مستخدم بالفعل' });
      user.username = username.toLowerCase();
    }
    if (displayName !== undefined) user.displayName = displayName;
    if (phone       !== undefined) user.phone       = phone;
    if (email       !== undefined) user.email       = email;
    if (city        !== undefined) user.city        = city || null;
    if (isActive    !== undefined) user.isActive    = isActive === true || isActive === 'true';
    if (password && password.length >= 6) user.password = password;
    await user.save();
    res.json({ success: true, message: 'تم التحديث', data: { id: user._id, username: user.username, displayName: user.displayName, city: user.city, isActive: user.isActive } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في التحديث' });
  }
});

/* ── DELETE /users/:id — Boss ── */
router.delete('/users/:id', protectTrainer, requireBoss, async (req, res) => {
  try {
    const user = await SwimmerUser.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    res.json({ success: true, message: `تم حذف الحساب "${user.username}"` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في الحذف' });
  }
});



router.put('/my-swimmers/:subscriptionId', protectSwimmer, async (req, res) => {
  try {
    const { fullName, phone, trainingTime, goal } = req.body;

    // تأكد إن السباح ده تابع لحساب المستخدم ده بس
    const user = await SwimmerUser.findById(req.swimmerUser._id).populate('swimmers');
    const swimmer = user.swimmers.find(s => s.subscriptionId === req.params.subscriptionId);
    if (!swimmer)
      return res.status(403).json({ success: false, message: 'غير مصرح' });

    const updated = await Swimmer.findByIdAndUpdate(
      swimmer._id,
      { fullName: fullName||swimmer.fullName,
        phone: phone||swimmer.phone,
        trainingTime: trainingTime||swimmer.trainingTime,
        goal: goal||swimmer.goal },
      { new: true }
    );
    res.json({ success: true, message: 'تم التحديث', data: updated });
  } catch(err) {
    res.status(500).json({ success: false, message: 'خطأ في التحديث' });
  }
});




module.exports = { router, protectSwimmer };
