const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema(
  {
    swimmer:        { type: mongoose.Schema.Types.ObjectId, ref: 'Swimmer', required: true },
    subscriptionId: { type: String,  required: true, index: true },
    date:           { type: Date,    required: true },
    dayIndex:       { type: Number,  required: true, min: 0, max: 6 },
    status:         { type: String,  enum: ['present','absent'], required: true },
    recordedBy:     { type: String,  default: 'system' },
    notes:          { type: String,  default: '' },

    // ── اليوم التعويضي (على سجل الحضور التعويضي نفسه) ──
    isMakeup:      { type: Boolean, default: false },
    makeupForDate: { type: Date,    default: null  },

    // ✅ على سجل الغياب — عشان نعرف إن فيه تعويضي ليه
    hasMakeup:  { type: Boolean, default: false },
    makeupDate: { type: Date,    default: null  },
  },
  { timestamps: true }
);

attendanceSchema.index({ swimmer: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', attendanceSchema);
