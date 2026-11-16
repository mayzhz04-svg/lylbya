import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clientIp, headerCountry, countryLabel } from '../server/geo.js';

assert.equal(clientIp({ headers: { 'cf-connecting-ip': '41.202.15.6' }, socket: {} }), '41.202.15.6');
assert.equal(clientIp({ headers: { 'x-forwarded-for': '41.202.15.6, 10.0.0.1' }, socket: {} }), '41.202.15.6');
assert.equal(clientIp({ headers: {}, socket: { remoteAddress: '::ffff:203.0.113.9' } }), '203.0.113.9');

assert.equal(headerCountry({ headers: { 'cf-ipcountry': 'ly' } }), 'LY');
assert.equal(headerCountry({ headers: { 'cf-ipcountry': 'XX' } }), '');
assert.equal(headerCountry({ headers: {} }), '');

assert.equal(countryLabel('LY'), 'ليبيا');
assert.equal(countryLabel('tr'), 'تركيا');
assert.equal(countryLabel('ZZ', 'Zzzandia'), 'Zzzandia');
assert.equal(countryLabel('', ''), '');

const api = readFileSync(new URL('../server/api.js', import.meta.url), 'utf8');
assert.match(api, /resolveLocation/);
assert.match(api, /country_code = COALESCE/, 'دولة الزائر تُحفظ دون مسح قيم سابقة');

const admin = readFileSync(new URL('../public/admin/admin.js', import.meta.url), 'utf8');
assert.match(admin, /function locationLabel/);
assert.match(admin, /<th>الدولة<\/th>/);

console.log('PASS: visitor country detection, Arabic labels, and admin display wiring.');
