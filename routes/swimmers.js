const express    = require('express');
const router     = express.Router();
const Swimmer    = require('../models/Swimmer');
const Attendance = require('../models/Attendance');
const { protect, requireBoss } = require('../middleware/auth');

/* ────────────────────────────────────────────────────────────
   POST /api/swimmers/register
   تسجيل سباح جديد — يُربط بالكابتن الحالي تلقائياً
   ──────────────────────────────────────────────────────────── */
router.post('/register', protect, async (req, res) => {
  try {
    const {
      fullName, dob, phone,
      swamBefore, egyptStars, starsCount, waterFear,
      goal,
      sessionsCount, trainingSchedule, restDay,
      trainingDays: trainingDaysFromBody,
      trainingTime, trainerName, subscriptionExpiry,
    } = req.body;

    const sessCount = Number(sessionsCount);

    const scheduleMap = {
      sun_tue:     [0, 2],
      sun_thu:     [0, 4],
      tue_thu:     [2, 4],
      sat_tue_thu: [6, 2, 4],
      sat_mon_wed: [6, 1, 3],
    };

    let trainingDays  = [];
    let finalSchedule = trainingSchedule || null;

    if (Array.isArray(trainingDaysFromBody) && trainingDaysFromBody.length > 0) {
      trainingDays  = trainingDaysFromBody.map(Number);
      finalSchedule = finalSchedule || 'custom';
    } else if (sessCount === 24 && restDay !== null && restDay !== undefined) {
      trainingDays  = [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== Number(restDay));
      finalSchedule = null;
    } else if (trainingSchedule && scheduleMap[trainingSchedule]) {
      trainingDays = scheduleMap[trainingSchedule];
    }

    const expectedDays = { 8: 2, 12: 3, 24: 6 };
    const expected     = expectedDays[sessCount];
    if (expected && trainingDays.length !== expected) {
      return res.status(400).json({
        success: false,
        message: `اشتراك ${sessCount} حصة يتطلب ${expected} أيام — أُرسل ${trainingDays.length}`,
      });
    }

    const swimmer = await Swimmer.create({
      fullName:    fullName?.trim(),
      dob,
      phone:       phone?.trim(),
      swamBefore:  swamBefore  || 'no',
      egyptStars:  egyptStars  || null,
      starsCount:  starsCount  || null,
      waterFear:   waterFear   || null,
      goal,
      sessionsCount:    sessCount,
      trainingSchedule: finalSchedule,
      restDay:     (restDay !== undefined && restDay !== '') ? Number(restDay) : null,
      trainingDays,
      trainingTime:       trainingTime       || null,
      trainerName:        trainerName        || null,
      subscriptionExpiry: subscriptionExpiry || null,
      // ── ربط السباح بالكابتن الحالي ──
      trainer: req.trainer._id,
    });

    res.status(201).json({
      success: true,
      message: 'تم تسجيل السباح بنجاح',
      data: {
        swimmerId:      swimmer._id,
        subscriptionId: swimmer.subscriptionId,
        fullName:       swimmer.fullName,
        trainingDays:   swimmer.trainingDays,
      },
    });
  } catch (err) {
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: messages.join(' — ') });
    }
    console.error('Register error:', err);
    res.status(500).json({ success: false, message: 'خطأ في الخادم' });
  }
});

/* ────────────────────────────────────────────────────────────
   GET /api/swimmers
   الكابتن العادي → يشوف مشتركينه فقط
   Boss            → يشوف الكل (مع فلتر اختياري ?trainerId=xxx)
   ──────────────────────────────────────────────────────────── */
router.get('/', protect, async (req, res) => {
  try {
    const { search, page = 1, limit = 20, trainerId, sessionsCount, isActive } = req.query;
    const isBoss = req.trainer.role === 'boss';

    const filter = {};

    // ── فلترة بالكابتن ──
    if (isBoss) {
      if (trainerId) filter.trainer = trainerId;
    } else {
      filter.trainer = req.trainer._id;
    }

    // ── فلترة بعدد الحصص ──
    if (sessionsCount) filter.sessionsCount = Number(sessionsCount);

    // ── فلترة بالحالة ──
    if (isActive === 'true')  filter.isActive = true;
    if (isActive === 'false') filter.isActive = false;

    // ── فلترة بالبحث ──
    if (search) {
      filter.$or = [
        { fullName:       { $regex: search, $options: 'i' } },
        { subscriptionId: { $regex: search, $options: 'i' } },
        { phone:          { $regex: search, $options: 'i' } },
      ];
    }

    const total    = await Swimmer.countDocuments(filter);
    const swimmers = await Swimmer.find(filter)
      .populate('trainer', 'name username')   // نجيب اسم الكابتن مع كل سباح
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.json({
      success: true,
      total,
      page:  Number(page),
      pages: Math.ceil(total / limit),
      data:  swimmers,
    });
  } catch (err) {
    console.error('GET swimmers:', err);
    res.status(500).json({ success: false, message: 'خطأ في الخادم' });
  }
});

/* ────────────────────────────────────────────────────────────
   GET /api/swimmers/:subscriptionId
   الكابتن العادي → مشتركينه فقط
   Boss            → أي سباح
   ──────────────────────────────────────────────────────────── */
router.get('/:subscriptionId', protect, async (req, res) => {
  try {
    const isBoss  = req.trainer.role === 'boss';
    const filter  = { subscriptionId: req.params.subscriptionId.trim() };
    if (!isBoss) filter.trainer = req.trainer._id;   // كابتن عادي: تأكد إنه مشتركه

    const swimmer = await Swimmer.findOne(filter);

    if (!swimmer) {
      return res.status(404).json({
        success: false,
        message: isBoss ? 'المشترك غير موجود' : 'المشترك غير موجود أو لا ينتمي لحسابك',
      });
    }

    const today    = new Date(); today.setHours(0, 0, 0, 0);
    const sunday   = new Date(today); sunday.setDate(today.getDate() - today.getDay());
    const saturday = new Date(sunday); saturday.setDate(sunday.getDate() + 6); saturday.setHours(23, 59, 59, 999);

    const weekAttendance = await Attendance.find({
      swimmer: swimmer._id,
      date:    { $gte: sunday, $lte: saturday },
    });

    const attendanceMap = {};
    weekAttendance.forEach((rec) => {
      if (rec.status === 'absent') attendanceMap[rec.dayIndex] = 'absent';
    });

    res.json({
      success: true,
      data: {
        id:               swimmer.subscriptionId,
        subscriptionId:   swimmer.subscriptionId,
        name:             swimmer.fullName,
        fullName:         swimmer.fullName,
        dob:              swimmer.dob,
        age:              swimmer.age,
        phone:            swimmer.phone,
        goal:             swimmer.goal,
        trainingDays:     swimmer.trainingDays,
        trainingTime:     swimmer.trainingTime  || null,
        sessionsCount:    swimmer.sessionsCount,
        sessionsAttended: swimmer.sessionsAttended,
        isActive:         swimmer.isActive,
        trainerName:      swimmer.trainerName   || null,
        trainer:          swimmer.trainer,
        subscriptionStart:  swimmer.subscriptionStart,
        subscriptionExpiry: swimmer.subscriptionExpiry,
        sessions: {
          total:    swimmer.sessionsCount,
          attended: swimmer.sessionsAttended,
        },
        weekAttendance: attendanceMap,
      },
    });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ success: false, message: 'خطأ في الخادم' });
  }
});

/* ────────────────────────────────────────────────────────────
   PUT /api/swimmers/:subscriptionId — تعديل بيانات سباح
   الكابتن → مشتركينه فقط | Boss → أي سباح
   ──────────────────────────────────────────────────────────── */
router.put('/:subscriptionId', protect, async (req, res) => {
  try {
    const isBoss = req.trainer.role === 'boss';
    const filter = { subscriptionId: req.params.subscriptionId };
    if (!isBoss) filter.trainer = req.trainer._id;

    const allowed = ['fullName', 'phone', 'trainingTime', 'goal',
                     'isActive', 'subscriptionExpiry', 'trainerName'];
    const update = {};
    allowed.forEach((key) => {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    });

    if (typeof update.fullName    === 'string') update.fullName    = update.fullName.trim();
    if (typeof update.phone       === 'string') update.phone       = update.phone.trim();
    if (typeof update.trainerName === 'string') update.trainerName = update.trainerName.trim() || null;
    if (update.goal         === '') update.goal         = null;
    if (update.trainingTime === '') update.trainingTime = null;
    if (update.subscriptionExpiry === '') update.subscriptionExpiry = null;
    if ('isActive' in update) update.isActive = (update.isActive === true || update.isActive === 'true');

    const swimmer = await Swimmer.findOneAndUpdate(filter, update, { new: true, runValidators: false });

    if (!swimmer)
      return res.status(404).json({ success: false, message: 'السباح غير موجود أو لا ينتمي لحسابك' });

    res.json({ success: true, message: 'تم تحديث البيانات', data: swimmer });
  } catch (err) {
    console.error('Swimmer PUT:', err);
    res.status(500).json({ success: false, message: 'خطأ في التحديث: ' + err.message });
  }
});

/* ────────────────────────────────────────────────────────────
   DELETE /api/swimmers/:subscriptionId
   الكابتن → مشتركينه فقط | Boss → أي سباح
   ──────────────────────────────────────────────────────────── */
router.delete('/:subscriptionId', protect, async (req, res) => {
  try {
    const isBoss = req.trainer.role === 'boss';
    const filter = { subscriptionId: req.params.subscriptionId };
    if (!isBoss) filter.trainer = req.trainer._id;

    const swimmer = await Swimmer.findOne(filter);
    if (!swimmer)
      return res.status(404).json({ success: false, message: 'السباح غير موجود أو لا ينتمي لحسابك' });

    const deleted = await Attendance.deleteMany({ swimmer: swimmer._id });
    await Swimmer.findByIdAndDelete(swimmer._id);

    res.json({
      success: true,
      message: `تم حذف "${swimmer.fullName}" و ${deleted.deletedCount} سجل حضور`,
    });
  } catch (err) {
    console.error('Swimmer DELETE:', err);
    res.status(500).json({ success: false, message: 'خطأ في الحذف: ' + err.message });
  }
});

/* ────────────────────────────────────────────────────────────
   GET /api/swimmers/boss/all-trainers
   Boss فقط — إحصائيات كل الكابتنات
   ──────────────────────────────────────────────────────────── */
router.get('/boss/all-trainers', protect, requireBoss, async (req, res) => {
  try {
    const Trainer = require('../models/Trainer');
    const trainers = await Trainer.find({ role: 'trainer' }).select('name username isActive createdAt');

    const result = await Promise.all(
      trainers.map(async (t) => {
        const total  = await Swimmer.countDocuments({ trainer: t._id });
        const active = await Swimmer.countDocuments({ trainer: t._id, isActive: true });
        return {
          id:        t._id,
          name:      t.name,
          username:  t.username,
          isActive:  t.isActive,
          total,
          active,
          inactive:  total - active,
        };
      })
    );

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في الخادم' });
  }
});

module.exports = router;