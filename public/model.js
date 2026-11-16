export function createState() { return { accounts: [], requests: [], nextAccountId: 1, nextRequestId: 1 }; }

export function normalizeDigits(value) {
  return String(value || '').replace(/[٠-٩]/g, char => String(char.charCodeAt(0) - 1632)).replace(/[۰-۹]/g, char => String(char.charCodeAt(0) - 1776));
}

export function validateLogin(values) {
  if (!/^\d{12}$/.test(normalizeDigits(values.national))) return { field: 'national', message: 'أدخل رقمًا وطنيًا تجريبيًا مكونًا من 12 رقمًا.' };
  if (!/^09\d{8}$/.test(normalizeDigits(values.phone))) return { field: 'phone', message: 'أدخل رقم هاتف تجريبيًا من 10 أرقام يبدأ بـ 09.' };
  return null;
}

export function validateRegistration(values) {
  if (!/^\d{12}$/.test(normalizeDigits(values.national))) return { field: 'national', message: 'أدخل رقمًا وطنيًا تجريبيًا مكونًا من 12 رقمًا.' };
  if (!/^[a-zA-Z0-9]{6,12}$/.test(values.passport)) return { field: 'passport', message: 'أدخل رقم جواز تجريبيًا مكونًا من 6 إلى 12 حرفًا أو رقمًا.' };
  if (!/^09\d{8}$/.test(normalizeDigits(values.phone))) return { field: 'phone', message: 'أدخل رقم هاتف تجريبيًا من 10 أرقام يبدأ بـ 09.' };
  return null;
}

export function addAccount(state, bankId, rawIban) {
  const iban = String(rawIban).replace(/\s/g, '').toUpperCase();
  if (!/^LY\d{23}$/.test(iban)) return { error: 'رقم IBAN يجب أن يبدأ بـ LY وأن يتكون من 25 حرفًا ورقمًا.' };
  if (state.accounts.some(account => account.iban === iban)) return { error: 'هذا الحساب مضاف بالفعل.' };
  const date = new Date();
  const account = {
    id: String(state.nextAccountId++), bankId, iban,
    createdAt: `${date.toLocaleTimeString('en-GB')} ${date.toISOString().slice(0, 10)}`
  };
  state.accounts.push(account);
  return { account };
}

export function addRequest(state, accountId, values) {
  if (!state.accounts.some(account => account.id === accountId)) return { error: 'أضف حسابًا مصرفيًا تجريبيًا أولًا.' };
  if (!values.branch) return { field: 'branch', error: 'اختر الفرع.' };
  if (!values.type) return { field: 'request-type', error: 'اختر نوع الطلب.' };
  const amount = Number(normalizeDigits(values.amount));
  const pending = state.requests.reduce((sum, request) => sum + request.amount, 0);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 4000 - pending) return { field: 'amount', error: 'أدخل قيمة أكبر من صفر ولا تتجاوز القيمة المتاحة.' };
  if (!values.purposes?.length) return { error: 'اختر الغرض من استخدام العملة.' };
  if (!values.consent) return { field: 'consent', error: 'وافق على الشروط لإكمال الطلب التجريبي.' };
  const request = {
    id: String(state.nextRequestId++), accountId, amount,
    branch: values.branch, type: values.type, purposes: values.purposes,
    date: new Date().toLocaleDateString('ar-LY', { day: 'numeric', month: 'long', year: 'numeric' }),
    reference: `FC-${String(state.nextRequestId - 1).padStart(6, '0')}`
  };
  state.requests.push(request);
  return { request };
}
