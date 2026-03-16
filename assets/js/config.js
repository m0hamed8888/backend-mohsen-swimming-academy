// ═══════════════════════════════════════════════
//  AquaFlow — API Configuration
//  غيّر القيمة دي بعد ما ترفع على Vercel
// ═══════════════════════════════════════════════

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:5000/api'       // تطوير محلي
  : 'https://backend-mohsen-swimming-academy.vercel.app/api';  // ← هتغير ده بعد الرفع على Vercel
