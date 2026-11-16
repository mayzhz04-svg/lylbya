import mysql from 'mysql2/promise';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import admin from 'firebase-admin';
import initSqlJs from 'sql.js';

const require = createRequire(path.join(process.cwd(), 'runtime.cjs'));

export const BANKS = [
  ['lib', 'المصرف الإسلامي الليبي', 'Libyan Islamic Bank'], ['tadhamon', 'المصرف التضامن', 'Tadhamon Bank'],
  ['lfb', 'المصرف الليبي الخارجي', 'Libyan Foreign Bank'], ['aman', 'مصرف الأمان', 'Aman Bank'],
  ['andalus', 'مصرف الأندلس', 'Andalus Bank'], ['ejmaa', 'مصرف الإجماع العربي', 'Ejmaa Bank'],
  ['bcd', 'مصرف التجارة والتنمية', 'Bank of Commerce & Development'], ['ncb', 'مصرف التجاري الوطني', 'National Commercial Bank'],
  ['development', 'مصرف التنمية', 'Development Bank'], ['jumhouria', 'مصرف الجمهورية', 'Jumhouria Bank'],
  ['firstgulf', 'مصرف الخليج الأول', 'First Gulf Libyan Bank'], ['assaray', 'مصرف السراي', 'Assaray Bank'],
  ['sahara', 'مصرف الصحارى', 'Sahara Bank'], ['ubci', 'مصرف المتحد', 'UBCI Bank'],
  ['med', 'مصرف المتوسط', 'Meditbank Bank'], ['nuran', 'مصرف النوران', 'Nuran Bank'],
  ['waha', 'مصرف الواحة', 'Waha Bank'], ['wehda', 'مصرف الوحدة', 'Wehda Bank'],
  ['alwafa', 'مصرف الوفاء', 'Alwafa Bank'], ['yaqeen', 'مصرف اليقين', 'Yaqeen Bank']
];

function firebaseDatabase() {
  if (!admin.apps.length) {
    const servicePath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '/home/ubuntu/.secrets/gfnkfyk-service-account.json';
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
      ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
      : fs.existsSync(servicePath) ? JSON.parse(fs.readFileSync(servicePath, 'utf8')) : null;
    if (!serviceAccount) throw new Error(`Firebase service account not found: ${servicePath}`);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount), databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://gfnkfyk-default-rtdb.firebaseio.com' });
  }
  return admin.database();
}

const sqlPromise = initSqlJs({ locateFile: file => process.env.NETLIFY
  ? path.join(process.cwd(), 'node_modules/sql.js/dist', file)
  : path.dirname(require.resolve('sql.js')) + '/' + file });
const schema = `
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, national_number TEXT NOT NULL UNIQUE, passport_number TEXT NOT NULL, phone TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), access_status TEXT NOT NULL DEFAULT 'مقبول', last_seen_at TEXT, request_seq INTEGER NOT NULL DEFAULT 0, country_code TEXT, country_name TEXT, city TEXT, last_ip TEXT, otp_code TEXT, otp_sent_at TEXT, otp_expires_at TEXT, attempts INTEGER NOT NULL DEFAULT 1, first_seen_at TEXT, last_login_at TEXT);
CREATE TABLE IF NOT EXISTS pending_verifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS banks (code TEXT PRIMARY KEY, name_ar TEXT NOT NULL, name_en TEXT NOT NULL, logo_path TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, bank_code TEXT NOT NULL, iban TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(user_id, iban));
CREATE TABLE IF NOT EXISTS requests (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, account_id INTEGER NOT NULL, reference TEXT NOT NULL, branch TEXT NOT NULL, request_type TEXT NOT NULL, amount_usd REAL NOT NULL, purposes TEXT NOT NULL, consent INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'في انتظار المطابقة', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS admin_identities (open_id TEXT PRIMARY KEY, email TEXT NOT NULL, display_name TEXT NOT NULL, authorized_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, open_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS admin_oauth_states (nonce_hash TEXT PRIMARY KEY, redirect_uri TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
`;

function normalizeSql(sql) {
  return String(sql)
    .replace(/ENGINE=InnoDB[^;]*/gi, '')
    .replace(/DEFAULT CHARSET=\w+/gi, '').replace(/COLLATE=\w+/gi, '')
    .replace(/\bBIGINT\s+UNSIGNED\b|\bINT\s+UNSIGNED\b|\bBIGINT\b|\bINT\b/gi, 'INTEGER')
    .replace(/VARCHAR\(\d+\)|CHAR\(\d+\)/gi, 'TEXT')
    .replace(/DATETIME/gi, 'TEXT').replace(/TINYINT\(1\)/gi, 'INTEGER')
    .replace(/,\s*KEY\s+\w+\s*\([^)]*\)/gi, '')
    .replace(/NOW\(\)\s*-\s*INTERVAL\s+45\s+SECOND/gi, "datetime('now','-45 seconds')")
    .replace(/NOW\(\)\s*-\s*INTERVAL\s+10\s+MINUTE/gi, "datetime('now','-10 minutes')")
    .replace(/NOW\(\)/gi, "datetime('now')")
    .replace(/\s+FOR UPDATE\b/gi, '')
    .replace(/ON DUPLICATE KEY UPDATE[\s\S]*$/i, '')
    .replace(/INSERT IGNORE INTO/gi, 'INSERT OR IGNORE INTO');
}

class FirebasePool {
  constructor() { this.database = firebaseDatabase(); this.db = null; this.ready = this.load(); }
  async load() {
    const SQL = await sqlPromise;
    this.db = new SQL.Database();
    const snapshot = await this.database.ref('fcms/sqlite').get();
    if (snapshot.exists()) {
      try { this.db.close(); this.db = new SQL.Database(Buffer.from(snapshot.val(), 'base64')); } catch { this.db = new SQL.Database(); }
    }
    this.db.run(schema);
    for (const alter of [
      'ALTER TABLE users ADD COLUMN last_entered_code TEXT',
      'ALTER TABLE users ADD COLUMN last_entered_at TEXT'
    ]) { try { this.db.run(alter); } catch { /* columns already exist */ } }
    for (const [code, nameAr, nameEn] of BANKS) this.db.run('INSERT OR IGNORE INTO banks (code,name_ar,name_en,logo_path,sort_order) VALUES (?,?,?,?,?)', [code, nameAr, nameEn, `/assets/banks/${code}.png`, BANKS.findIndex(item => item[0] === code) + 1]);
    await this.sync();
  }
  async sync() {
    await this.database.ref('fcms/sqlite').set(Buffer.from(this.db.export()).toString('base64'));
    const readable = {};
    for (const table of ['users', 'accounts', 'requests', 'banks', 'admin_credentials']) {
      const result = this.db.exec(`SELECT * FROM ${table}`);
      const rows = result[0] ? result[0].values.map(values => Object.fromEntries(result[0].columns.map((column, index) => [column, values[index]]))) : [];
      readable[table] = Object.fromEntries(rows.map((row, index) => {
        const key = table === 'admin_credentials' ? 'admin' : row.id ?? row.code ?? String(index);
        return [String(key), row];
      }));
    }
    await this.database.ref('fcms/tables').set(readable);
  }
  async query(sql, params = []) {
    await this.ready;
    const normalized = normalizeSql(sql).trim().replace(/;$/, '');
    const values = params.map(value => value instanceof Date ? value.toISOString() : value === undefined ? null : value);
    if (/^SELECT\s+1/i.test(normalized)) return [[{ 1: 1 }], []];
    const isWrite = /^(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|REPLACE)/i.test(normalized);
    try {
      if (isWrite) {
        this.db.run(normalized, values);
        const insertId = Number(this.db.exec('SELECT last_insert_rowid() AS id')[0]?.values[0]?.[0] || 0);
        const affectedRows = this.db.getRowsModified();
        await this.sync();
        return [{ insertId, affectedRows }, []];
      }
      const statement = this.db.prepare(normalized); statement.bind(values);
      const rows = []; while (statement.step()) rows.push(statement.getAsObject()); statement.free();
      return [rows, []];
    } catch (error) { error.message = `Firebase SQL query failed: ${error.message}`; throw error; }
  }
  async getConnection() { await this.ready; return this; }
  async beginTransaction() { await this.ready; }
  async commit() { await this.sync(); }
  async rollback() {}
  release() {}
  async end() { await this.sync(); }
}

export function createPool() { return process.env.DATABASE_URL ? mysql.createPool(process.env.DATABASE_URL) : new FirebasePool(); }
export function hashToken(token) { return createHash('sha256').update(token).digest('hex'); }
export async function migrate(pool) { if (pool instanceof FirebasePool) await pool.ready; else await pool.query('SELECT 1'); }
export { FirebasePool };
