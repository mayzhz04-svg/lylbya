import { randomInt } from 'node:crypto';

export const BRANCHES = ['فرع المصاية', 'فرع طرابلس', 'فرع بنغازي', 'الفرع الرئيسي'];
export const REQUEST_TYPES = ['بطاقة', 'حوالة', 'نقدي'];
export const PURPOSES = ['السياحة الشخصية', 'سياحة الأعمال', 'السياحة بغرض الدراسة', 'الحج والعمرة', 'السياحة الطبية', 'شراء سلع'];
export const DEMO_OTP = '123456';
export const OTP_TTL_MINUTES = 10;
export const RESEND_COOLDOWN_SECONDS = 30;
export const AVAILABLE_LIMIT = 4000;
export const SESSION_COOKIE = 'fcms_session';
export const PENDING_COOKIE = 'fcms_pending';
export const SESSION_DAYS = 30;

export function normalizeDigits(value) {
  return String(value ?? '')
    .replace(/[\u06f0-\u06f9]/g, char => String(char.charCodeAt(0) - 1776))
    .replace(/[\u0660-\u0669]/g, char => String(char.charCodeAt(0) - 1632));
}

export function trim(value, max = 40) {
  return String(value ?? '').trim().slice(0, max);
}

export function upper(value) {
  return trim(value, 25).toUpperCase();
}

export function validateLogin(values) {
  const national = normalizeDigits(values.national).replace(/\D/g, '');
  const phone = normalizeDigits(values.phone).replace(/\D/g, '');
  if (!/^\d{12}$/.test(national)) return { field: 'national', message: 'أدخل رقمًا وطنيًا مكونًا من 12 رقمًا.' };
  if (!/^09\d{8}$/.test(phone)) return { field: 'phone', message: 'أدخل رقم هاتف من 10 أرقام يبدأ بـ 09.' };
  return { national, phone };
}

export function validateRegistration(values) {
  const base = validateLogin(values);
  if (base.field) return base;
  const passport = trim(values.passport).toUpperCase();
  if (!/^[A-Z0-9]{6,12}$/.test(passport)) return { field: 'passport', message: 'أدخل رقم جواز سفر مكونًا من 6 إلى 12 حرفًا أو رقمًا.' };
  return { ...base, passport };
}

export function validateIban(value) {
  const iban = String(value ?? '').replace(/\s/g, '').toUpperCase().slice(0, 25);
  if (!/^LY\d{23}$/.test(iban)) return { field: 'iban', message: 'رقم IBAN يجب أن يبدأ بـ LY وأن يتكون من 25 خانة.' };
  return { iban };
}

export function validateRequest(values, availableLimit) {
  const branch = trim(values.branch, 40);
  if (!BRANCHES.includes(branch)) return { field: 'branch', message: 'اختر الفرع.' };
  const type = trim(values.type, 20);
  if (!REQUEST_TYPES.includes(type)) return { field: 'request-type', message: 'اختر نوع الطلب.' };
  const amount = Number(normalizeDigits(values.amount));
  if (!Number.isFinite(amount) || amount <= 0) return { field: 'amount', message: 'أدخل قيمة أكبر من صفر.' };
  const cents = Math.round(amount * 100);
  if (cents > Math.round(availableLimit * 100)) return { field: 'amount', message: 'القيمة تتجاوز المتاح من سقف الحجز.' };
  const purposes = Array.isArray(values.purposes) ? values.purposes.map(item => trim(item, 40)) : [];
  if (!purposes.length) return { field: 'purpose', message: 'اختر الغرض من استخدام العملة.' };
  if (purposes.some(item => !PURPOSES.includes(item))) return { field: 'purpose', message: 'أحد الأغراض غير متاح.' };
  if (!values.consent) return { field: 'consent', message: 'وافق على الشروط لإكمال الطلب.' };
  return { branch, type, amount: cents / 100, purposes: [...new Set(purposes)], consent: true };
}

export function referenceFor(id) {
  return `FC-${String(id).padStart(6, '0')}`;
}

export function maskPhone(phone) {
  return `${phone.slice(0, 4)}••••••`;
}

export function maskNational(national) {
  return `${national.slice(0, 4)}••••••••`;
}

export function maskPassport(passport) {
  return `${passport.slice(0, 4)}••••`;
}

export function cookieOptions(maxAgeSeconds) {
  return `HttpOnly; SameSite=None; Secure; Path=/; Max-Age=${maxAgeSeconds}`;
}

export function generateOtp() {
  return String(randomInt(100000, 1000000));
}

export function otpExpiry(minutes = OTP_TTL_MINUTES) {
  return new Date(Date.now() + minutes * 60000);
}
