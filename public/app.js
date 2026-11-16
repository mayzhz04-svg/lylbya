import { demo } from './data.js';
import * as ui from './ui.js?v=db-ui-17';
import { login } from './login.js?v=db-ui-17';
import { normalizeDigits, validateLogin, validateRegistration } from './model.js?v=db-ui-17';

const auth = document.getElementById('auth');
const workspace = document.getElementById('workspace');
const page = document.getElementById('page');
const toast = document.getElementById('toast');
const demoFill = document.getElementById('demo-fill');
const demoCode = document.getElementById('demo-code');

let session = null;
let banks = [];
let currentRoute = 'login';
let verificationTimer;
let toastTimer;
let verificationReady = false;
let resendUntil = 0;
let resendTimer;
let approvalTimer;
let presenceTimer;
let approvalState = 'pending';
let busy = false;
let pendingToken = null;
let delivery = readStoredDelivery();
let sessionToken = null;

// المعاينة تُفتح داخل إطار وقد يحجب المتصفح الكوكيز، فيُحفظ رمز الجلسة في تخزين التبويب فقط.
const store = {
  read(key) { try { return sessionStorage.getItem(key); } catch { return null; } },
  write(key, value) { try { sessionStorage.setItem(key, value); } catch { /* التخزين محجوب */ } },
  clear(key) { try { sessionStorage.removeItem(key); } catch { /* لا شيء */ } }
};
pendingToken = store.read('fcms_pending_token');
sessionToken = store.read('fcms_session_token');

const PROTECTED = ['dashboard', 'accounts', 'banks', 'add-account', 'account', 'new-request', 'request'];
const AUTH_ROUTES = ['login', 'register', 'approval', 'verify'];

async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`;
  const response = await fetch(path, {
    method,
    credentials: 'include',
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  let data = {};
  try { data = await response.json(); } catch { /* non-JSON failure */ }
  if (!response.ok) {
    const failure = new Error(data?.error?.message || 'تعذر الاتصال بقاعدة البيانات.');
    failure.field = data?.error?.field;
    failure.status = response.status;
    throw failure;
  }
  return data;
}

function sendPresence(offline = false) {
  if (!pendingToken && !sessionToken) return;
  const headers = { 'Content-Type': 'application/json' };
  if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`;
  fetch('/api/presence', {
    method: 'POST', credentials: 'include', keepalive: true, headers,
    body: JSON.stringify({ pendingToken, sessionToken, offline })
  }).catch(() => {});
}

function syncPresence() {
  if (!pendingToken && !sessionToken) {
    clearInterval(presenceTimer);
    presenceTimer = null;
    return;
  }
  if (document.visibilityState === 'hidden') return;
  if (!presenceTimer) {
    sendPresence();
    presenceTimer = setInterval(() => sendPresence(), 15000);
  }
}

function navigate(route) {
  if (location.hash.slice(1) === route) render();
  else location.hash = route;
}

async function loadSession() {
  session = await api('/api/session');
}

function currentAccount(id) {
  return session?.accounts?.find(account => String(account.id) === String(id));
}

async function ensureBanks() {
  if (!banks.length) banks = (await api('/api/banks')).banks;
  return banks;
}

let rendering = false;
let queuedRender = false;

// قد تبدأ عدة رسوم بسبب التنقل داخل render نفسه؛ ننفذ واحدًا ونعيد الآخر بعد انتهائه.

function readStoredDelivery() {
  try {
    const raw = sessionStorage.getItem('fcms_delivery');
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed?.code || !parsed.expiresAt || Number(parsed.expiresAt) < Date.now()) return null;
    return { code: parsed.code, phone: parsed.phone || '', expiresIn: Math.round((Number(parsed.expiresAt) - Date.now()) / 1000) };
  } catch { return null; }
}

function rememberDelivery(value) {
  delivery = value ? { ...value, expiresAt: Date.now() + (value.expiresIn || 600) * 1000 } : null;
  try {
    if (delivery) sessionStorage.setItem('fcms_delivery', JSON.stringify(delivery));
    else sessionStorage.removeItem('fcms_delivery');
  } catch { /* التخزين داخل التبويب فقط */ }
}

async function render() {
  if (rendering) { queuedRender = true; return; }
  rendering = true;
  try { await renderOnce(); }
  finally {
    rendering = false;
    if (queuedRender) { queuedRender = false; render(); }
  }
}

async function renderOnce() {
  clearTimeout(verificationTimer);
  clearInterval(resendTimer);
  clearTimeout(approvalTimer);
  resendTimer = null;
  verificationReady = false;
  const [route = 'login', rawId = ''] = location.hash.slice(1).split('/');
  const id = decodeURIComponent(rawId);
  currentRoute = route || 'login';

  if (PROTECTED.includes(currentRoute) && !session) {
    try { await loadSession(); }
    catch (cause) {
      session = null;
      if (cause.status === 401) {
        sessionToken = null; pendingToken = null;
        store.clear('fcms_session_token'); store.clear('fcms_pending_token');
      } else {
        showError('تعذر الاتصال', cause.message);
      }
      navigate('login'); return;
    }
  }
  if (!session && sessionToken) {
    try { await loadSession(); }
    catch { sessionToken = null; pendingToken = null; store.clear('fcms_session_token'); store.clear('fcms_pending_token'); }
  }
  if (!session && pendingToken && ['login', 'register'].includes(currentRoute)) currentRoute = 'approval';
  if (!session && currentRoute === 'approval' && !pendingToken) { navigate('login'); return; }
  if (!session && pendingToken && currentRoute === 'verify') {
    try {
      const approval = await api('/api/access-status', { method: 'POST', body: { pendingToken } });
      if (approval.status !== 'approved') { approvalState = approval.status === 'rejected' ? 'rejected' : 'pending'; navigate('approval'); return; }
      rememberDelivery({ code: approval.code || '', phone: approval.phone || '', expiresIn: approval.expiresIn || 600 });
    } catch { pendingToken = null; store.clear('fcms_pending_token'); navigate('login'); return; }
  }
  if (AUTH_ROUTES.includes(currentRoute) && session) { navigate('dashboard'); return; }
  if (PROTECTED.includes(currentRoute) && !session) { navigate('login'); return; }

  document.body.classList.toggle('login-mode', currentRoute === 'login');
  document.querySelector('meta[name="theme-color"]').content = currentRoute === 'login' ? '#ffffff' : '#6d68a4';
  const isAuth = AUTH_ROUTES.includes(currentRoute);
  auth.hidden = !isAuth;
  workspace.hidden = isAuth;
  demoFill.hidden = !['login', 'register', 'verify', 'add-account', 'new-request'].includes(currentRoute);
  if (demoCode) demoCode.hidden = currentRoute !== 'verify';
  document.querySelectorAll('[data-route]').forEach(link => {
    const active = currentRoute === 'dashboard' ? link.dataset.route === 'dashboard' : link.dataset.route === 'accounts';
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });

  try {
    if (currentRoute === 'login') auth.innerHTML = login();
    else if (currentRoute === 'register') auth.innerHTML = ui.registration();
    else if (currentRoute === 'approval') auth.innerHTML = ui.approvalWaiting(approvalState);
    else if (currentRoute === 'verify') auth.innerHTML = ui.otp(delivery);
    else if (currentRoute === 'dashboard') page.innerHTML = ui.dashboard(session, session.user);
    else if (currentRoute === 'accounts') page.innerHTML = ui.accounts(session);
    else if (currentRoute === 'banks') {
      page.innerHTML = ui.bankList(await ensureBanks());
    } else if (currentRoute === 'add-account') {
      const list = await ensureBanks();
      const bank = list.find(item => item.id === id);
      if (!bank) { navigate('banks'); return; }
      page.innerHTML = ui.addAccount(bank.id, bank.ar);
    } else if (currentRoute === 'account') {
      const data = await api(`/api/accounts/${encodeURIComponent(id)}`);
      const state = { requests: data.requests, accounts: session.accounts };
      page.innerHTML = ui.accountDetails(data.account, state);
    } else if (currentRoute === 'new-request') {
      const account = currentAccount(id);
      if (!account) { navigate('accounts'); return; }
      page.innerHTML = ui.requestForm(account, { ...session.options, limit: session.limit });
      const amount = document.getElementById('amount');
      amount.min = '1';
      amount.max = String(session.limit);
      amount.step = '0.01';
    } else if (currentRoute === 'request') {
      const data = await api(`/api/requests/${encodeURIComponent(id)}`);
      page.innerHTML = ui.requestDetails(data.request, data.account, { requests: [data.request] });
    } else { navigate('login'); return; }
  } catch (cause) {
    if (cause.status === 401) { session = null; navigate('login'); return; }
    page.innerHTML = ui.accounts(session || { accounts: [], requests: [] });
    showError('تعذر التحميل', cause.message);
    return;
  }

  page.scrollTop = 0;
  syncPresence();
  document.title = 'منصة حجز العملة الأجنبية للأفراد';
  if (currentRoute !== 'login' && document.querySelector('.verification')) verificationTimer = setTimeout(completeVerification, 650);
  if (currentRoute === 'verify') {
    updateResend();
    const otpInput = document.getElementById('otp');
    if (otpInput && delivery?.code && !otpInput.value) otpInput.value = delivery.code;
  }
  if (currentRoute === 'approval' && approvalState === 'pending') startApprovalPolling();
}

function startApprovalPolling() {
  clearTimeout(approvalTimer);
  approvalTimer = setTimeout(checkApproval, 3000);
}

async function checkApproval() {
  if (currentRoute !== 'approval' || !pendingToken || approvalState !== 'pending') return;
  try {
    const result = await api('/api/access-status', { method: 'POST', body: { pendingToken } });
    if (result.status === 'approved') {
      rememberDelivery({ code: result.code || '', phone: result.phone || '', expiresIn: result.expiresIn || 600 });
      approvalState = 'pending';
      currentRoute = 'verify';
      document.body.classList.remove('login-mode');
      document.querySelector('meta[name="theme-color"]').content = '#6d68a4';
      auth.innerHTML = ui.otp(delivery);
      completeVerification();
      updateResend();
      const otpInput = document.getElementById('otp');
      if (otpInput) { otpInput.value = delivery?.code || ''; otpInput.focus(); }
      return;
    }
    if (result.status === 'rejected') { approvalState = 'rejected'; auth.innerHTML = ui.approvalWaiting('rejected'); return; }
    startApprovalPolling();
  } catch (cause) {
    if (cause.status === 401) {
      pendingToken = null; store.clear('fcms_pending_token'); navigate('login'); return;
    }
    startApprovalPolling();
  }
}

function completeVerification() {
  verificationReady = true;
  document.querySelectorAll('.verification').forEach(element => {
    element.classList.add('verified');
    element.querySelector('.verification-text').textContent = 'تم بنجاح!';
    element.setAttribute('aria-label', 'اكتمل التحقق التجريبي، ليس تحققًا مصرفيًا');
  });
}

function showToast(title, message, isError = false) {
  clearTimeout(toastTimer);
  toast.classList.toggle('error', isError);
  toast.innerHTML = `<button type="button" data-action="close-toast" aria-label="إغلاق الإشعار">×</button><div class="toast-line"><span class="toast-status">${isError ? '!' : '✓'}</span><span>${escape(title)}</span></div><p>${escape(message)}</p>`;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 5500);
}

function escape(value) {
  return String(value ?? '').replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
}

function showError(message, fieldId) {
  showToast('تعذر إكمال العملية', message, true);
  const field = fieldId && document.getElementById(fieldId);
  if (field) { field.classList.add('invalid'); field.focus(); }
}

function requireVerification() {
  // الشريط التجريبي لا يمنع المستخدم بعد الآن: يُكمل تلقائيًا عند الإرسال.
  if (!verificationReady) completeVerification();
  return true;
}

function updateResend() {
  const button = document.getElementById('resend');
  if (!button) return;
  const seconds = Math.max(0, Math.ceil((resendUntil - Date.now()) / 1000));
  button.disabled = seconds > 0;
  button.textContent = seconds ? `إعادة إرسال رمز التأكيد (${seconds})` : 'إعادة إرسال رمز التأكيد';
  if (seconds > 0 && !resendTimer) resendTimer = setInterval(updateResend, 1000);
  if (seconds === 0) { clearInterval(resendTimer); resendTimer = null; }
}

function fillDemo() {
  const fill = (id, value) => { const field = document.getElementById(id); if (field) { field.value = value; field.classList.remove('invalid'); } };
  const digits = count => String(Math.floor(Math.random() * 10 ** count)).padStart(count, '0');
  if (currentRoute === 'login') {
    fill('national', demo.national); fill('phone', demo.phone);
  } else if (currentRoute === 'register') {
    // الرقم التجريبي الثابت مستخدم فعلًا في القاعدة، فكل تعبئة تولّد هوية تجريبية جديدة.
    fill('national', `11${digits(10)}`); fill('passport', `AB${digits(6)}`); fill('phone', `09${digits(8)}`);
  } else if (currentRoute === 'verify') fill('otp', delivery?.code || '');
  else if (currentRoute === 'add-account') fill('iban', demo.iban);
  else if (currentRoute === 'new-request') {
    fill('branch', 'فرع المصاية'); fill('request-type', 'بطاقة'); fill('amount', '500');
    document.getElementById('purpose-0').checked = true;
    document.getElementById('consent').checked = true;
  }
  completeVerification();
}

document.addEventListener('input', event => {
  event.target.classList?.remove('invalid');
  if (['national', 'phone', 'otp'].includes(event.target.id)) event.target.value = normalizeDigits(event.target.value).replace(/\D/g, '');
  if (currentRoute === 'login' && document.getElementById('national')?.value && document.getElementById('phone')?.value && !verificationReady) {
    clearTimeout(verificationTimer);
    verificationTimer = setTimeout(completeVerification, 650);
  }
});

document.addEventListener('click', async event => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'verify') completeVerification();
  if (action === 'check-approval') checkApproval();
  if (action === 'close-toast') toast.hidden = true;
  if (action === 'terms') document.getElementById('terms-dialog').showModal();
  if (action === 'close-terms') document.getElementById('terms-dialog').close();
  if (action === 'logout') {
    clearTimeout(toastTimer); toast.hidden = true;
    sendPresence(true);
    clearInterval(presenceTimer); presenceTimer = null;
    resendUntil = 0;
    api('/api/logout', { method: 'POST' }).catch(() => {});
    session = null;
    approvalState = 'pending';
    banks = [];
    sessionToken = null;
    pendingToken = null;
    rememberDelivery(null);
    store.clear('fcms_session_token');
    store.clear('fcms_pending_token');
    auth.innerHTML = ''; page.innerHTML = ''; navigate('login');
  }
  if (action === 'resend') {
    if (Date.now() < resendUntil) return;
    try {
      const issued = await api('/api/resend', { method: 'POST', body: { pendingToken } });
      rememberDelivery({ code: issued.code, phone: issued.phone || '', expiresIn: issued.expiresIn || 600 });
      auth.innerHTML = ui.otp(delivery);
      const otpInput = document.getElementById('otp');
      if (otpInput) otpInput.value = delivery.code || '';
      updateResend();
    } catch (cause) {
      showError(cause.message || 'تعذر إرسال الرمز الآن.');
    }
    resendUntil = Date.now() + 30000;
    updateResend();
  }
});

document.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target;
  if (busy) return;
  if (!requireVerification()) return;
  busy = true;
  const submitButton = form.querySelector('button[type="submit"]');
  const originalLabel = submitButton?.innerHTML;
  if (submitButton) { submitButton.disabled = true; submitButton.textContent = 'جارٍ الحفظ…'; }

  try {
    if (form.id === 'login-form') {
      const values = { national: normalizeDigits(form.elements.national.value), phone: normalizeDigits(form.elements.phone.value) };
      const clientError = validateLogin(values);
      if (clientError) { showError(clientError.message, clientError.field); return; }
      const result = await api('/api/login', { method: 'POST', body: values });
      pendingToken = result.pendingToken || pendingToken;
      if (pendingToken) store.write('fcms_pending_token', pendingToken);
      approvalState = 'pending'; form.reset();
      // نبقي الزائر داخل نفس الشاشة، ونبدّل محتواها فقط إلى حالة الانتظار.
      currentRoute = 'approval';
      document.body.classList.remove('login-mode');
      document.querySelector('meta[name="theme-color"]').content = '#6d68a4';
      auth.innerHTML = ui.approvalWaiting(approvalState);
      startApprovalPolling();
    } else if (form.id === 'register-form') {
      const values = { national: normalizeDigits(form.elements.national.value), passport: form.elements.passport.value.trim().toUpperCase(), phone: normalizeDigits(form.elements.phone.value) };
      const clientError = validateRegistration(values);
      if (clientError) { showError(clientError.message, clientError.field); return; }
      const result = await api('/api/register', { method: 'POST', body: values });
      pendingToken = result.pendingToken || pendingToken;
      if (pendingToken) store.write('fcms_pending_token', pendingToken);
      approvalState = 'pending';
      rememberDelivery(null); form.reset();
      // لا نغيّر الصفحة: نعرض الانتظار في نفس مكان نموذج التسجيل.
      currentRoute = 'approval';
      document.body.classList.remove('login-mode');
      document.querySelector('meta[name="theme-color"]').content = '#6d68a4';
      auth.innerHTML = ui.approvalWaiting(approvalState);
      startApprovalPolling();
    } else if (form.id === 'otp-form') {
      const code = normalizeDigits(form.elements.otp.value);
      if (!/^\d+$/.test(code)) { showError('أدخل أي رقم للمتابعة.', 'otp'); return; }
      const verified = await api('/api/verify', { method: 'POST', body: { code, pendingToken } });
      sessionToken = verified.sessionToken || sessionToken;
      pendingToken = null;
      rememberDelivery(null);
      store.clear('fcms_pending_token');
      if (sessionToken) store.write('fcms_session_token', sessionToken);
      form.reset();
      await loadSession();
      navigate('dashboard');
    } else if (form.id === 'account-form') {
      const iban = form.elements.iban.value.replace(/\s/g, '').toUpperCase();
      await api('/api/accounts', { method: 'POST', body: { bankCode: form.dataset.bank, iban } });
      await loadSession();
      const account = session.accounts[session.accounts.length - 1];
      form.reset();
      navigate(`account/${account.id}`);
      showToast('نجحت العملية!', 'تم حفظ الحساب في قاعدة بيانات النموذج.');
    } else if (form.id === 'request-form') {
      const body = {
        branch: form.elements.branch.value,
        type: form.elements['request-type'].value,
        amount: form.elements.amount.value,
        purposes: [...form.querySelectorAll('input[name="purpose"]:checked')].map(input => input.value),
        consent: form.elements.consent.checked
      };
      const accountId = form.dataset.account;
      await api(`/api/accounts/${encodeURIComponent(accountId)}/requests`, { method: 'POST', body });
      await loadSession();
      navigate(`account/${accountId}`);
      showToast('نجحت العملية!', 'تم حفظ طلب حجز العملة وإرساله للسجل التجريبي.');
    }
  } catch (cause) {
    if (cause.field) showError(cause.message, cause.field);
    else showError(cause.message || 'تعذر حفظ البيانات.');
    if (cause.status === 401 && form.id === 'otp-form') {
      pendingToken = null;
      store.clear('fcms_pending_token');
      navigate('login');
    }
    if (cause.status === 403 && form.id === 'otp-form') {
      approvalState = cause.message.includes('رفض') ? 'rejected' : 'pending';
      navigate('approval');
    }
  } finally {
    busy = false;
    if (submitButton) { submitButton.disabled = false; submitButton.innerHTML = originalLabel; }
  }
});

demoFill.addEventListener('click', fillDemo);
window.addEventListener('hashchange', render);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') sendPresence(true);
  else syncPresence();
});
window.addEventListener('pagehide', () => sendPresence(true));
render();
