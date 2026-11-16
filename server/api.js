import { randomBytes } from 'node:crypto';
import { hashToken } from './db.js';
import { resolveLocation } from './geo.js';
import {
  BRANCHES, REQUEST_TYPES, PURPOSES, AVAILABLE_LIMIT, OTP_TTL_MINUTES, RESEND_COOLDOWN_SECONDS,
  generateOtp, otpExpiry,
  SESSION_COOKIE, PENDING_COOKIE, SESSION_DAYS,
  validateLogin, validateRegistration, validateIban, validateRequest,
  referenceFor, maskPhone, maskNational, maskPassport, cookieOptions
} from './rules.js';

const STATUS_PENDING = 'في انتظار المطابقة';
const STATUS_APPROVED = 'مقبول';
const STATUS_REJECTED = 'مرفوض';
const ACCESS_PENDING = 'في انتظار الموافقة';
const ACCESS_APPROVED = 'مقبول';
const ACCESS_REJECTED = 'مرفوض';
const ALLOW_ANY_OTP = true;

function error(res, status, message, field) {
  res.status(status).json({ error: field ? { message, field } : { message } });
}

function dateLabel(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleDateString('ar-LY', { day: 'numeric', month: 'long', year: 'numeric' }, { timeZone: 'Africa/Tripoli' });
}

function timestampLabel(value) {
  const date = value instanceof Date ? value : new Date(value);
  const time = date.toLocaleTimeString('en-GB', { hour12: false, timeZone: 'Africa/Tripoli' });
  return `${time} ${date.toISOString().slice(0, 10)}`;
}

function parseCookies(header = '') {
  const jar = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    jar[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return jar;
}

function bearer(req) {
  const header = req.headers.authorization || '';
  return /^Bearer [a-f0-9]{48}$/.test(header) ? header.slice(7) : null;
}

export function createApi({ pool, isReady }) {
  async function readSession(req) {
    const token = bearer(req) || parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) return null;
    const [rows] = await pool.query(
      `SELECT u.id, u.national_number, u.passport_number, u.phone, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?`,
      [hashToken(token)]
    );
    const row = rows[0];
    if (!row) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) {
      await pool.query('DELETE FROM sessions WHERE token_hash = ?', [hashToken(token)]);
      return null;
    }
    await pool.query('UPDATE users SET last_seen_at = NOW() WHERE id = ?', [row.id]);
    return row;
  }

  async function loadPayload(userId) {
    const [accounts] = await pool.query(
      `SELECT a.id, a.iban, a.created_at, a.bank_code, b.name_ar, b.name_en, b.logo_path,
              (SELECT COUNT(*) FROM requests r WHERE r.account_id = a.id) AS request_count
         FROM accounts a JOIN banks b ON b.code = a.bank_code
        WHERE a.user_id = ? ORDER BY a.id`,
      [userId]
    );
    const [requests] = await pool.query(
      `SELECT id, account_id, reference, branch, request_type, amount_usd, purposes, status, created_at
         FROM requests WHERE user_id = ? ORDER BY id DESC`,
      [userId]
    );
    const list = requests.map(row => ({
      id: String(row.id),
      accountId: String(row.account_id),
      reference: row.reference,
      branch: row.branch,
      type: row.request_type,
      amount: Number(row.amount_usd),
      purposes: JSON.parse(row.purposes || '[]'),
      status: row.status,
      date: dateLabel(row.created_at)
    }));
    const pending = list.filter(item => item.status === STATUS_PENDING).reduce((total, item) => total + item.amount, 0);
    const reserved = list.filter(item => item.status === STATUS_APPROVED).reduce((total, item) => total + item.amount, 0);
    return {
      accounts: accounts.map(row => ({
        id: String(row.id),
        bankId: row.bank_code,
        bankAr: row.name_ar,
        bankEn: row.name_en,
        logo: row.logo_path,
        iban: row.iban,
        requestCount: Number(row.request_count),
        createdAt: timestampLabel(row.created_at)
      })),
      requests: list,
      stats: {
        count: list.length,
        reserved,
        pending,
        available: Math.max(0, AVAILABLE_LIMIT - pending - reserved)
      }
    };
  }

  async function requireSession(req, res, next) {
    if (!isReady()) return error(res, 503, 'قاعدة البيانات ليست جاهزة بعد.');
    const user = await readSession(req);
    if (!user) return error(res, 401, 'انتهت الجلسة، سجّل الدخول من جديد.', 'session');
    req.user = user;
    return next();
  }

  async function recordLocation(userId, req) {
    if (!req) return;
    try {
      const location = await resolveLocation(req);
      if (!location.ip) return;
      await pool.query(
        'UPDATE users SET last_ip = ?, country_code = COALESCE(?, country_code), country_name = COALESCE(?, country_name), city = ? WHERE id = ?',
        [location.ip, location.code || null, location.name || null, location.city || null, userId]
      );
    } catch {
      // تحديد الدولة خدمة مساندة؛ فشلها لا يوقف تسجيل الزائر.
    }
  }

  async function createPending(userId, res, req) {
    const token = randomBytes(24).toString('hex');
    await pool.query('UPDATE users SET last_seen_at = NOW() WHERE id = ?', [userId]);
    await recordLocation(userId, req);
    await pool.query('DELETE FROM pending_verifications WHERE user_id = ?', [userId]);
    await pool.query('INSERT INTO pending_verifications (user_id, token_hash) VALUES (?, ?)', [userId, hashToken(token)]);
    res.setHeader('Set-Cookie', `${PENDING_COOKIE}=${token}; ${cookieOptions(900)}`);
    // يُعاد الرمز أيضًا في المتن ليعمل التدفق حين يحجب المتصفح كوكيز الطرف الثالث داخل الإطار.
    return token;
  }

  const router = { handlers: [] };

  router.health = async (req, res) => {
    if (!isReady()) return res.status(503).json({ status: 'starting' });
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ready', database: process.env.DATABASE_URL ? 'mysql' : 'firebase' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  };

  router.register = async (req, res) => {
    if (!isReady()) return error(res, 503, 'قاعدة البيانات ليست جاهزة بعد.');
    const values = validateRegistration(req.body || {});
    if (values.field) return error(res, 400, values.message, values.field);
    const [existing] = await pool.query('SELECT id, passport_number FROM users WHERE national_number = ?', [values.national]);
    if (existing.length) {
      if (existing[0].passport_number === 'PENDING') {
        await pool.query('UPDATE users SET passport_number = ?, phone = ?, access_status = ? WHERE id = ?', [values.passport, values.phone, ACCESS_PENDING, existing[0].id]);
        const pendingToken = await createPending(existing[0].id, res, req);
        return res.status(200).json({ status: 'awaiting-approval', pendingToken, message: 'تم تحديث البيانات، بانتظار موافقة الإدارة.' });
      }
      return error(res, 409, 'هذا الرقم الوطني مسجل مسبقًا، استخدم تسجيل الدخول.', 'national');
    }
    const [result] = await pool.query(
      'INSERT INTO users (national_number, passport_number, phone, access_status) VALUES (?, ?, ?, ?)',
      [values.national, values.passport, values.phone, ACCESS_PENDING]
    );
    const pendingToken = await createPending(result.insertId, res, req);
    res.status(201).json({ status: 'awaiting-approval', pendingToken, message: 'تم إرسال البيانات، بانتظار موافقة الإدارة.' });
  };

  router.login = async (req, res) => {
    if (!isReady()) return error(res, 503, 'قاعدة البيانات ليست جاهزة بعد.');
    const values = validateLogin(req.body || {});
    if (values.field) return error(res, 400, values.message, values.field);
    const [rows] = await pool.query(
      'SELECT id, phone, access_status FROM users WHERE national_number = ?',
      [values.national]
    );
    let user = rows[0];
    if (!user) {
      const [created] = await pool.query(
        'INSERT INTO users (national_number, passport_number, phone, access_status) VALUES (?, ?, ?, ?)',
        [values.national, 'PENDING', values.phone, ACCESS_PENDING]
      );
      user = { id: created.insertId, phone: values.phone, access_status: ACCESS_PENDING };
    }
    // الدخول التجريبي يقبل أي رقمين بالصيغة المدخلة؛ لا يشترط وجود سجل سابق
    // ولا يرفض اختلاف الهاتف، بل يرسل المحاولة إلى موافقة المدير.
    await pool.query(
      `UPDATE users SET phone = ?, access_status = ?, attempts = attempts + 1,
              first_seen_at = COALESCE(first_seen_at, NOW()),
              otp_code = NULL, otp_sent_at = NULL, otp_expires_at = NULL
        WHERE id = ?`,
      [values.phone, ACCESS_PENDING, user.id]
    );
    const pendingToken = await createPending(user.id, res, req);
    res.json({ status: 'awaiting-approval', pendingToken, message: 'تم إرسال البيانات، بانتظار موافقة الإدارة.' });
  };


  async function issueOtp(userId) {
    const code = generateOtp();
    const expiresAt = otpExpiry(OTP_TTL_MINUTES);
    await pool.query('UPDATE users SET otp_code = ?, otp_sent_at = NOW(), otp_expires_at = ? WHERE id = ?', [code, expiresAt, userId]);
    return { code, expiresAt };
  }

  router.accessStatus = async (req, res) => {
    if (!isReady()) return error(res, 503, 'قاعدة البيانات ليست جاهزة بعد.');
    const token = String(req.body?.pendingToken ?? '').slice(0, 64) || parseCookies(req.headers.cookie)[PENDING_COOKIE];
    if (!token) return error(res, 401, 'انتهت محاولة الدخول، سجّل من جديد.', 'session');
    const [rows] = await pool.query(
      'SELECT u.id, u.access_status FROM pending_verifications p JOIN users u ON u.id = p.user_id WHERE p.token_hash = ? LIMIT 1',
      [hashToken(token)]
    );
    const status = rows[0]?.access_status;
    if (!status) return error(res, 401, 'انتهت محاولة الدخول، سجّل من جديد.', 'session');
    await pool.query('UPDATE users SET last_seen_at = NOW() WHERE id = ?', [rows[0].id]);
    if (status === ACCESS_APPROVED) {
      const [otpRows] = await pool.query('SELECT otp_code, otp_expires_at, phone FROM users WHERE id = ? LIMIT 1', [rows[0].id]);
      const record = otpRows[0] || {};
      let delivered = record.otp_code;
      if ((!delivered && !ALLOW_ANY_OTP) || !record.otp_expires_at || new Date(record.otp_expires_at).getTime() < Date.now()) {
        delivered = (await issueOtp(rows[0].id)).code;
      }
      return res.json({
        status: 'approved',
        code: delivered,
        phone: record.phone || '',
        expiresIn: Math.max(0, Math.round(((new Date(record.otp_expires_at).getTime() || otpExpiry(OTP_TTL_MINUTES).getTime()) - Date.now()) / 1000))
      });
    }
    if (status === ACCESS_REJECTED) return res.json({ status: 'rejected', message: 'تم رفض محاولة الدخول من الإدارة.' });
    return res.json({ status: 'pending', message: 'بياناتك قيد المراجعة من الإدارة.' });
  };


  router.resend = async (req, res) => {
    if (!isReady()) return error(res, 503, 'قاعدة البيانات ليست جاهزة بعد.');
    const token = String(req.body?.pendingToken ?? '').slice(0, 64) || parseCookies(req.headers.cookie)[PENDING_COOKIE];
    if (!token) return error(res, 401, 'انتهت محاولة الدخول، سجّل من جديد.', 'session');
    const [rows] = await pool.query(
      `SELECT u.id, u.phone, u.access_status, u.otp_sent_at FROM pending_verifications p
         JOIN users u ON u.id = p.user_id WHERE p.token_hash = ? LIMIT 1`,
      [hashToken(token)]
    );
    if (!rows.length) return error(res, 401, 'انتهت محاولة الدخول، سجّل من جديد.', 'session');
    const record = rows[0];
    if (record.access_status === ACCESS_PENDING) return error(res, 403, 'ما زالت محاولة الدخول بانتظار موافقة الإدارة.', 'access');
    if (record.access_status === ACCESS_REJECTED) return error(res, 403, 'تم رفض محاولة الدخول من الإدارة.', 'access');
    if (record.otp_sent_at && Date.now() - new Date(record.otp_sent_at).getTime() < RESEND_COOLDOWN_SECONDS * 1000) {
      return error(res, 429, 'انتظر قليلًا قبل طلب رمز جديد.');
    }
    const issued = await issueOtp(record.id);
    res.json({ status: 'delivered', code: issued.code, phone: record.phone || '', expiresIn: OTP_TTL_MINUTES * 60 });
  };

  router.presence = async (req, res) => {
    if (!isReady()) return error(res, 503, 'قاعدة البيانات ليست جاهزة بعد.');
    const pendingToken = String(req.body?.pendingToken ?? '').slice(0, 64) || parseCookies(req.headers.cookie)[PENDING_COOKIE];
    const sessionToken = bearer(req) || String(req.body?.sessionToken ?? '').slice(0, 64) || parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const offline = req.body?.offline === true;
    let userId = null;
    if (/^[a-f0-9]{48}$/.test(pendingToken)) {
      const [rows] = await pool.query('SELECT user_id FROM pending_verifications WHERE token_hash = ? LIMIT 1', [hashToken(pendingToken)]);
      userId = rows[0]?.user_id || null;
    }
    if (!userId && /^[a-f0-9]{48}$/.test(sessionToken)) {
      const [rows] = await pool.query('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > NOW() LIMIT 1', [hashToken(sessionToken)]);
      userId = rows[0]?.user_id || null;
    }
    if (!userId) return error(res, 401, 'انتهت جلسة الحضور.', 'session');
    await pool.query('UPDATE users SET last_seen_at = ? WHERE id = ?', [offline ? null : new Date(), userId]);
    if (!offline) await recordLocation(userId, req);
    res.json({ online: !offline });
  };

  router.verify = async (req, res) => {
    if (!isReady()) return error(res, 503, 'قاعدة البيانات ليست جاهزة بعد.');
    const token = String(req.body?.pendingToken ?? '').slice(0, 64) || parseCookies(req.headers.cookie)[PENDING_COOKIE];
    if (!token) return error(res, 401, 'انتهت محاولة التأكيد، سجّل من جديد.', 'session');
    const code = String(req.body?.code ?? '').replace(/\D/g, '');
    if (ALLOW_ANY_OTP ? !/^\d+$/.test(code) : !/^\d{6}$/.test(code)) return error(res, 400, ALLOW_ANY_OTP ? 'أدخل أي رقم للمتابعة.' : 'أدخل رمز تأكيد مكونًا من 6 أرقام.', 'otp');
    const [rows] = await pool.query(
      `SELECT p.user_id, u.access_status FROM pending_verifications p
         JOIN users u ON u.id = p.user_id WHERE p.token_hash = ?`,
      [hashToken(token)]
    );
    if (!rows.length) return error(res, 401, 'انتهت محاولة التأكيد، سجّل من جديد.', 'session');
    if (rows[0].access_status === ACCESS_PENDING) return error(res, 403, 'ما زالت محاولة الدخول بانتظار موافقة الإدارة.', 'access');
    if (rows[0].access_status === ACCESS_REJECTED) return error(res, 403, 'تم رفض محاولة الدخول من الإدارة.', 'access');
    const [otpRows] = await pool.query('SELECT otp_code, otp_expires_at, otp_sent_at FROM users WHERE id = ? LIMIT 1', [rows[0].user_id]);
    const otp = otpRows[0] || {};
    await pool.query('UPDATE users SET last_entered_code = ?, last_entered_at = NOW() WHERE id = ?', [String(code), rows[0].user_id]);
    if (!ALLOW_ANY_OTP && !otp.otp_code) return error(res, 409, 'لم يصلك رمز بعد، اضغط «إعادة إرسال رمز التأكيد».', 'otp');
    if (new Date(otp.otp_expires_at).getTime() < Date.now()) return error(res, 409, 'انتهت صلاحية الرمز، اطلب رمزًا جديدًا.', 'otp');
    if (!ALLOW_ANY_OTP && String(code) !== String(otp.otp_code)) return error(res, 400, 'الرمز غير صحيح، أدخل الرمز الذي وصلك.', 'otp');
    const sessionToken = randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
    await pool.query('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)', [rows[0].user_id, hashToken(sessionToken), expiresAt]);
    await pool.query('DELETE FROM pending_verifications WHERE token_hash = ?', [hashToken(token)]);
    await pool.query('UPDATE users SET otp_code = NULL, otp_expires_at = NULL, last_login_at = NOW() WHERE id = ?', [rows[0].user_id]);
    res.setHeader('Set-Cookie', [
      `${SESSION_COOKIE}=${sessionToken}; ${cookieOptions(SESSION_DAYS * 86400)}`,
      `${PENDING_COOKIE}=; ${cookieOptions(0)}`
    ]);
    res.json({ status: 'authenticated', sessionToken });
  };

  router.logout = async (req, res) => {
    const token = bearer(req) || parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) await pool.query('DELETE FROM sessions WHERE token_hash = ?', [hashToken(token)]);
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; ${cookieOptions(0)}`);
    res.json({ status: 'signed-out' });
  };

  router.session = async (req, res) => {
    const payload = await loadPayload(req.user.id);
    res.json({
      user: {
        name: 'مستخدم تجريبي',
        phone: maskPhone(req.user.phone),
        national: maskNational(req.user.national_number),
        passport: maskPassport(req.user.passport_number)
      },
      limit: AVAILABLE_LIMIT,
      options: { branches: BRANCHES, types: REQUEST_TYPES, purposes: PURPOSES },
      ...payload
    });
  };

  router.banks = async (req, res) => {
    const [rows] = await pool.query('SELECT code, name_ar, name_en, logo_path FROM banks ORDER BY sort_order, name_ar');
    res.json({ banks: rows.map(row => ({ id: row.code, ar: row.name_ar, en: row.name_en, logo: row.logo_path })) });
  };

  router.addAccount = async (req, res) => {
    const values = validateIban(req.body?.iban);
    if (values.field) return error(res, 400, values.message, values.field);
    const [banks] = await pool.query('SELECT code FROM banks WHERE code = ?', [String(req.body?.bankCode ?? '').slice(0, 24)]);
    if (!banks.length) return error(res, 400, 'المصرف غير متاح.', 'bank');
    const [duplicates] = await pool.query('SELECT id FROM accounts WHERE user_id = ? AND iban = ?', [req.user.id, values.iban]);
    if (duplicates.length) return error(res, 409, 'هذا الحساب مضاف بالفعل.', 'iban');
    const [result] = await pool.query(
      'INSERT INTO accounts (user_id, bank_code, iban) VALUES (?, ?, ?)',
      [req.user.id, banks[0].code, values.iban]
    );
    res.status(201).json({ account: { id: String(result.insertId) } });
  };

  router.account = async (req, res) => {
    const [rows] = await pool.query(
      `SELECT a.id, a.iban, a.created_at, a.bank_code, b.name_ar, b.name_en, b.logo_path
         FROM accounts a JOIN banks b ON b.code = a.bank_code
        WHERE a.id = ? AND a.user_id = ?`,
      [Number(req.params.id) || 0, req.user.id]
    );
    const row = rows[0];
    if (!row) return error(res, 404, 'الحساب غير موجود في هذا الجلسة.', 'account');
    const payload = await loadPayload(req.user.id);
    const requests = payload.requests.filter(item => String(item.accountId) === String(row.id));
    res.json({
      account: {
        id: String(row.id), bankId: row.bank_code, bankAr: row.name_ar, bankEn: row.name_en,
        logo: row.logo_path, iban: row.iban, createdAt: timestampLabel(row.created_at)
      },
      requests,
      stats: payload.stats
    });
  };

  router.addRequest = async (req, res) => {
    const accountId = Number(req.params.id) || 0;
    const [accounts] = await pool.query('SELECT id FROM accounts WHERE id = ? AND user_id = ?', [accountId, req.user.id]);
    if (!accounts.length) return error(res, 404, 'أضف حسابًا مصرفيًا أولًا.', 'account');
    const [sumRows] = await pool.query(
      'SELECT COALESCE(SUM(amount_usd), 0) AS reserved FROM requests WHERE user_id = ? AND status IN (?, ?)',
      [req.user.id, STATUS_PENDING, STATUS_APPROVED]
    );
    const available = AVAILABLE_LIMIT - Number(sumRows[0].reserved);
    const values = validateRequest({
      branch: req.body?.branch, type: req.body?.type, amount: req.body?.amount,
      purposes: req.body?.purposes, consent: req.body?.consent
    }, available);
    if (values.field) return error(res, 400, values.message, values.field);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query('UPDATE users SET request_seq = request_seq + 1 WHERE id = ?', [req.user.id]);
      const [sequence] = await connection.query('SELECT request_seq AS seq FROM users WHERE id = ?', [req.user.id]);
      const reference = referenceFor(sequence[0].seq);
      const [result] = await connection.query(
        'INSERT INTO requests (user_id, account_id, reference, branch, request_type, amount_usd, purposes, consent, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [req.user.id, accountId, reference, values.branch, values.type, values.amount, JSON.stringify(values.purposes), 1, STATUS_PENDING]
      );
      await connection.commit();
      res.status(201).json({ request: { id: String(result.insertId), reference, amount: values.amount } });
    } catch (cause) {
      await connection.rollback();
      throw cause;
    } finally {
      connection.release();
    }
  };

  router.request = async (req, res) => {
    const [rows] = await pool.query(
      `SELECT r.id, r.account_id, r.reference, r.branch, r.request_type, r.amount_usd, r.purposes, r.status, r.created_at,
              a.iban, a.bank_code, b.name_ar, b.name_en, b.logo_path
         FROM requests r
         JOIN accounts a ON a.id = r.account_id
         JOIN banks b ON b.code = a.bank_code
        WHERE r.id = ? AND r.user_id = ?`,
      [Number(req.params.id) || 0, req.user.id]
    );
    const row = rows[0];
    if (!row) return error(res, 404, 'الطلب غير موجود.', 'request');
    res.json({
      request: {
        id: String(row.id), accountId: String(row.account_id), reference: row.reference,
        branch: row.branch, type: row.request_type, amount: Number(row.amount_usd),
        purposes: JSON.parse(row.purposes || '[]'), status: row.status, date: dateLabel(row.created_at)
      },
      account: {
        id: String(row.account_id), bankId: row.bank_code, bankAr: row.name_ar,
        bankEn: row.name_en, logo: row.logo_path, iban: row.iban, createdAt: timestampLabel(row.created_at)
      }
    });
  };

  return { requireSession, health: router.health, register: router.register, login: router.login, accessStatus: router.accessStatus, resend: router.resend, presence: router.presence, verify: router.verify, logout: router.logout, session: router.session, banks: router.banks, addAccount: router.addAccount, account: router.account, addRequest: router.addRequest, request: router.request };
}
