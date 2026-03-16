const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const trainerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'اسم الكابتن مطلوب'],
      trim: true,
    },
    username: {
      type: String,
      required: [true, 'اسم المستخدم مطلوب'],
      unique: true,
      trim: true,
      lowercase: true,
    },
    password: {
      type: String,
      required: [true, 'كلمة المرور مطلوبة'],
      minlength: 6,
      select: false, // لا تُرجع الـ password في الـ queries
    },
    role: {
      type: String,
      enum: ['trainer', 'boss'],
      default: 'trainer',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// ── Hash password قبل الحفظ ─────────────────────────────────
trainerSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// ── مقارنة الـ password ─────────────────────────────────────
trainerSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('Trainer', trainerSchema);