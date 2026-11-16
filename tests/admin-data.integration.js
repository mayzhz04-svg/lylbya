import assert from 'node:assert/strict';
import { createPool } from '../server/db.js';
import { createAdminApi } from '../server/admin-api.js';

const pool = createPool();
const api = createAdminApi({ pool });
const capture = () => ({ statusCode: 200, value: null, status(code) { this.statusCode = code; return this; }, json(value) { this.value = value; return this; } });
async function call(handler, query = {}, params = {}) {
  const res = capture();
  await api[handler]({ query, params }, res);
  return res;
}

try {
  const overview = (await call('summary')).value;
  const [[actual]] = await pool.query('SELECT (SELECT COUNT(*) FROM users) users, (SELECT COUNT(*) FROM accounts) accounts, (SELECT COUNT(*) FROM requests) requests');
  assert.equal(overview.users, Number(actual.users));
  assert.equal(overview.accounts, Number(actual.accounts));
  assert.equal(overview.requests, Number(actual.requests));
  const users = (await call('users', { pageSize: '5' })).value;
  assert.equal(users.total, overview.users);
  assert.ok(users.rows.length <= 5);
  assert.ok(users.rows.every(row => /^\d{12}$/.test(row.nationalNumber) && /^\d{10}$/.test(row.phone)));
  const literalSearch = (await call('users', { q: "%' OR 1=1 --" })).value;
  assert.equal(literalSearch.total, 0);
  if (users.rows.length) {
    const details = (await call('user', {}, { id: users.rows[0].id })).value;
    assert.equal(details.user.id, users.rows[0].id);
    assert.match(details.user.nationalNumber, /^\d{12}$/);
  }
  const accounts = (await call('accounts', { pageSize: '5' })).value;
  assert.equal(accounts.total, overview.accounts);
  assert.ok(accounts.rows.every(row => row.iban.includes('••')));
  if (accounts.rows.length) {
    const details = (await call('account', {}, { id: accounts.rows[0].id })).value;
    assert.equal(details.account.id, accounts.rows[0].id);
    assert.match(details.account.iban, /^LY\d{23}$/);
  }
  const requests = (await call('requests', { pageSize: '5' })).value;
  assert.equal(requests.total, overview.requests);
  if (requests.rows.length) {
    const details = (await call('request', {}, { id: requests.rows[0].id })).value;
    assert.equal(details.request.id, requests.rows[0].id);
    assert.ok(Array.isArray(details.request.purposes));
    assert.ok(typeof details.request.consent === 'boolean');
    assert.ok(Number.isFinite(details.request.amount));
  }
  assert.equal((await call('user', {}, { id: '../' })).statusCode, 400);
  assert.equal((await call('requests', { status: 'invalid' })).statusCode, 400);
  assert.equal((await call('requests', { status: 'مقبول' })).statusCode, 200);
  assert.equal((await call('requests', { status: 'مرفوض' })).statusCode, 200);
  console.log(`PASS: admin data queries, real totals (${overview.users} users / ${overview.accounts} accounts / ${overview.requests} requests), masked lists, full authorized details, pagination, parameterized search, decision filters.`);
} finally {
  await pool.end();
}
