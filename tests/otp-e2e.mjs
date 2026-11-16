// اختبار دورة الرمز الكاملة على نسخة قيد التشغيل: FCMS_BASE=http://127.0.0.1:3000 node tests/otp-e2e.mjs
const BASE = process.env.FCMS_BASE || 'http://127.0.0.1:3000';

async function call(path, body, token, method = 'POST') {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + path, { method, headers, body: JSON.stringify(body || {}) });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

let failed = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${extra ? ' — ' + extra : ''}`);
  if (!ok) { failed += 1; process.exitCode = 1; }
};

const stamp = String(Date.now()) + String(Math.floor(Math.random() * 1000));
const national = '11' + stamp.slice(-10);
const phone = '09' + stamp.slice(-8);

const attempt = await call('/api/login', { national, phone });
check('المحاولة تُسجَّل وتنتظر الموافقة', attempt.status === 200 && attempt.body.status === 'awaiting-approval');
const pendingToken = attempt.body.pendingToken;

const before = await call('/api/access-status', { pendingToken });
check('لا رمز قبل موافقة المدير', before.body.status === 'pending' && !before.body.code);

const adminLogin = await call('/api/admin/login', { username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });
check('دخول لوحة الإدارة', adminLogin.status === 200 && Boolean(adminLogin.body.sessionToken));
const adminToken = adminLogin.body.sessionToken;
const summary = await fetch(`${BASE}/api/admin/summary`, { headers: { Authorization: 'Bearer ' + adminToken } }).then(r => r.json());
const row = summary.pendingAccessUsers.find(user => user.nationalNumber === national);
check('المحاولة تظهر في صندوق التسجيلات', Boolean(row), row ? `محاولات=${row.attempts}` : '');

const decision = await call(`/api/admin/users/${row.id}/access-status`, { status: 'مقبول' }, adminToken, 'PATCH');
check('الموافقة تُصدر رمزًا من 6 أرقام', decision.status === 200 && /^\d{6}$/.test(decision.body.deliveredCode || ''), decision.body.message);
const issuedCode = decision.body.deliveredCode;

const after = await call('/api/access-status', { pendingToken });
check('الزائر يستلم الرمز مع هاتفه وصلاحية ١٠ دقائق', after.body.status === 'approved' && after.body.code === issuedCode && after.body.phone === phone && after.body.expiresIn > 500);

const wrong = await call('/api/verify', { code: '000000', pendingToken });
check('الرمز الخاطئ مرفوض', wrong.status === 400 && wrong.body.error?.field === 'otp', wrong.body.error?.message);

const cooldown = await call('/api/resend', { pendingToken });
check('إعادة الإرسال تحترم فترة الانتظار', cooldown.status === 429);

const verified = await call('/api/verify', { code: issuedCode, pendingToken });
check('الرمز الصحيح يفتح الحساب', verified.status === 200 && Boolean(verified.body.sessionToken));

const details = await fetch(`${BASE}/api/admin/users/${row.id}`, { headers: { Authorization: 'Bearer ' + adminToken } }).then(r => r.json());
check('اللوحة تعرض كل بيانات التسجيل', Boolean(details.user?.passportNumber && details.user?.ip && details.user?.attempts >= 1 && details.user?.firstSeenAt),
  `ip=${details.user?.ip} محاولات=${details.user?.attempts}`);
check('آخر دخول ناجح يُسجَّل ويُمسح الرمز', Boolean(details.user?.lastLoginAt) && !details.user?.otpCode);

if (failed) console.log(`${failed} فحصًا فشل`);
else console.log('نجحت دورة الرمز كاملة.');
