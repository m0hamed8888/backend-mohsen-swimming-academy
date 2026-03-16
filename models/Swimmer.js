const mongoose = require('mongoose');

const swimmerSchema = new mongoose.Schema(
  {
    // ── بيانات التسجيل الأساسية ──────────────────────────────
    fullName: {
      type: String,
      required: [true, 'الاسم مطلوب'],
      trim: true,
      minlength: [2, 'الاسم يجب أن يكون حرفين على الأقل'],
    },
    dob: {
      type: Date,
      required: [true, 'تاريخ الميلاد مطلوب'],
    },
    phone: {
      type: String,
      required: [true, 'رقم التواصل مطلوب'],
      trim: true,
    },

    // ── خلفية السباحة ────────────────────────────────────────
    // FIX 1: default بدل required — صفحة الكابتن مش بتسأل عنه
    swamBefore: {
      type: String,
      enum: ['yes', 'no'],
      default: 'no',
    },
    egyptStars: {
      type: String,
      enum: ['yes', 'no', null],
      default: null,
    },
    starsCount: {
      type: Number,
      min: 1,
      max: 5,
      default: null,
    },
    waterFear: {
      type: String,
      enum: ['yes', 'no', null],
      default: null,
    },

    // ── الهدف ────────────────────────────────────────────────
    // ليست required — قد لا يكون محدداً عند تسجيل الكابتن
    goal: {
      type: String,
      enum: ['fitness', 'competition', 'safety', 'fun', null],
      default: null,
    },

    // ── الاشتراك ─────────────────────────────────────────────
    subscriptionId: {
      type: String,
      unique: true,
    },

    sessionsCount: {
      type: Number,
      enum: [8, 12, 24],
      required: [true, 'عدد الحصص مطلوب'],
    },

    // أيام التدريب: array من أرقام (0=أحد ... 6=سبت)
    trainingDays: {
      type: [Number],
      required: true,
      validate: {
        validator: function (arr) {
          if (!Array.isArray(arr) || arr.length === 0) return false;
          // التحقق من عدد الأيام حسب نوع الاشتراك
          const count = this.sessionsCount;
          if (count === 8)  return arr.length === 2;
          if (count === 12) return arr.length === 3;
          if (count === 24) return arr.length === 6;
          // لو مش معروف — اقبل أي عدد > 0
          return arr.length > 0;
        },
        message: function(props) {
          const sess = this.sessionsCount;
          if (sess === 8)  return 'اشتراك ٨ حصص يتطلب يومين اثنين بالضبط';
          if (sess === 12) return 'اشتراك ١٢ حصة يتطلب ٣ أيام بالضبط';
          if (sess === 24) return 'اشتراك ٢٤ حصة يتطلب ٦ أيام (مع يوم راحة واحد)';
          return 'عدد أيام التدريب غير صحيح';
        },
      },
    },

    // الجدول المختار من register.html أو 'custom' من trainer.html
    trainingSchedule: {
      type: String,
      enum: [
        'sun_tue', 'sun_thu', 'tue_thu', 'other8',
        'sat_tue_thu', 'sat_mon_wed', 'other12',
        'custom', null,
      ],
      default: null,
    },

    // يوم الراحة لـ 24 حصة (0-6)
    restDay: {
      type: Number,
      min: 0,
      max: 6,
      default: null,
    },

    trainingTime: {
      type: String,
      default: null,
    },

    trainerName: {
      type: String,
      default: null,
    },
    // ── ربط السباح بالكابتن المسؤول ──
trainer: {
  type:    mongoose.Schema.Types.ObjectId,
  ref:     'Trainer',
  default: null,
},

    // FIX 3: cache للأداء — بيتحدث تلقائياً عند كل تسجيل حضور
    // ولو احتجت التأكد استخدم swimmer.recalcAttendance()
    sessionsAttended: {
      type: Number,
      default: 0,
    },

    subscriptionStart: {
      type: Date,
      default: Date.now,
    },
    subscriptionExpiry: {
      type: Date,
      default: null,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON:   { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ── Virtual: العمر من تاريخ الميلاد ──────────────────────
swimmerSchema.virtual('age').get(function () {
  if (!this.dob) return null;
  const today = new Date();
  const birth = new Date(this.dob);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
});

// ── Pre-save: توليد رقم الاشتراك تلقائياً (AQ-XXXXX) ─────
swimmerSchema.pre('save', async function (next) {
  if (!this.subscriptionId) {
    let id, exists;
    do {
      id = 'AQ-' + String(Math.floor(10000 + Math.random() * 90000));
      exists = await mongoose.model('Swimmer').findOne({ subscriptionId: id });
    } while (exists);
    this.subscriptionId = id;
  }
  next();
});

// ── Method: إعادة حساب sessionsAttended من الـ DB (دقيق 100%) ─
// استخدمه لو شككت في الـ cache:
//   await swimmer.recalcAttendance();
swimmerSchema.methods.recalcAttendance = async function () {
  const Attendance = mongoose.model('Attendance');
  const count = await Attendance.countDocuments({
    swimmer: this._id,
    status:  'present',
  });
  this.sessionsAttended = count;
  await this.save();
  return count;
};

// ── Method: حل أيام التدريب من الجدول المختار ─────────────
swimmerSchema.methods.resolveTrainingDays = function () {
  if (this.sessionsCount === 24 && this.restDay !== null) {
    return [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== this.restDay);
  }
  const scheduleMap = {
    sun_tue:     [0, 2],
    sun_thu:     [0, 4],
    tue_thu:     [2, 4],
    sat_tue_thu: [6, 2, 4],
    sat_mon_wed: [6, 1, 3],
  };
  return scheduleMap[this.trainingSchedule] || this.trainingDays;
};

module.exports = mongoose.model('Swimmer', swimmerSchema);