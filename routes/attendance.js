const express     = require('express');
const router      = express.Router();
const Attendance  = require('../models/Attendance');
const Swimmer     = require('../models/Swimmer');
const { protect } = require('../middleware/auth');

/* ─────────────────────────────────────────────────────────────
   مساعد: تحويل تاريخ إلى YYYY-MM-DD بالتوقيت المحلي
   ───────────────────────────────────────────────────────────── */
function toLocalDateStr(date) {
  const d   = new Date(date);
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* ─────────────────────────────────────────────────────────────
   POST /api/attendance
   تسجيل حضور أو غياب (+ دعم اليوم التعويضي)
   ───────────────────────────────────────────────────────────── */
router.post('/', protect, async (req, res) => {
  try {
    const { subscriptionId, date, status, notes, isMakeup, makeupForDate } = req.body;
    if (!subscriptionId || !date || !status)
      return res.status(400).json({ success: false, message: 'subscriptionId والتاريخ والحالة مطلوبين' });

    const swimmer = await Swimmer.findOne({ subscriptionId });
    if (!swimmer)
      return res.status(404).json({ success: false, message: 'السباح غير موجود' });

    const [year, month, day] = date.split('-').map(Number);
    const recordDate = new Date(Date.UTC(year, month - 1, day));
    const dayIndex   = recordDate.getUTCDay();

    const updateData = {
      swimmer:        swimmer._id,
      subscriptionId: swimmer.subscriptionId,
      date:           recordDate,
      dayIndex,
      status,
      recordedBy:     req.trainer?.name || 'system',
      notes:          notes || '',
      isMakeup:       isMakeup || false,
      makeupForDate:  makeupForDate || null,
    };

    const record = await Attendance.findOneAndUpdate(
      { swimmer: swimmer._id, date: recordDate },
      updateData,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // ══ FIX: لو التعويضي — حدّث سجل الغياب الأصلي عشان يعرف إن فيه تعويضي ليه ══
    if (isMakeup && makeupForDate) {
      const [ay, am, ad] = makeupForDate.split('-').map(Number);
      const absenceDate  = new Date(Date.UTC(ay, am - 1, ad));
      await Attendance.findOneAndUpdate(
        { swimmer: swimmer._id, date: absenceDate, status: 'absent' },
        { $set: { hasMakeup: true, makeupDate: recordDate } }
      );
    }

    // إعادة حساب عداد الحضور (الحضور الأصلي + التعويضي)
    const totalPresent = await Attendance.countDocuments({ swimmer: swimmer._id, status: 'present' });
    await Swimmer.findByIdAndUpdate(swimmer._id, { sessionsAttended: totalPresent });

    res.status(201).json({
      success: true,
      message: `تم تسجيل ${status === 'present' ? 'الحضور' : 'الغياب'}`,
      data:    record,
      sessionsAttended: totalPresent,
    });
  } catch (err) {
    console.error('Attendance POST:', err);
    res.status(500).json({ success: false, message: 'خطأ في تسجيل الحضور' });
  }
});

/* ─────────────────────────────────────────────────────────────
   GET /api/attendance/:subscriptionId/week
   ───────────────────────────────────────────────────────────── */
router.get('/:subscriptionId/week', async (req, res) => {
  try {
    const swimmer = await Swimmer.findOne({ subscriptionId: req.params.subscriptionId });
    if (!swimmer)
      return res.status(404).json({ success: false, message: 'السباح غير موجود' });

    const now         = new Date();
    const todayUTC    = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const dayOfWeek   = todayUTC.getUTCDay();
    const sundayUTC   = new Date(todayUTC); sundayUTC.setUTCDate(todayUTC.getUTCDate() - dayOfWeek);
    const saturdayUTC = new Date(sundayUTC); saturdayUTC.setUTCDate(sundayUTC.getUTCDate() + 6);
    saturdayUTC.setUTCHours(23, 59, 59, 999);

    const weekRecords = await Attendance.find({
      swimmer: swimmer._id,
      date:    { $gte: sundayUTC, $lte: saturdayUTC },
    });

    const statusMap = {};
    weekRecords.forEach(r => {
      const key = toLocalDateStr(r.date);
      statusMap[key] = {
        status:    r.status,
        id:        r._id.toString(),
        isMakeup:  r.isMakeup  || false,
        hasMakeup: r.hasMakeup || false,   // ✅ غياب عنده تعويضي
        makeupDate: r.makeupDate ? toLocalDateStr(r.makeupDate) : null,
      };
    });

    const year  = now.getFullYear();
    const month = now.getMonth() + 1;
    const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
    const endOfMonth   = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    const allMonthRecords = await Attendance.find({
      swimmer: swimmer._id,
      date: { $gte: startOfMonth, $lte: endOfMonth },
    });

    const monthStatusMap = {};
    allMonthRecords.forEach(r => {
      monthStatusMap[toLocalDateStr(r.date)] = {
        status:    r.status,
        id:        r._id.toString(),
        isMakeup:  r.isMakeup  || false,
        hasMakeup: r.hasMakeup || false,
        makeupDate: r.makeupDate ? toLocalDateStr(r.makeupDate) : null,
      };
    });

    const presentCount = allMonthRecords.filter(r => r.status === 'present').length;
    const absentCount  = allMonthRecords.filter(r => r.status === 'absent').length;

    const lastDay = new Date(year, month, 0).getDate();
    let trainingDaysCount = 0;
    for (let d = 1; d <= lastDay; d++) {
      const di = new Date(year, month - 1, d).getDay();
      if (swimmer.trainingDays.includes(di)) trainingDaysCount++;
    }

    const days = Array.from({ length: 7 }, (_, i) => {
      const d       = new Date(sundayUTC); d.setUTCDate(sundayUTC.getUTCDate() + i);
      const dateStr = toLocalDateStr(d);
      const dayIdx  = d.getUTCDay();
      const rec     = statusMap[dateStr];
      return {
        date: dateStr, dayIndex: dayIdx,
        isTrainingDay: swimmer.trainingDays.includes(dayIdx),
        status:    rec?.status    || null,
        recordId:  rec?.id        || null,
        isMakeup:  rec?.isMakeup  || false,
        hasMakeup: rec?.hasMakeup || false,
        makeupDate: rec?.makeupDate || null,
      };
    });

    res.json({
      success: true, days, statusMap,
      weekStart: toLocalDateStr(sundayUTC),
      monthStats: {
        year, month, monthStatusMap,
        presentCount, absentCount,
        trainingDaysCount,
        remaining: Math.max(0, trainingDaysCount - presentCount - absentCount),
      },
    });
  } catch (err) {
    console.error('Attendance week:', err);
    res.status(500).json({ success: false, message: 'خطأ في جلب الحضور' });
  }
});

/* ─────────────────────────────────────────────────────────────
   GET /api/attendance/:subscriptionId/month
   ───────────────────────────────────────────────────────────── */
router.get('/:subscriptionId/month', async (req, res) => {
  try {
    const swimmer = await Swimmer.findOne({ subscriptionId: req.params.subscriptionId });
    if (!swimmer)
      return res.status(404).json({ success: false, message: 'السباح غير موجود' });

    const now   = new Date();
    const year  = parseInt(req.query.year)  || now.getFullYear();
    const month = parseInt(req.query.month) || (now.getMonth() + 1);

    const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
    const endOfMonth   = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    const records = await Attendance.find({
      swimmer: swimmer._id,
      date: { $gte: startOfMonth, $lte: endOfMonth },
    });

    const statusMap = {};
    records.forEach(r => {
      statusMap[toLocalDateStr(r.date)] = {
        status:    r.status,
        id:        r._id.toString(),
        isMakeup:  r.isMakeup  || false,
        hasMakeup: r.hasMakeup || false,   // ✅ غياب عنده تعويضي
        makeupDate: r.makeupDate ? toLocalDateStr(r.makeupDate) : null,
      };
    });

    const presentCount = records.filter(r => r.status === 'present').length;
    const absentCount  = records.filter(r => r.status === 'absent').length;

    const lastDay = new Date(year, month, 0).getDate();
    let trainingDaysCount = 0;
    for (let d = 1; d <= lastDay; d++) {
      const di = new Date(year, month - 1, d).getDay();
      if (swimmer.trainingDays.includes(di)) trainingDaysCount++;
    }

    res.json({
      success: true, year, month,
      trainingDays:  swimmer.trainingDays,
      sessionsCount: swimmer.sessionsCount,
      statusMap,
      stats: {
        presentCount, absentCount,
        trainingDaysCount,
        remaining: Math.max(0, trainingDaysCount - presentCount - absentCount),
      },
    });
  } catch (err) {
    console.error('Attendance month:', err);
    res.status(500).json({ success: false, message: 'خطأ في جلب بيانات الشهر' });
  }
});

/* GET /api/attendance/:subscriptionId/all */
router.get('/:subscriptionId/all', protect, async (req, res) => {
  try {
    const swimmer = await Swimmer.findOne({ subscriptionId: req.params.subscriptionId });
    if (!swimmer)
      return res.status(404).json({ success: false, message: 'السباح غير موجود' });
    const records = await Attendance.find({ swimmer: swimmer._id }).sort({ date: -1 });
    res.json({ success: true, total: records.length, data: records });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في الخادم' });
  }
});

/* DELETE /api/attendance/:recordId */
router.delete('/:recordId', protect, async (req, res) => {
  try {
    const record = await Attendance.findByIdAndDelete(req.params.recordId);
    if (!record)
      return res.status(404).json({ success: false, message: 'السجل غير موجود' });

    // لو كان تعويضي — امسح علامة hasMakeup من سجل الغياب الأصلي
    if (record.isMakeup && record.makeupForDate) {
      await Attendance.findOneAndUpdate(
        { swimmer: record.swimmer, date: record.makeupForDate },
        { $set: { hasMakeup: false, makeupDate: null } }
      );
    }

    const total = await Attendance.countDocuments({ swimmer: record.swimmer, status: 'present' });
    await Swimmer.findByIdAndUpdate(record.swimmer, { sessionsAttended: total });

    res.json({ success: true, message: 'تم حذف السجل' });
  } catch (err) {
    console.error('Attendance DELETE:', err);
    res.status(500).json({ success: false, message: 'خطأ في الحذف' });
  }
});

module.exports = router;
