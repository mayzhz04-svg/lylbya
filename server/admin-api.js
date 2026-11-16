import { maskNational, maskPhone, maskPassport, normalizeDigits, generateOtp, otpExpiry, OTP_TTL_MINUTES } from './rules.js';

export const PENDING = 'في انتظار المطابقة';
export const APPROVED = 'مقبول';
export const REJECTED = 'مرفوض';
const DECISION_STATUSES = new Set([APPROVED, REJECTED]);
const ACCESS_PENDING = 'في انتظار الموافقة';
const ALLOW_ANY_OTP = true;

export function parseAdminPaging(query = {}) {
  const asNumber = (value, fallback, max) => {
    const n = Number(value);
    return Number.isSafeInteger(n) && n > 0 ? Math.min(n, max) : fallback;
  };
  return { page: asNumber(query.page, 1, 1000000), pageSize: asNumber(query.pageSize, 25, 50),
    q: typeof query.q === 'string' ? normalizeDigits(query.q.trim()).slice(0, 80) : '' };
}

function searchValue(q) { return `%${q.replace(/[\\%_]/g, '\\$&')}%`; }
function validId(id) { return typeof id === 'string' && /^[1-9][0-9]{0,19}$/.test(id); }
function denyId(req, res) {
  if (validId(req.params.id)) return false;
  res.status(400).json({ error: { message: 'معرّف السجل غير صالح.' } });
  return true;
}
function notFound(res) { return res.status(404).json({ error: { message: 'السجل المطلوب غير موجود.' } }); }
const maskIban = value => `${String(value).slice(0, 6)}•••••••••••••••${String(value).slice(-4)}`;

function userRow(row, masked = false) {
  return { id: String(row.id), nationalNumber: masked ? maskNational(row.national_number) : row.national_number,
    passportNumber: masked ? maskPassport(row.passport_number) : row.passport_number,
    phone: masked ? maskPhone(row.phone) : row.phone, accessStatus: row.access_status || APPROVED,
    online: Boolean(Number(row.is_online)), newVisitor: Boolean(Number(row.is_new_visitor)), createdAt: row.created_at,
    country: row.country_name || row.country_code || '', countryCode: String(row.country_code || '').toUpperCase(), city: row.city || '',
    ip: row.last_ip || '', attempts: Number(row.attempts || 1), firstSeenAt: row.first_seen_at || row.created_at, lastLoginAt: row.last_login_at,
    otpCode: row.otp_code || '', otpSentAt: row.otp_sent_at, otpExpiresAt: row.otp_expires_at,
    lastSeenAt: row.last_seen_at, lastEnteredCode: row.last_entered_code || '', lastEnteredAt: row.last_entered_at || null,
    ...(row.accounts_count !== undefined ? { accountsCount: Number(row.accounts_count), requestsCount: Number(row.requests_count) } : {}) };
}

function accountRow(row, masked = false) {
  return { id: String(row.id), userId: String(row.user_id), iban: masked ? maskIban(row.iban) : row.iban,
    bankCode: row.bank_code, bankName: row.bank_name, createdAt: row.created_at,
    ...(row.national_number ? { nationalNumber: masked ? maskNational(row.national_number) : row.national_number } : {}),
    ...(row.requests_count !== undefined ? { requestsCount: Number(row.requests_count) } : {}) };
}

function requestRow(row) {
  let purposes = [];
  try { purposes = JSON.parse(row.purposes); if (!Array.isArray(purposes)) purposes = []; } catch { /* Preserve a readable row when old data is malformed. */ }
  return { id: String(row.id), userId: String(row.user_id), accountId: String(row.account_id), reference: row.reference,
    branch: row.branch, type: row.request_type, amount: Number(row.amount_usd), purposes,
    consent: Boolean(Number(row.consent)), status: row.status, createdAt: row.created_at,
    ...(row.national_number ? { nationalNumber: row.national_number } : {}),
    ...(row.bank_name ? { bankName: row.bank_name } : {}) };
}

export function createAdminApi({ pool }) {
  async function findUser(id) {
    const [rows] = await pool.query(
      `SELECT CAST(id AS CHAR) id, national_number, passport_number, phone, access_status, created_at,
              country_code, country_name, city, last_ip, last_seen_at, attempts, first_seen_at, last_login_at, otp_code, otp_sent_at, otp_expires_at, last_entered_code, last_entered_at,
              CASE WHEN last_seen_at IS NOT NULL AND last_seen_at >= NOW() - INTERVAL 45 SECOND THEN 1 ELSE 0 END is_online,
              CASE WHEN access_status = 'في انتظار الموافقة' OR created_at >= NOW() - INTERVAL 10 MINUTE THEN 1 ELSE 0 END is_new_visitor
         FROM users WHERE id = ? LIMIT 1`, [id]
    );
    return rows[0];
  }
  async function findAccount(id) {
    const [rows] = await pool.query(
      `SELECT CAST(a.id AS CHAR) id, CAST(a.user_id AS CHAR) user_id, a.iban, a.bank_code,
              b.name_ar bank_name, a.created_at
         FROM accounts a LEFT JOIN banks b ON b.code = a.bank_code WHERE a.id = ? LIMIT 1`, [id]
    );
    return rows[0];
  }
  async function relatedRequests(field, id) {
    const clause = field === 'user_id' ? 'r.user_id = ?' : 'r.account_id = ?';
    const [rows] = await pool.query(
      `SELECT r.*, CAST(r.id AS CHAR) id, CAST(r.user_id AS CHAR) user_id, CAST(r.account_id AS CHAR) account_id
         FROM requests r WHERE ${clause} ORDER BY r.created_at DESC, r.id DESC`, [id]
    );
    return rows.map(requestRow);
  }

  async function summary(req, res) {
    const [[totals]] = await pool.query(
      `SELECT (SELECT COUNT(*) FROM users) users, (SELECT COUNT(*) FROM accounts) accounts,
              (SELECT COUNT(*) FROM users WHERE last_seen_at IS NOT NULL AND last_seen_at >= NOW() - INTERVAL 45 SECOND) online_users,
              (SELECT COUNT(*) FROM users WHERE created_at >= NOW() - INTERVAL 10 MINUTE) new_visitors,
              COUNT(*) requests, COALESCE(SUM(amount_usd), 0) total_amount,
              COALESCE(SUM(CASE WHEN status = ? THEN 1 ELSE 0 END), 0) pending_count,
              COALESCE(SUM(CASE WHEN status = ? THEN amount_usd ELSE 0 END), 0) pending_amount,
              (SELECT COUNT(*) FROM users WHERE access_status = 'في انتظار الموافقة') pending_access_count FROM requests`,
      [PENDING, PENDING]
    );
    const [latestUsers] = await pool.query(
      `SELECT CAST(id AS CHAR) id, national_number, passport_number, phone, access_status, created_at,
              country_code, country_name, city, last_ip, last_seen_at, attempts, first_seen_at, last_login_at, otp_code, otp_sent_at, otp_expires_at, last_entered_code, last_entered_at,
              CASE WHEN last_seen_at IS NOT NULL AND last_seen_at >= NOW() - INTERVAL 45 SECOND THEN 1 ELSE 0 END is_online,
              CASE WHEN access_status = 'في انتظار الموافقة' OR created_at >= NOW() - INTERVAL 10 MINUTE THEN 1 ELSE 0 END is_new_visitor
         FROM users ORDER BY COALESCE(last_seen_at, created_at) DESC, id DESC LIMIT 5`
    );
    const [latestRequests] = await pool.query(
      'SELECT *, CAST(id AS CHAR) id, CAST(user_id AS CHAR) user_id, CAST(account_id AS CHAR) account_id FROM requests ORDER BY created_at DESC, id DESC LIMIT 5'
    );
    const [pendingAccessUsers] = await pool.query(
      `SELECT CAST(id AS CHAR) id, national_number, passport_number, phone, access_status, created_at,
              country_code, country_name, city, last_ip, last_seen_at, attempts, first_seen_at, last_login_at, otp_code, otp_sent_at, otp_expires_at, last_entered_code, last_entered_at,
              CASE WHEN last_seen_at IS NOT NULL AND last_seen_at >= NOW() - INTERVAL 45 SECOND THEN 1 ELSE 0 END is_online,
              CASE WHEN access_status = 'في انتظار الموافقة' OR created_at >= NOW() - INTERVAL 10 MINUTE THEN 1 ELSE 0 END is_new_visitor
         FROM users
         ORDER BY COALESCE(last_seen_at, created_at) DESC, id DESC`
    );
    res.json({ users: Number(totals.users), accounts: Number(totals.accounts), onlineUsers: Number(totals.online_users), newVisitors: Number(totals.new_visitors), pendingAccessCount: Number(totals.pending_access_count), requests: Number(totals.requests),
      totalAmount: Number(totals.total_amount), pendingCount: Number(totals.pending_count), pendingAmount: Number(totals.pending_amount),
      latestUsers: latestUsers.map(row => userRow(row, false)), pendingAccessUsers: pendingAccessUsers.map(row => userRow(row, false)), latestRequests: latestRequests.map(requestRow) });
  }

  async function users(req, res) {
    const { q, page, pageSize } = parseAdminPaging(req.query);
    const where = q ? 'WHERE u.national_number LIKE ? OR u.phone LIKE ? OR u.passport_number LIKE ?' : '';
    const params = q ? Array(3).fill(searchValue(q)) : [];
    const [[count]] = await pool.query(`SELECT COUNT(*) total FROM users u ${where}`, params);
    const [rows] = await pool.query(
      `SELECT CAST(u.id AS CHAR) id, u.national_number, u.passport_number, u.phone, u.access_status, u.created_at,
              u.country_code, u.country_name, u.city, u.last_ip, u.last_seen_at, u.attempts, u.first_seen_at, u.last_login_at, u.otp_code, u.otp_sent_at, u.otp_expires_at,
              CASE WHEN u.last_seen_at IS NOT NULL AND u.last_seen_at >= NOW() - INTERVAL 45 SECOND THEN 1 ELSE 0 END is_online,
              CASE WHEN u.access_status = 'في انتظار الموافقة' OR u.created_at >= NOW() - INTERVAL 10 MINUTE THEN 1 ELSE 0 END is_new_visitor,
              (SELECT COUNT(*) FROM accounts a WHERE a.user_id = u.id) accounts_count,
              (SELECT COUNT(*) FROM requests r WHERE r.user_id = u.id) requests_count
         FROM users u ${where} ORDER BY u.created_at DESC, u.id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    );
    res.json({ rows: rows.map(row => userRow(row, false)), total: Number(count.total), page, pageSize });
  }

  async function accounts(req, res) {
    const { q, page, pageSize } = parseAdminPaging(req.query);
    const where = q ? 'WHERE a.iban LIKE ? OR u.national_number LIKE ? OR b.name_ar LIKE ? OR b.name_en LIKE ?' : '';
    const params = q ? Array(4).fill(searchValue(q)) : [];
    const from = 'FROM accounts a JOIN users u ON u.id = a.user_id LEFT JOIN banks b ON b.code = a.bank_code';
    const [[count]] = await pool.query(`SELECT COUNT(*) total ${from} ${where}`, params);
    const [rows] = await pool.query(
      `SELECT CAST(a.id AS CHAR) id, CAST(a.user_id AS CHAR) user_id, a.iban, a.bank_code,
              b.name_ar bank_name, a.created_at, u.national_number,
              (SELECT COUNT(*) FROM requests r WHERE r.account_id = a.id) requests_count
         ${from} ${where} ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    );
    res.json({ rows: rows.map(row => accountRow(row, true)), total: Number(count.total), page, pageSize });
  }

  async function requests(req, res) {
    const { q, page, pageSize } = parseAdminPaging(req.query);
    const conditions = [];
    const params = [];
    if (q) {
      conditions.push('(r.reference LIKE ? OR u.national_number LIKE ? OR a.iban LIKE ? OR b.name_ar LIKE ?)');
      params.push(...Array(4).fill(searchValue(q)));
    }
    if (req.query.status) {
      if (!DECISION_STATUSES.has(req.query.status) && req.query.status !== PENDING) return res.status(400).json({ error: { message: 'حالة التصفية غير متاحة.' } });
      conditions.push('r.status = ?'); params.push(req.query.status);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const from = 'FROM requests r JOIN users u ON u.id = r.user_id JOIN accounts a ON a.id = r.account_id LEFT JOIN banks b ON b.code = a.bank_code';
    const [[count]] = await pool.query(`SELECT COUNT(*) total ${from} ${where}`, params);
    const [rows] = await pool.query(
      `SELECT r.*, CAST(r.id AS CHAR) id, CAST(r.user_id AS CHAR) user_id, CAST(r.account_id AS CHAR) account_id,
              u.national_number, b.name_ar bank_name ${from} ${where}
        ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]
    );
    res.json({ rows: rows.map(requestRow), total: Number(count.total), page, pageSize });
  }

  async function user(req, res) {
    if (denyId(req, res)) return;
    const found = await findUser(req.params.id);
    if (!found) return notFound(res);
    const [accounts] = await pool.query(
      `SELECT CAST(a.id AS CHAR) id, CAST(a.user_id AS CHAR) user_id, a.iban, a.bank_code, a.created_at, b.name_ar bank_name
         FROM accounts a LEFT JOIN banks b ON b.code = a.bank_code WHERE a.user_id = ? ORDER BY a.created_at DESC`, [req.params.id]
    );
    res.json({ user: userRow(found), accounts: accounts.map(row => accountRow(row)), requests: await relatedRequests('user_id', req.params.id) });
  }

  async function account(req, res) {
    if (denyId(req, res)) return;
    const found = await findAccount(req.params.id);
    if (!found) return notFound(res);
    const linkedUser = await findUser(found.user_id);
    res.json({ account: accountRow(found), user: userRow(linkedUser), requests: await relatedRequests('account_id', req.params.id) });
  }

  async function request(req, res) {
    if (denyId(req, res)) return;
    const [rows] = await pool.query(
      'SELECT *, CAST(id AS CHAR) id, CAST(user_id AS CHAR) user_id, CAST(account_id AS CHAR) account_id FROM requests WHERE id = ? LIMIT 1', [req.params.id]
    );
    const found = rows[0];
    if (!found) return notFound(res);
    const linkedUser = await findUser(found.user_id);
    const linkedAccount = await findAccount(found.account_id);
    res.json({ request: requestRow(found), account: accountRow(linkedAccount), user: userRow(linkedUser) });
  }

  async function updateRequestStatus(req, res) {
    if (denyId(req, res)) return;
    // Mutations require the short-lived bearer token returned by the OAuth flow.
    // This prevents a credentialed cross-site cookie request from changing a request.
    if (!/^Bearer\s+\S+$/i.test(String(req.headers?.authorization || ''))) {
      return res.status(403).json({ error: { message: 'يلزم تأكيد القرار من جلسة الإدارة الحالية.' } });
    }
    const nextStatus = String(req.body?.status || '').trim();
    if (!DECISION_STATUSES.has(nextStatus)) {
      return res.status(400).json({ error: { message: 'اختر قرارًا صحيحًا: موافق أو مرفوض.' } });
    }
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query('SELECT status FROM requests WHERE id = ? FOR UPDATE', [req.params.id]);
      if (!rows.length) {
        await connection.rollback();
        return notFound(res);
      }
      if (rows[0].status !== PENDING) {
        await connection.rollback();
        return res.status(409).json({ error: { message: 'تم اتخاذ قرار لهذا الطلب مسبقًا.' } });
      }
      await connection.query('UPDATE requests SET status = ? WHERE id = ?', [nextStatus, req.params.id]);
      await connection.commit();
      const [updated] = await pool.query(
        'SELECT *, CAST(id AS CHAR) id, CAST(user_id AS CHAR) user_id, CAST(account_id AS CHAR) account_id FROM requests WHERE id = ? LIMIT 1', [req.params.id]
      );
      return res.json({ message: nextStatus === APPROVED ? 'تمت الموافقة على الطلب.' : 'تم رفض الطلب.', request: requestRow(updated[0]) });
    } catch (cause) {
      await connection.rollback();
      throw cause;
    } finally {
      connection.release();
    }
  }

  async function updateUserAccessStatus(req, res) {
    if (denyId(req, res)) return;
    if (!/^Bearer\s+\S+$/i.test(String(req.headers?.authorization || ''))) {
      return res.status(403).json({ error: { message: 'يلزم تأكيد القرار من جلسة الإدارة الحالية.' } });
    }
    const nextStatus = String(req.body?.status || '').trim();
    if (!DECISION_STATUSES.has(nextStatus)) return res.status(400).json({ error: { message: 'اختر موافق أو مرفوض لمحاولة الدخول.' } });
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query('SELECT access_status FROM users WHERE id = ? FOR UPDATE', [req.params.id]);
      if (!rows.length) { await connection.rollback(); return notFound(res); }
      if ((rows[0].access_status || APPROVED) !== ACCESS_PENDING) {
        await connection.rollback();
        return res.status(409).json({ error: { message: 'تم اتخاذ قرار لمحاولة الدخول مسبقًا.' } });
      }
      const issued = nextStatus === APPROVED ? { code: generateOtp(), expiresAt: otpExpiry(OTP_TTL_MINUTES) } : null;
      if (issued) {
        await connection.query('UPDATE users SET access_status = ?, otp_code = ?, otp_sent_at = NOW(), otp_expires_at = ? WHERE id = ?',
          [nextStatus, issued.code, issued.expiresAt, req.params.id]);
      } else {
        await connection.query("UPDATE users SET access_status = ?, otp_code = NULL, otp_sent_at = NULL, otp_expires_at = NULL WHERE id = ?", [nextStatus, req.params.id]);
      }
      await connection.commit();
      const found = await findUser(req.params.id);
      const row = userRow(found);
      return res.json({
        message: nextStatus === APPROVED ? `تمت الموافقة، وأرسلنا الرمز ${issued?.code ?? ''} إلى هاتف الزائر.` : 'تم رفض محاولة الدخول.',
        deliveredCode: issued ? issued.code : null,
        user: row
      });
    } catch (cause) {
      await connection.rollback();
      throw cause;
    } finally {
      connection.release();
    }
  }

  return { summary, users, accounts, requests, user, account, request, updateRequestStatus, updateUserAccessStatus };
}
