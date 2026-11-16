import { banks as fallbackBanks, purposes as fallbackPurposes, icon, escapeHTML as e } from './data.js';

const FALLBACK_OPTIONS = { branches: ['فرع المصاية', 'فرع طرابلس', 'فرع بنغازي', 'الفرع الرئيسي'], types: ['بطاقة', 'حوالة', 'نقدي'], purposes: fallbackPurposes, limit: 4000 };

export function verification(mode = 'default') {
  const isLogin = mode === 'login';
  return `<button type="button" class="verification${isLogin ? ' login-verification' : ''}" data-action="verify" aria-label="إتمام التحقق التجريبي">
    <span class="verification-result"><span class="checkmark">✓</span><span class="verification-text">${isLogin ? 'يتم التحقق الآن...' : 'جارٍ التحقق…'}</span></span>
    <img src="/assets/${isLogin ? 'login-cloudflare' : 'cloudflare-logo'}.png" class="cloudflare-logo" alt="Cloudflare">
  </button>`;
}

function field({ id, label, type = 'text', inputmode = '', maxlength = '', value = '', required = true, dir = 'rtl' }) {
  return `<div class="form-field"><label for="${id}">${label}</label><input id="${id}" name="${id}" type="${type}" ${inputmode ? `inputmode="${inputmode}"` : ''} ${maxlength ? `maxlength="${maxlength}"` : ''} ${required ? 'required' : ''} value="${e(value)}" dir="${dir}" autocomplete="off" spellcheck="false"></div>`;
}

export function registration() {
  return `<div class="auth-card register-card">
    <div class="auth-brand"><img src="/assets/bank-logo.png" alt="مصرف ليبيا المركزي"></div>
    <form id="register-form" class="register-form" novalidate>
      ${field({ id: 'national', label: 'الرقم الوطني', inputmode: 'numeric', maxlength: '12' })}
      ${field({ id: 'passport', label: 'جواز السفر', maxlength: '12' })}
      ${field({ id: 'phone', label: 'رقم الهاتف', inputmode: 'tel', maxlength: '10' })}
      ${verification()}
      <p class="terms">بالتسجيل بالمنصة فأنت توافق على <button type="button" data-action="terms">الشروط والأحكام.</button></p>
      <button id="register-submit" type="submit" class="button black full-width">تسجيل حساب جديد</button>
      <p class="auth-switch">تمتلك حساب بالفعل؟ <a href="#login">تسجيل الدخول الآن</a></p>
    </form>
  </div>
  <p class="auth-instruction register-instruction">قم بإدخال الرقم الوطني ورقم الهاتف مربوط <br>بالرقم الوطني ورقم جواز السفر ساري المفعول</p>`;
}

export function otp(delivery = null) {
  return `<div class="auth-card verify-card">
    <div class="auth-brand"><img src="/assets/bank-logo.png" alt="مصرف ليبيا المركزي"></div>
    <form id="otp-form" class="otp-form" novalidate>
      <div class="otp-label-row"><label for="otp">رمز التأكيد</label><button type="button" data-action="resend" id="resend">إعادة إرسال رمز التأكيد</button></div>
      <input id="otp" name="otp" class="otp-input" type="text" inputmode="numeric" maxlength="20" required autocomplete="off" aria-label="أدخل أي رقم للمتابعة">
      ${verification()}
      <div class="otp-actions"><button type="button" data-action="logout" class="plain-button">تسجيل الخروج</button><button type="submit" class="button dark">تأكيد الهوية</button></div>
    </form>
    <p class="auth-copyright">© 2024 منصة حجز العملة الأجنبية للأفراد.</p>
    <img class="auth-watermark" src="/assets/bank-logo.png" alt="">
  </div>
  <p class="auth-instruction verify-instruction">بعد الموافقة، أدخل أي رقم للمتابعة</p>`;
}

export function approvalWaiting(state = 'pending') {
  const rejected = state === 'rejected';
  return `<div class="login-shell approval-shell">
    <header class="login-header"><img src="/assets/login-logo.png" alt="مصرف ليبيا المركزي — CENTRAL BANK OF LIBYA"></header>
    <section class="login-card approval-card" aria-live="polite">
      <div class="approval-mark ${rejected ? 'approval-rejected' : ''}">${rejected ? '×' : '⌛'}</div>
      <h1>${rejected ? 'تم رفض محاولة الدخول' : 'طلبك قيد المراجعة'}</h1>
      <p>${rejected ? 'لم تتم الموافقة على الدخول من الإدارة. يمكنك المحاولة ببيانات أخرى أو التواصل مع الجهة المختصة.' : 'تم استلام الرقم الوطني ورقم الهاتف. سيظهر رمز الدخول بعد موافقة الإدارة.'}</p>
      ${rejected ? '<a class="button black full-width approval-back" href="#login">العودة إلى تسجيل الدخول</a>' : '<div class="approval-loader" aria-hidden="true"><span></span><span></span><span></span></div><small>يتم التحقق تلقائيًا من حالة الطلب…</small><button type="button" class="button approval-refresh" data-action="check-approval">تحديث حالة الموافقة</button>'}
    </section>
    <p class="login-copyright">© 2026 منصة حجز العملة الأجنبية.</p>
  </div>`;
}

function emptyState(title, message, symbol = 'alert') {
  return `<div class="empty-state">${icon(symbol, 'empty-icon')}<strong>${title}</strong><p>${message}</p></div>`;
}
function stat(label, value, symbol) {
  return `<div class="stat">${icon(symbol)}<div><span>${label}</span><strong dir="ltr">${value}</strong></div></div>`;
}
function addAccountButton() {
  return '<a href="#banks" class="button light"><span class="plus">+</span> إضافة حساب جديد</a>';
}
export function bankInfo(account) {
  const match = fallbackBanks.find(bank => bank.id === (account.bankId || account.bankCode));
  return { ar: account.bankAr || match?.ar || '—', en: account.bankEn || match?.en || '', logo: account.logo || match?.logo || `/assets/banks/${match?.id || 'lib'}.png` };
}
function accountRequests(state, account) {
  return (state?.requests || []).filter(request => String(request.accountId) === String(account.id));
}
function requestStatusClass(status) {
  return status === 'مقبول' ? 'green' : status === 'مرفوض' ? 'red' : 'amber';
}
function userData(user = {}) {
  const rows = [
    ['الاسم', user.name || 'مستخدم تجريبي', 'person'],
    ['رقم الهاتف', user.phone || '0912••••••', 'phone'],
    ['الرقم الوطني', user.national || '1199••••••••', 'id'],
    ['رقم جواز السفر', user.passport || 'DEMO••••', 'passport']
  ];
  return `<div class="user-data">${rows.map(([label, value, symbol]) => `<div class="user-row"><span>${icon(symbol)} ${label}</span><span>${e(value)}</span></div>`).join('')}</div>`;
}

export function dashboard(state, user) {
  const stats = state.stats || {};
  const pending = Number(stats.pending ?? (state.requests || []).reduce((total, request) => total + request.amount, 0));
  const reserved = Number(stats.reserved ?? 0);
  const available = Number(stats.available ?? Math.max(0, (state.limit || FALLBACK_OPTIONS.limit) - pending));
  return `<div class="stats-row">
    ${stat('عدد الطلبات', stats.count ?? (state.requests || []).length, 'requests')}
    ${stat('القيمة المحجوزة', reserved.toFixed(2), 'money')}
    ${stat('القيمة المعلقة', pending.toFixed(2), 'clock')}
    ${stat('القيمة المتاحة', available.toFixed(2), 'card')}
  </div>
  <div class="dashboard-lower">${userData(user)}<section class="dashboard-requests">${(state.requests || []).length ? state.requests.map(request => requestRow(request)).join('') : emptyState('لا توجد طلبات حجز عملة أجنبية', 'لم تقم بإرسال طلب حجز عملة أجنبية من قبل حتى الآن.')}</section></div>`;
}

export function accounts(state) {
  const list = state.accounts || [];
  return `<div class="page-toolbar single-left">${addAccountButton()}</div>
    <div class="account-list">${list.length ? list.map(account => {
      const bank = bankInfo(account);
      return `<div class="account-row"><div class="account-row-info"><img class="bank-icon" src="${e(bank.logo)}" alt="${e(bank.ar)}"><div><span class="account-number" dir="ltr">${e(account.iban)}</span><small>${account.requestCount ?? accountRequests(state, account).length} طلبات</small></div></div><a href="#account/${account.id}" class="row-link">عرض الحساب <span>←</span></a></div>`;
    }).join('') : emptyState('لا توجد حسابات مصرفية', 'قم بإضافة حساب جديد بالضغط على زر «إضافة حساب جديد».', 'bank')}</div>`;
}

export function bankList(list = fallbackBanks) {
  return `<div class="bank-list">${list.map(bank => `<div class="bank-row">
    <div class="bank-info"><img class="bank-icon" src="${e(bank.logo || `/assets/banks/${bank.id}.png`)}" alt=""><div><strong>${e(bank.ar)}</strong><span lang="en">${e(bank.en)}</span></div></div>
    <a href="#add-account/${encodeURIComponent(bank.id)}" class="row-link"><span class="plus">+</span> إضافة حساب جديد</a>
  </div>`).join('')}</div>`;
}

export function addAccount(bankId, bank) {
  return `<form id="account-form" class="form-panel" data-bank="${e(bankId)}" novalidate>
    ${bank ? `<p class="form-bank-name">${icon('bank')} ${e(bank)}</p>` : ''}
    ${field({ id: 'iban', label: 'رقم الـ IBAN', maxlength: '25' })}
    ${verification()}
    <div class="form-actions"><a href="#banks" class="button light">${icon('undo')} إلغاء الأمر</a><button class="button dark" type="submit"><span class="plus">+</span> إضافة حساب جديد</button></div>
  </form>`;
}

function sidebar(account, state) {
  const bank = bankInfo(account);
  return `<aside class="account-sidebar">
    <dl><dt>رقم الحساب المصرفي الدولي</dt><dd class="sidebar-iban" dir="ltr">${e(account.iban)}</dd>
    <dt>المصرف</dt><dd>${e(bank.ar)}</dd>
    <dt>عدد الطلبات</dt><dd>${account.requestCount ?? accountRequests(state, account).length}</dd>
    <dt>حالة الحساب</dt><dd><span class="badge green">مطابق</span></dd>
    <dt>تاريخ الإضافة</dt><dd class="mono">${e(account.createdAt)}</dd></dl>
  </aside>`;
}

export function requestRow(request) {
  const status = request.status || 'في انتظار المطابقة';
  return `<div class="request-row"><div class="request-row-info"><div><span class="mono">${e(request.reference)}</span><span class="badge ${requestStatusClass(status)}">${e(status)}</span></div><small>${icon('calendar')} ${e(request.date)}</small></div><a href="#request/${request.id}" class="row-link">عرض الطلب <span>←</span></a></div>`;
}

export function accountDetails(account, state) {
  const list = accountRequests(state, account);
  return `<div class="page-toolbar"><a href="#accounts" class="row-link">العودة إلى حساباتي <span>→</span></a><a href="#new-request/${account.id}" class="button light"><span class="plus">+</span> إضافة طلب جديد</a></div>
    <div class="account-columns"><div class="account-requests">${list.length ? list.map(request => requestRow(request)).join('') : emptyState('لا توجد طلبات حجز عملة أجنبية', 'لم تقم بإرسال طلب حجز عملة أجنبية من قبل حتى الآن.')}</div>${sidebar(account, state)}</div>`;
}

export function requestForm(account, options = {}) {
  const config = { ...FALLBACK_OPTIONS, ...options };
  const select = (id, label, values, placeholder) => `<div class="form-field"><label for="${id}">${label}</label><select id="${id}" name="${id}" required><option value="">${placeholder}</option>${values.map(value => `<option>${e(value)}</option>`).join('')}</select></div>`;
  return `<form id="request-form" class="form-panel request-form" data-account="${account.id}" novalidate>
    ${select('branch', 'الفرع', config.branches, 'اختر الفرع')}
    ${select('request-type', 'نوع الطلب', config.types, 'اختر نوع الطلب')}
    ${field({ id: 'amount', label: 'القيمة', type: 'number', dir: 'rtl' })}
    <fieldset class="purpose-group"><legend>الغرض من استخدام العملة</legend>${config.purposes.map((purpose, index) => `<label for="purpose-${index}"><input id="purpose-${index}" type="checkbox" name="purpose" value="${e(purpose)}">${e(purpose)}</label>`).join('')}</fieldset>
    <label class="consent"><input id="consent" name="consent" type="checkbox" required><span>أوافق على السماح للمصرف بحجز القيمة المطلوبة لشراء العملة، وخصم العمولات اللازمة لشحن البطاقة أو إصدار بطاقة جديدة.</span></label>
    ${verification()}
    <div class="form-actions"><a href="#account/${account.id}" class="button light">${icon('undo')} إلغاء الأمر</a><button type="submit" class="button dark"><span class="plus">+</span> إرسال طلب الحجز</button></div>
  </form>`;
}

export function requestDetails(request, account, state) {
  const status = request.status || 'في انتظار المطابقة';
  return `<div class="page-toolbar"><a href="#account/${account.id}" class="row-link">العودة إلى الحساب <span>→</span></a></div><div class="account-columns"><div class="request-details">
    <div class="request-detail-heading"><span>طلب شراء عملة أجنبية</span><span class="badge ${requestStatusClass(status)}">${e(status)}</span></div>
    <dl>${[['رقم الطلب', request.reference], ['تاريخ الطلب', request.date], ['الفرع', request.branch], ['نوع الطلب', request.type], ['القيمة', `${Number(request.amount).toFixed(2)} دولار أمريكي`], ['الغرض من استخدام العملة', (request.purposes || []).join('، ')]].map(([label, value]) => `<div><dt>${label}</dt><dd>${e(value)}</dd></div>`).join('')}</dl>
  </div>${sidebar(account, state)}</div>`;
}

export function loading() {
  return `<div class="empty-state">${icon('clock', 'empty-icon')}<strong>جارٍ التحميل…</strong><p>يتم الاتصال بقاعدة بيانات النموذج التجريبي.</p></div>`;
}
