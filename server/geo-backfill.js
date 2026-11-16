// أداة صيانة: يعيد تحديد دولة الزوار الذين لم تُسجل دولتهم، من آخر عنوان اتصال معروف.
import mysql from 'mysql2/promise';
import { resolveLocation } from './geo.js';

const pool = mysql.createPool(process.env.DATABASE_URL);
const [rows] = await pool.query('SELECT id, last_ip FROM users WHERE country_code IS NULL AND last_ip IS NOT NULL');
let refreshed = 0;

for (const row of rows) {
  const location = await resolveLocation({ headers: { 'x-forwarded-for': row.last_ip }, socket: {} });
  if (!location.code) continue;
  await pool.query('UPDATE users SET country_code = ?, country_name = ?, city = ? WHERE id = ?', [location.code, location.name || null, location.city || null, row.id]);
  refreshed += 1;
}

const [missing] = await pool.query('SELECT COUNT(*) count FROM users WHERE country_code IS NULL');
console.log(JSON.stringify({ considered: rows.length, refreshed, stillUnknown: Number(missing[0].count) }));
await pool.end();
