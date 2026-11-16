import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createAdminAuth, signProjectJwt, verifyProjectJwt, allowedAdminEmail } from '../server/admin-auth.js';
import { parseAdminPaging, APPROVED, REJECTED, PENDING } from '../server/admin-api.js';

const envKeys = ['ADMIN_EMAIL', 'ADMIN_USERNAME', 'ADMIN_PASSWORD', 'MANUS_PROJECT_ID', 'MANUS_JWT_SECRET', 'MANUS_OAUTH_API_URL', 'MANUS_OAUTH_PORTAL_URL'];
const original = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
const secret = 'unit-test-key-not-a-production-key';
const projectId = 'unit-project';
const origin = 'https://fcmsclone-ekkffgn2.manus.space';
const now = Math.floor(Date.now() / 1000);
const hash = value => createHash('sha256').update(value).digest('hex');

function response() {
  return { statusCode: 200, headers: {}, body: null,
    status(code) { this.statusCode = code; return this; },
    setHeader(key, value) { this.headers[key] = value; },
    json(value) { this.body = value; return this; } };
}

try {
  Object.assign(process.env, { ADMIN_EMAIL: 'manager@example.test', MANUS_PROJECT_ID: projectId,
    MANUS_JWT_SECRET: secret, MANUS_OAUTH_API_URL: 'https://oauth-api.example.test',
    MANUS_OAUTH_PORTAL_URL: 'https://oauth.example.test' });
  delete process.env.ADMIN_USERNAME;
  delete process.env.ADMIN_PASSWORD;

  const token = signProjectJwt({ appId: projectId, openId: 'unit-identity', exp: now + 600 }, secret);
  assert.equal(verifyProjectJwt(token, secret, projectId).openId, 'unit-identity');
  assert.equal(verifyProjectJwt(token, 'wrong-key', projectId), null);
  assert.equal(verifyProjectJwt(token, secret, 'other-project'), null);
  assert.equal(verifyProjectJwt(signProjectJwt({ appId: projectId, openId: 'x', exp: now - 1 }, secret), secret, projectId), null);
  assert.equal(verifyProjectJwt(signProjectJwt({ appId: projectId, openId: 'x' }, secret), secret, projectId), null);
  assert.equal(verifyProjectJwt('eyJhbGciOiJub25lIn0.e30.', secret, projectId), null);
  assert.equal(verifyProjectJwt('123456', secret, projectId), null);
  assert.equal(allowedAdminEmail('MANAGER@example.test'), true);
  assert.equal(allowedAdminEmail('visitor@example.test'), false);
  assert.deepEqual(parseAdminPaging({ page: '-3', pageSize: '500', q: ' ١٢٣ ' }), { page: 1, pageSize: 50, q: '123' });
  assert.equal(PENDING, 'في انتظار المطابقة');
  assert.equal(APPROVED, 'مقبول');
  assert.equal(REJECTED, 'مرفوض');

  const identities = new Map();
  const sessions = new Map();
  const states = new Map();
  let exchanges = 0;
  const fakePool = {
    async query(sql, args = []) {
      if (sql.startsWith('SELECT open_id')) return [[identities.get(args[0])].filter(Boolean)];
      if (sql.startsWith('SELECT 1 FROM admin_sessions')) return [sessions.has(args[0]) ? [{ one: 1 }] : []];
      if (sql.startsWith('INSERT INTO admin_oauth_states')) { states.set(args[0], { redirect_uri: args[1] }); return [{ affectedRows: 1 }]; }
      if (sql.startsWith('SELECT redirect_uri')) return [[states.get(args[0])].filter(Boolean)];
      if (sql.startsWith('DELETE FROM admin_oauth_states')) { states.delete(args[0]); return [{ affectedRows: 1 }]; }
      if (sql.includes('INSERT INTO admin_identities')) { identities.set(args[0], { open_id: args[0], email: args[1], display_name: args[2] }); return [{ affectedRows: 1 }]; }
      if (sql.startsWith('INSERT INTO admin_sessions')) { sessions.set(args[0], args[1]); return [{ affectedRows: 1 }]; }
      if (sql.startsWith('DELETE FROM admin_sessions')) { sessions.delete(args[0]); return [{ affectedRows: 1 }]; }
      throw new Error('unexpected test query');
    },
    async getConnection() { return { query: this.query.bind(this), async beginTransaction() {}, async commit() {}, async rollback() {}, release() {} }; }
  };
  const auth = createAdminAuth({ pool: fakePool, isReady: () => true });
  const req = { headers: { authorization: `Bearer ${token}` } };
  let passed = false;
  let res = response();
  await auth.requireAdmin(req, res, () => { passed = true; });
  assert.equal(passed, false); // A signed platform identity is not an admin role.
  assert.equal(res.statusCode, 401);
  identities.set('unit-identity', { open_id: 'unit-identity', email: 'visitor@example.test', display_name: 'Visitor' });
  res = response(); await auth.requireAdmin(req, res, () => { passed = true; });
  assert.equal(passed, false);
  identities.set('unit-identity', { open_id: 'unit-identity', email: 'manager@example.test', display_name: 'Manager' });
  res = response(); await auth.requireAdmin(req, res, () => { passed = true; });
  assert.equal(passed, true);

  const revokedToken = signProjectJwt({ appId: projectId, openId: 'unit-identity', exp: now + 600, jti: 'test-jti' }, secret);
  passed = false; res = response();
  await auth.requireAdmin({ headers: { authorization: `Bearer ${revokedToken}` } }, res, () => { passed = true; });
  assert.equal(passed, false); // Own app sessions require a live DB session.
  sessions.set(hash(revokedToken), 'unit-identity');
  await auth.requireAdmin({ headers: { authorization: `Bearer ${revokedToken}` } }, response(), () => { passed = true; });
  assert.equal(passed, true);
  await auth.logout({ headers: { authorization: `Bearer ${revokedToken}` } }, response());
  assert.equal(sessions.has(hash(revokedToken)), false);

  res = response();
  await auth.start({ headers: { origin: 'https://evil.example.test' }, body: { origin: 'https://evil.example.test' } }, res);
  assert.equal(res.statusCode, 400);
  res = response();
  await auth.start({ headers: { origin }, body: { origin } }, res);
  const start = res.body;
  assert.equal(start.nonce.length, 48);
  assert.match(res.headers['Set-Cookie'], /HttpOnly; Secure; SameSite=None/);
  const state = new URL(start.url).searchParams.get('state');
  assert.equal(JSON.parse(Buffer.from(state, 'base64').toString()).redirectUri, `${origin}/admin/callback`);
  let callback = { headers: { origin }, body: { state, nonce: start.nonce, code: 'unit-code' } };
  res = response(); await auth.complete({ ...callback, body: { ...callback.body, nonce: '0'.repeat(48) } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(states.size, 1);
  res = response(); await auth.complete(callback, res);
  assert.equal(res.statusCode, 400); // A nonce in JSON alone does not establish browser binding.
  assert.equal(states.size, 1);
  res = response(); await auth.complete({ ...callback, headers: { origin, cookie: 'fcms_admin_nonce=' + '0'.repeat(48) } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(states.size, 1);
  callback.headers.cookie = 'fcms_admin_nonce=' + start.nonce;
  globalThis.fetch = async url => {
    exchanges += 1;
    return { ok: true, async json() {
      return url.endsWith('/ExchangeToken') ? { accessToken: 'unit-access-token' }
        : { openId: 'oauth-identity', name: 'Authorized Manager', email: 'manager@example.test' };
    } };
  };
  res = response(); await auth.complete(callback, res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.sessionToken);
  assert.equal(exchanges, 2);
  assert.equal(states.size, 0);
  assert.equal(identities.get('oauth-identity').email, 'manager@example.test');
  res = response(); await auth.complete(callback, res);
  assert.equal(res.statusCode, 400);
  assert.equal(exchanges, 2); // Nonce replay cannot exchange a provider code again.

  res = response();
  await auth.start({ headers: { 'sec-fetch-site': 'same-origin' }, body: { origin } }, res);
  assert.equal(res.statusCode, 200); // Preview proxy Origin rewriting retains same-origin fetch metadata.
  res = response();
  await auth.start({ headers: { 'sec-fetch-site': 'cross-site' }, body: { origin } }, res);
  assert.equal(res.statusCode, 400);

  process.env.ADMIN_EMAIL = '';
  res = response(); await auth.session(req, res);
  assert.equal(res.body.configured, false);
  assert.equal(res.body.authenticated, false);

  const ui = readFileSync(new URL('../public/admin/admin.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../public/admin/index.html', import.meta.url), 'utf8');
  assert.ok(ui.includes('/api/admin/login'));
  assert.ok(ui.includes('sessionStorage') && ui.includes('Bearer'));
  assert.ok(!ui.includes('123456') && !ui.includes('demo-fill') && !ui.includes('localStorage'));
  assert.ok(html.includes('noindex,nofollow,noarchive'));
  assert.ok(ui.includes('USD') && !ui.includes('د.ل'));
  const adminApiSource = readFileSync(new URL('../server/admin-api.js', import.meta.url), 'utf8');
  const adminIndexSource = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  assert.ok(adminApiSource.includes('updateRequestStatus') && adminApiSource.includes('FOR UPDATE'));
  assert.ok(adminApiSource.includes('updateUserAccessStatus') && adminApiSource.includes('access_status'));
  assert.ok(adminApiSource.includes('last_seen_at') && adminApiSource.includes('online_users') && adminApiSource.includes('new_visitors'));
  assert.ok(adminApiSource.includes('Bearer\\s+\\S+'));
  assert.ok(adminIndexSource.includes("app.patch('/api/admin/requests/:id/status'"));
  assert.ok(adminIndexSource.includes("app.patch('/api/admin/users/:id/access-status'"));
  assert.ok(ui.includes('موافقة') && ui.includes('رفض') && ui.includes('موافقة دخول'));
  const client = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const publicUi = readFileSync(new URL('../public/ui.js', import.meta.url), 'utf8');
  assert.ok(client.includes('/api/access-status') && client.includes("navigate('approval')"));
  assert.ok(publicUi.includes('طلبك قيد المراجعة') && publicUi.includes('تم رفض محاولة الدخول'));
  assert.ok(ui.includes('متصل الآن') && ui.includes('زائر جديد'));
  console.log('PASS: admin identity allowlist, project JWT validation, revoked sessions, OAuth nonce binding/replay, fail-closed setup, protected request decisions, and USD units.');
} finally {
  globalThis.fetch = originalFetch;
  for (const key of envKeys) {
    if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key];
  }
}
