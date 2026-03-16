const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const swimmerUserSchema = new mongoose.Schema(
  {
    // ── بيانات الحساب ─────────────────────────────────────
    username: {
      type:      String,
      required:  [true, 'اسم المستخدم مطلوب'],
      unique:    true,
      lowercase: true,
      trim:      true,
      minlength: [3, 'اسم المستخدم 3 أحرف على الأقل'],
    },
    password: {
      type:      String,
      required:  [true, 'كلمة المرور مطلوبة'],
      minlength: [6, 'كلمة المرور 6 أحرف على الأقل'],
      select:    false,
    },
    displayName: {
      type:    String,
      trim:    true,
      default: '',
    },
    phone: {
      type:    String,
      trim:    true,
      default: '',
    },
    // email اختياري — للبوس فقط
    email: {
      type:    String,
      trim:    true,
      default: '',
    },
    // ربط بـ Swimmer records (واحد أو أكثر)
    swimmers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref:  'Swimmer',
      },
    ],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// hash password قبل الحفظ
swimmerUserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

swimmerUserSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('SwimmerUser', swimmerUserSchema);