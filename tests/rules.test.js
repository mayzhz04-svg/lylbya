import assert from 'node:assert/strict';
import {
  validateLogin, validateRegistration, validateIban, validateRequest, normalizeDigits,
  referenceFor, maskPhone, maskNational, maskPassport, cookieOptions, AVAILABLE_LIMIT,
  generateOtp, otpExpiry, OTP_TTL_MINUTES, RESEND_COOLDOWN_SECONDS } from '../server/rules.js';

assert.deepEqual(validateLogin({ national: '119900000001', phone: '٠٩١٢٠٠٠٠٠٠' }), { national: '119900000001', phone: '0912000000' });
assert.equal(validateLogin({ national: '1199000', phone: '0912000000' }).field, 'national');
assert.equal(validateLogin({ national: '119900000001', phone: '0812000000' }).field, 'phone');
assert.equal(validateRegistration({ national: '119900000001', passport: 'demo1234', phone: '0912000000' }).passport, 'DEMO1234');
assert.equal(validateRegistration({ national: '119900000001', passport: 'ab', phone: '0912000000' }).field, 'passport');
assert.equal(validateIban(' ly23 00100000000000000000000 ').iban, 'LY23001000000000000000000');
assert.equal(validateIban('LY123').field, 'iban');

const values = { branch: 'فرع المصاية', type: 'بطاقة', amount: '500', purposes: ['السياحة الشخصية'], consent: true };
assert.deepEqual(validateRequest(values, AVAILABLE_LIMIT).amount, 500);
assert.equal(validateRequest({ ...values, amount: '4500' }, AVAILABLE_LIMIT).field, 'amount');
assert.equal(validateRequest({ ...values, amount: '٥٠٠' }, AVAILABLE_LIMIT).amount, 500);
assert.equal(validateRequest({ ...values, branch: 'فرع وهمي' }, AVAILABLE_LIMIT).field, 'branch');
assert.equal(validateRequest({ ...values, type: 'شيك' }, AVAILABLE_LIMIT).field, 'request-type');
assert.equal(validateRequest({ ...values, purposes: [] }, AVAILABLE_LIMIT).field, 'purpose');
assert.equal(validateRequest({ ...values, purposes: ['غرض غير متاح'] }, AVAILABLE_LIMIT).field, 'purpose');
assert.equal(validateRequest({ ...values, consent: false }, AVAILABLE_LIMIT).field, 'consent');

assert.equal(referenceFor(7), 'FC-000007');
assert.equal(normalizeDigits('۱۲۳'), '123');
assert.equal(maskPhone('0912000000'), '0912••••••');
assert.equal(maskNational('119900000001'), '1199••••••••');
assert.equal(maskPassport('DEMO1234'), 'DEMO••••');
assert.match(cookieOptions(60), /HttpOnly; SameSite=None; Secure; Path=\/; Max-Age=60/);

console.log('PASS: server validation rules, digit normalization, masked display values, secure cross-site cookie options.');

// دورة الرمز المُرسَل للزائر
assert.match(generateOtp(), /^\d{6}$/, 'الرمز يتكون من 6 أرقام');
assert.notEqual(generateOtp(), generateOtp(), 'الرموز لا تتكرر');
assert.ok(otpExpiry(OTP_TTL_MINUTES).getTime() - Date.now() > OTP_TTL_MINUTES * 60000 - 5000, 'صلاحية الرمز عشر دقائق');
assert.equal(RESEND_COOLDOWN_SECONDS, 30, 'فترة انتظار إعادة الإرسال 30 ثانية');
