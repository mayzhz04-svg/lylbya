import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { hashToken } from './db.js';

export const ADMIN_COOKIE = 'webdev_app_session';
const NONCE_COOKIE = 'fcms_admin_nonce';
const SESSION_SECONDS = 8 * 3600;
// Origins observed for this project's public site and embedded Preview, not internal request Hosts.
const PROJECT_ORIGINS = new Set([
  'https://fcmsclone-ekkffgn2.manus.space',
  'https://8328-i8wh8fy1lao23h506zs2r-a74ba0c5.sg2.manus.computer',
  'http://127.0.0.1:3000'
]);

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS admin_identities (
    open_id VARCHAR(191) NOT NULL PRIMARY KEY,
    email VARCHAR(254) NOT NULL,
    display_name VARCHAR(160) NOT NULL,
    authorized_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash CHAR(64) NOT NULL PRIMARY KEY,
    open_id VARCHAR(191) NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_admin_expiry (expires_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS admin_oauth_states (
    nonce_hash CHAR(64) NOT NULL PRIMARY KEY,
    redirect_uri VARCHAR(1024) NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS admin_credentials (
    username VARCHAR(254) NOT NULL PRIMARY KEY,
    password_hash VARCHAR(255) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
];

export async function migrateAdmin(pool) {
  for (const sql of SCHEMA) await pool.query(sql);
  const username = process.env.ADMIN_USERNAME?.trim();
  const password = process.env.ADMIN_PASSWORD;
  if (username && password) {
    const [rows] = await pool.query('SELECT username FROM admin_credentials WHERE username = ? LIMIT 1', [username]);
    if (!rows.length) await pool.query('INSERT INTO admin_credentials (username, password_hash) VALUES (?, ?)', [username, hashPassword(password)]);
  }
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, salt, digest] = String(stored || '').split(':');
  if (scheme !== 'scrypt' || !salt || !digest) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(digest, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map(part => {
    const idx = part.indexOf('=');
    return idx < 0 ? ['', ''] : [part.slice(0, idx).trim(), part.slice(idx + 1).trim()];
  }));
}

function cookie(value, maxAge, name = ADMIN_COOKIE) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${maxAge}`;
}

function reject(res, status, message) {
  return res.status(status).json({ error: { message } });
}

export function signProjectJwt(claims, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

export function verifyProjectJwt(token, secret, projectId, now = Date.now()) {
  if (!secret || !projectId || typeof token !== 'string' || token.length > 4096) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) return null;
    const head = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    if (head.alg !== 'HS256') return null;
    const supplied = Buffer.from(parts[2], 'base64url');
    const expected = createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (claims.appId !== projectId || typeof claims.openId !== 'string' || !claims.openId || claims.openId.length > 191) return null;
    if (!Number.isFinite(claims.exp) || claims.exp <= Math.floor(now / 1000)) return null;
    if (claims.nbf && claims.nbf > Math.floor(now / 1000)) return null;
    return claims;
  } catch { return null; }
}

function tokenFrom(req) {
  const authorization = String(req.headers.authorization || '');
  return authorization.startsWith('Bearer ') ? authorization.slice(7, 4103) : cookies(req)[ADMIN_COOKIE];
}

function localConfigured() {
  return Boolean(process.env.ADMIN_USERNAME?.trim());
}

function configured() {
  return localConfigured() || Boolean(process.env.ADMIN_EMAIL?.trim() && process.env.MANUS_PROJECT_ID &&
    process.env.MANUS_JWT_SECRET && process.env.MANUS_OAUTH_PORTAL_URL && process.env.MANUS_OAUTH_API_URL);
}

export function allowedAdminEmail(email) {
  const configuredEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  return Boolean(configuredEmail && typeof email === 'string' && email.trim().toLowerCase() === configuredEmail);
}

function sameBrowserOrigin(req, origin) {
  if (!PROJECT_ORIGINS.has(origin)) return false;
  // Preview's reverse proxy can rewrite Origin. Browsers cannot forge Sec-Fetch-Site;
  // a same-origin fetch, the fixed project allowlist and the bound nonce still prevent CSRF.
  return String(req.headers.origin || '') === origin || req.headers['sec-fetch-site'] === 'same-origin';
}

async function oauthRpc(method, body) {
  const base = process.env.MANUS_OAUTH_API_URL?.replace(/\/$/, '');
  if (!base) throw new Error('oauth_unconfigured');
  const response = await fetch(`${base}/webdev.v1.WebDevAuthPublicService/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'connect-protocol-version': '1' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error('oauth_exchange_failed');
  return result;
}

export function createAdminAuth({ pool, isReady }) {
  async function readAdmin(req) {
    if (!configured() || !isReady()) return null;
    const token = tokenFrom(req);
    if (localConfigured()) {
      const username = process.env.ADMIN_USERNAME.trim();
      if (typeof token !== 'string' || !token) return null;
      const [sessions] = await pool.query(
        'SELECT open_id FROM admin_sessions WHERE token_hash = ? AND open_id = ? AND expires_at > NOW() LIMIT 1',
        [hashToken(token), username]
      );
      if (!sessions.length) return null;
      return { openId: `local:${username}`, name: username, email: '' };
    }
    const claims = verifyProjectJwt(token, process.env.MANUS_JWT_SECRET, process.env.MANUS_PROJECT_ID);
    if (!claims) return null;
    // A signed identity alone is never sufficient: resolve the explicitly authorized role.
    const [identities] = await pool.query(
      'SELECT open_id, email, display_name FROM admin_identities WHERE open_id = ? LIMIT 1', [claims.openId]
    );
    const identity = identities[0];
    if (!identity || !allowedAdminEmail(identity.email)) return null;
    if (claims.jti) {
      const [sessions] = await pool.query(
        'SELECT 1 FROM admin_sessions WHERE token_hash = ? AND open_id = ? AND expires_at > NOW() LIMIT 1',
        [hashToken(token), claims.openId]
      );
      if (!sessions.length) return null;
    }
    // Preview's validated project JWT has no application jti and uses the same role lookup.
    return { openId: identity.open_id, name: identity.display_name, email: identity.email };
  }

  async function requireAdmin(req, res, next) {
    const admin = await readAdmin(req);
    if (!admin) return reject(res, 401, localConfigured() ? 'اسم المستخدم أو كلمة المرور غير صحيحة.' : 'هذه المعلومات خاصة بالمدير. سجّل الدخول بحساب Manus المخوّل.');
    req.admin = admin;
    next();
  }

  async function session(req, res) {
    const admin = await readAdmin(req);
    const token = tokenFrom(req);
    res.json({ configured: configured(), authenticated: Boolean(admin), admin: admin ? { name: admin.name, email: admin.email } : null,
      ...(admin && localConfigured() && typeof token === 'string' ? { sessionToken: token } : {}) });
  }

  async function login(req, res) {
    if (!isReady()) return reject(res, 503, 'لوحة الإدارة ليست جاهزة بعد.');
    if (!localConfigured()) return reject(res, 503, 'لم يتم إعداد دخول لوحة التحكم بعد.');
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const expectedUsername = process.env.ADMIN_USERNAME.trim();
    const [credentials] = await pool.query('SELECT password_hash FROM admin_credentials WHERE username = ? LIMIT 1', [expectedUsername]);
    if (username !== expectedUsername || !credentials.length || !verifyPassword(password, credentials[0].password_hash)) {
      return reject(res, 401, 'اسم المستخدم أو كلمة المرور غير صحيحة.');
    }
    const token = randomBytes(32).toString('hex');
    await pool.query('INSERT INTO admin_sessions (token_hash, open_id, expires_at) VALUES (?, ?, ?)',
      [hashToken(token), expectedUsername, new Date(Date.now() + SESSION_SECONDS * 1000)]);
    res.setHeader('Set-Cookie', cookie(token, SESSION_SECONDS));
    res.json({ sessionToken: token, admin: { name: expectedUsername, email: '' } });
  }

  async function start(req, res) {
    if (!isReady()) return reject(res, 503, 'لوحة الإدارة ليست جاهزة بعد.');
    if (!configured()) return reject(res, 503, 'حدّد البريد المخوّل للإدارة في إعدادات المشروع أولًا.');
    const origin = String(req.body?.origin || '');
    if (!sameBrowserOrigin(req, origin)) return reject(res, 400, 'ابدأ الدخول من صفحة لوحة الإدارة نفسها.');
    const nonce = randomBytes(24).toString('hex');
    const redirectUri = `${origin}/admin/callback`;
    await pool.query('INSERT INTO admin_oauth_states (nonce_hash, redirect_uri, expires_at) VALUES (?, ?, ?)',
      [hashToken(nonce), redirectUri, new Date(Date.now() + 10 * 60000)]);
    const state = Buffer.from(JSON.stringify({ redirectUri, nonce })).toString('base64');
    const portal = new URL('/app-auth', process.env.MANUS_OAUTH_PORTAL_URL);
    portal.search = new URLSearchParams({ appId: process.env.MANUS_PROJECT_ID, redirectUri, state, responseType: 'code' }).toString();
    res.setHeader('Set-Cookie', cookie(nonce, 600, NONCE_COOKIE));
    res.json({ url: portal.toString(), nonce });
  }

  async function complete(req, res) {
    if (!configured() || !isReady()) return reject(res, 503, 'إعداد الدخول الإداري غير مكتمل.');
    let state;
    try { state = JSON.parse(Buffer.from(String(req.body?.state || '').slice(0, 4096), 'base64').toString()); }
    catch { return reject(res, 400, 'رابط التأكيد غير صالح. ابدأ الدخول مجددًا.'); }
    const nonce = String(req.body?.nonce || '');
    const code = String(req.body?.code || '');
    if (!/^[a-f0-9]{48}$/.test(nonce) || nonce !== state.nonce || !code || code.length > 4096) {
      return reject(res, 400, 'انتهت محاولة الدخول أو لا تنتمي لهذا المتصفح.');
    }
    let origin;
    try { origin = new URL(state.redirectUri).origin; }
    catch { return reject(res, 400, 'عنوان التأكيد غير صالح.'); }
    if (!sameBrowserOrigin(req, origin) || state.redirectUri !== `${origin}/admin/callback`) return reject(res, 400, 'عنوان التأكيد غير مخوّل.');
    const boundCookie = cookies(req)[NONCE_COOKIE];
    if (boundCookie !== nonce) return reject(res, 400, 'محاولة الدخول لا تنتمي لهذا المتصفح. افتح اللوحة في تبويب مستقل وابدأ مجددًا.');
    // Atomically consume the server-side nonce. Replay never reaches the provider exchange.
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [states] = await connection.query(
        'SELECT redirect_uri FROM admin_oauth_states WHERE nonce_hash = ? AND expires_at > NOW() FOR UPDATE', [hashToken(nonce)]
      );
      if (!states.length || states[0].redirect_uri !== state.redirectUri) {
        await connection.rollback();
        return reject(res, 400, 'انتهت محاولة الدخول. ابدأها مجددًا.');
      }
      await connection.query('DELETE FROM admin_oauth_states WHERE nonce_hash = ?', [hashToken(nonce)]);
      await connection.commit();
    } catch (cause) { await connection.rollback(); throw cause; }
    finally { connection.release(); }
    const exchanged = await oauthRpc('ExchangeToken', {
      clientId: process.env.MANUS_PROJECT_ID, grantType: 'authorization_code', code, redirectUri: state.redirectUri
    });
    if (!exchanged.accessToken) return reject(res, 401, 'تعذّر تأكيد هوية حساب Manus.');
    const identity = await oauthRpc('GetUserInfo', { accessToken: exchanged.accessToken });
    if (!allowedAdminEmail(identity.email) || typeof identity.openId !== 'string' || !identity.openId || identity.openId.length > 191) {
      return reject(res, 403, 'حساب Manus هذا غير مخوّل للوصول إلى معلومات الإدارة.');
    }
    const displayName = String(identity.name || 'مدير المنصة').slice(0, 160);
    const email = identity.email.trim().toLowerCase();
    await pool.query(
      `INSERT INTO admin_identities (open_id, email, display_name) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE email = VALUES(email), display_name = VALUES(display_name)`,
      [identity.openId, email, displayName]
    );
    const token = signProjectJwt({ appId: process.env.MANUS_PROJECT_ID, openId: identity.openId,
      iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
      jti: randomBytes(24).toString('hex') }, process.env.MANUS_JWT_SECRET);
    await pool.query('INSERT INTO admin_sessions (token_hash, open_id, expires_at) VALUES (?, ?, ?)',
      [hashToken(token), identity.openId, new Date(Date.now() + SESSION_SECONDS * 1000)]);
    res.setHeader('Set-Cookie', [cookie(token, SESSION_SECONDS), cookie('', 0, NONCE_COOKIE)]);
    res.json({ sessionToken: token, admin: { name: displayName, email } });
  }

  async function logout(req, res) {
    const token = tokenFrom(req);
    if (typeof token === 'string' && token.length <= 4096) await pool.query('DELETE FROM admin_sessions WHERE token_hash = ?', [hashToken(token)]);
    res.setHeader('Set-Cookie', [cookie('', 0), cookie('', 0, NONCE_COOKIE)]);
    res.json({ status: 'signed-out' });
  }

  return { requireAdmin, session, login, start, complete, logout };
}
