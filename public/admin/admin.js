const TOKEN_KEY = 'fcms_admin_token';
const NONCE_KEY = 'fcms_admin_oauth_nonce';
const PAGE_SIZE = 25;
const PENDING_STATUS = 'في انتظار المطابقة';
const APPROVED_STATUS = 'مقبول';
const REJECTED_STATUS = 'مرفوض';
const ACCESS_PENDING_STATUS = 'في انتظار الموافقة';
const ROUTES = ['overview', 'users', 'accounts', 'requests'];

const routeMeta = {
  overview: { title: 'نظرة عامة', kicker: 'لوحة الإدارة' },
  users: { title: 'المستخدمون', kicker: 'دليل السجلات' },
  accounts: { title: 'الحسابات', kicker: 'بيانات الحسابات' },
  requests: { title: 'الطلبات', kicker: 'طلبات المطابقة' }
};

const state = {
  configured: null,
  authenticated: false,
  admin: null,
  sessionError: false,
  callbackError: '',
  route: getRoute(),
  queries: { users: '', accounts: '', requests: '' },
  pages: { users: 1, accounts: 1, requests: 1 },
  requestStatus: '',
  requestGeneration: 0,
  detailGeneration: 0,
  renderedRoute: '',
  refreshTimer: null,
  toastTimer: null,
  alertTimer: null,
  knownAccessIds: null,
  notificationCount: 0
};

const dom = {
  app: document.getElementById('admin-app'),
  sidebar: document.getElementById('admin-sidebar'),
  sidebarScrim: document.getElementById('sidebar-scrim'),
  sidebarToggle: document.getElementById('sidebar-toggle'),
  nav: document.querySelector('.admin-nav'),
  logout: document.getElementById('logout-button'),
  refresh: document.getElementById('refresh-button'),
  pageKicker: document.getElementById('page-kicker'),
  pageTitle: document.getElementById('page-title'),
  adminIdentity: document.getElementById('admin-identity'),
  notificationButton: document.getElementById('notification-button'),
  notificationCount: document.getElementById('notification-count'),
  content: document.getElementById('admin-content'),
  initialLoading: document.getElementById('initial-loading'),
  authView: document.getElementById('auth-view'),
  authTitle: document.getElementById('auth-title'),
  authDescription: document.getElementById('auth-description'),
  setupNotice: document.getElementById('setup-notice'),
  callbackError: document.getElementById('callback-error'),
  loginForm: document.getElementById('admin-login-form'),
  login: document.getElementById('login-button'),
  iframeHint: document.getElementById('iframe-hint'),
  dashboard: document.getElementById('dashboard-view'),
  routeContent: document.getElementById('route-content'),
  toast: document.getElementById('toast'),
  drawer: document.getElementById('details-drawer'),
  drawerTitle: document.getElementById('drawer-title'),
  drawerClose: document.getElementById('drawer-close'),
  drawerContent: document.getElementById('drawer-content')
};

class ApiError extends Error {
  constructor(status) {
    super('admin_api_error');
    this.name = 'ApiError';
    this.status = status;
  }
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function escapeAttribute(value) {
  return escapeHTML(value);
}

function display(value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback;
  return escapeHTML(value);
}

function displayNumber(value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return display(value, fallback);
  return escapeHTML(new Intl.NumberFormat('ar-LY').format(number));
}

function displayAmount(value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return `${display(value, fallback)} <span class="muted">USD</span>`;
  return `${escapeHTML(new Intl.NumberFormat('ar-LY', { maximumFractionDigits: 2 }).format(number))} <span class="muted">USD</span>`;
}

function displayDate(value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return display(value, fallback);
  return escapeHTML(new Intl.DateTimeFormat('ar-LY', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date));
}

function displayBoolean(value) {
  return value === true ? 'نعم' : value === false ? 'لا' : '—';
}

function getRoute() {
  const route = window.location.hash.replace(/^#/, '').split('?')[0];
  return ROUTES.includes(route) ? route : 'overview';
}

function readStorage(key) {
  try {
    return sessionStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function writeStorage(key, value) {
  try {
    sessionStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeStorage(key) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Storage may be unavailable in a restricted browsing context.
  }
}

function decodeState(value) {
  try {
    const normalized = String(value).replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    const binary = window.atob(padded);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    const text = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function isExpectedRedirectUri(value) {
  if (typeof value !== 'string' || !value) return false;
  try {
    const parsed = new URL(value, window.location.origin);
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    return parsed.origin === window.location.origin && path === '/admin/callback';
  } catch {
    return false;
  }
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const token = readStorage(TOKEN_KEY);
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(path, {
    ...options,
    headers,
    credentials: 'include'
  });

  let payload = null;
  try {
    const text = await response.text();
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) throw new ApiError(response.status);
  return payload;
}

function showToast(message, type = 'info') {
  window.clearTimeout(state.toastTimer);
  dom.toast.textContent = message;
  dom.toast.className = `toast ${type}`;
  dom.toast.hidden = false;
  state.toastTimer = window.setTimeout(() => {
    dom.toast.hidden = true;
  }, 4200);
}

function showAccessDecisionToast(result, userId) {
  window.clearTimeout(state.toastTimer);
  const message = escapeHTML(result?.message || 'تم تسجيل قرار الدخول.');
  dom.toast.className = 'toast info toast-with-action';
  dom.toast.innerHTML = `<span>${message}</span><button type="button" class="toast-action" data-action="view-approved-user" data-user-id="${escapeAttribute(userId)}">عرض التسجيلات</button>`;
  dom.toast.hidden = false;
  state.toastTimer = window.setTimeout(() => { dom.toast.hidden = true; }, 15000);
}

function updateNotificationButton() {
  if (!dom.notificationButton) return;
  const count = Math.max(0, Number(state.notificationCount) || 0);
  dom.notificationButton.hidden = !state.authenticated || count === 0;
  dom.notificationButton.classList.toggle('is-alerting', count > 0);
  dom.notificationButton.setAttribute('aria-label', count ? `${count} تسجيل جديد بانتظار المراجعة` : 'لا توجد تسجيلات جديدة');
  if (dom.notificationCount) dom.notificationCount.textContent = String(count);
}

function playAlertSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.42);
    gain.connect(context.destination);
    [660, 880].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      oscillator.start(context.currentTime + index * 0.12);
      oscillator.stop(context.currentTime + 0.25 + index * 0.12);
    });
    window.setTimeout(() => context.close().catch(() => {}), 900);
  } catch {
    // الصوت اختياري؛ يبقى التنبيه المرئي فعالًا إذا منع المتصفح الصوت.
  }
}

function announceNewVisitors(rows) {
  const first = Array.isArray(rows) && rows[0];
  state.notificationCount = Math.max(1, state.notificationCount + (Array.isArray(rows) ? rows.length : 1));
  updateNotificationButton();
  document.body.classList.add('has-new-registration');
  window.clearTimeout(state.alertTimer);
  state.alertTimer = window.setTimeout(() => document.body.classList.remove('has-new-registration'), 12000);
  if (navigator.vibrate) navigator.vibrate([180, 90, 180]);
  playAlertSound();
  showToast(first ? `تسجيل جديد بانتظار موافقتك — الرقم الوطني ${first.nationalNumber || ''}` : 'يوجد تسجيل جديد بانتظار موافقتك.', 'info');
}

function observeSummary(summary) {
  const rows = Array.isArray(summary?.pendingAccessUsers) ? summary.pendingAccessUsers : [];
  const ids = new Set(rows.map(row => String(row.id)));
  if (state.knownAccessIds === null) {
    state.knownAccessIds = ids;
    return;
  }
  const newRows = rows.filter(row => !state.knownAccessIds.has(String(row.id)));
  state.knownAccessIds = ids;
  if (newRows.length) announceNewVisitors(newRows);
}

async function loadLiveSummary() {
  if (!state.authenticated) return;
  try {
    const summary = await api('/api/admin/summary');
    observeSummary(summary);
    if (state.route === 'overview') renderOverview(summary);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) await handleUnauthorized();
  }
}

function setInitialMessage(title, description) {
  const strong = dom.initialLoading.querySelector('strong');
  const paragraph = dom.initialLoading.querySelector('p');
  if (strong) strong.textContent = title;
  if (paragraph) paragraph.textContent = description;
}

function setSidebarOpen(isOpen) {
  dom.sidebar.classList.toggle('is-open', isOpen);
  dom.sidebarToggle.setAttribute('aria-expanded', String(isOpen));
  dom.sidebarToggle.setAttribute('aria-label', isOpen ? 'إغلاق القائمة' : 'فتح القائمة');
  dom.sidebarScrim.hidden = !isOpen;
}

function updateRouteChrome(route) {
  const meta = routeMeta[route] || routeMeta.overview;
  dom.pageKicker.textContent = meta.kicker;
  dom.pageTitle.textContent = meta.title;
  document.title = `${meta.title} — إدارة المنصة`;
  document.querySelectorAll('[data-route]').forEach(link => {
    link.classList.toggle('active', link.dataset.route === route);
    if (link.dataset.route === route) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function renderAuth() {
  state.requestGeneration += 1;
  dom.routeContent.textContent = '';
  dom.drawerContent.textContent = '';
  dom.initialLoading.hidden = true;
  dom.dashboard.hidden = true;
  dom.refresh.hidden = true;
  dom.logout.hidden = true;
  dom.nav.hidden = true;
  dom.authView.hidden = false;
  dom.adminIdentity.hidden = true;
  setSidebarOpen(false);

  if (state.sessionError) {
    dom.authTitle.textContent = 'تعذر التحقق من الجلسة';
    dom.authDescription.textContent = 'تحقق من الاتصال ثم أعد المحاولة. لن تظهر أي بيانات قبل التحقق.';
    dom.setupNotice.hidden = true;
    dom.callbackError.hidden = false;
    dom.callbackError.textContent = 'تعذر الوصول إلى جلسة الإدارة حالياً.';
    dom.login.hidden = false;
    dom.login.textContent = 'دخول لوحة التحكم';
    dom.iframeHint.hidden = true;
    return;
  }

  dom.authTitle.textContent = state.configured === false ? 'إدارة المنصة غير مفعّلة' : 'الدخول إلى إدارة المنصة';
  dom.authDescription.textContent = state.configured === false
    ? 'لا يمكن عرض السجلات قبل إعداد بيانات الدخول.'
    : 'أدخل اسم المستخدم وكلمة المرور للوصول إلى التسجيلات والطلبات.';
  dom.setupNotice.hidden = state.configured !== false;
  dom.loginForm.hidden = state.configured !== true;
  dom.login.hidden = false;
  dom.login.textContent = 'دخول لوحة التحكم';
  dom.iframeHint.hidden = true;
  dom.callbackError.hidden = !state.callbackError;
  dom.callbackError.textContent = state.callbackError;
}

function renderAuthenticatedShell() {
  dom.initialLoading.hidden = true;
  dom.authView.hidden = true;
  dom.dashboard.hidden = false;
  dom.refresh.hidden = false;
  dom.logout.hidden = false;
  dom.nav.hidden = false;
  dom.adminIdentity.hidden = !state.admin;
  if (state.admin) {
    const name = display(state.admin.name, 'مشرف الإدارة');
    const email = display(state.admin.email, '');
    dom.adminIdentity.innerHTML = `<strong>${name}</strong>${email ? ` · ${email}` : ''}`;
  }
  updateRouteChrome(state.route);
}

async function completeCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const returnedState = params.get('state');
  if (!code && !returnedState) return '';

  window.history.replaceState({}, document.title, '/admin');
  if (!code || !returnedState) {
    removeStorage(TOKEN_KEY);
    removeStorage(NONCE_KEY);
    return 'تعذر إكمال الدخول لأن بيانات العودة غير مكتملة.';
  }

  const savedNonce = readStorage(NONCE_KEY);
  const decoded = decodeState(returnedState);
  if (!savedNonce || !decoded || typeof decoded.nonce !== 'string' || decoded.nonce !== savedNonce || !isExpectedRedirectUri(decoded.redirectUri)) {
    removeStorage(TOKEN_KEY);
    removeStorage(NONCE_KEY);
    return 'تعذر التحقق من جلسة المصادقة. أعد بدء الدخول من هذه الصفحة.';
  }

  try {
    removeStorage(TOKEN_KEY);
    setInitialMessage('جارٍ إكمال تسجيل الدخول', 'يتم التحقق من الاستجابة مع خادم الإدارة.');
    const result = await api('/api/admin/auth/complete', {
      method: 'POST',
      body: JSON.stringify({ code, state: returnedState, nonce: savedNonce })
    });
    if (!result || typeof result.sessionToken !== 'string' || !result.sessionToken) {
      removeStorage(NONCE_KEY);
      return 'تعذر إكمال الدخول. أعد المحاولة من جديد.';
    }
    if (!writeStorage(TOKEN_KEY, result.sessionToken)) {
      removeStorage(NONCE_KEY);
      return 'تعذر حفظ جلسة الإدارة في هذا المتصفح.';
    }
    removeStorage(NONCE_KEY);
    return '';
  } catch (error) {
    removeStorage(NONCE_KEY);
    return error instanceof ApiError && error.status === 403
      ? 'حساب Manus هذا غير مخوّل للوصول إلى الإدارة.'
      : 'تعذر إكمال الدخول. أعد المحاولة من جديد.';
  }
}

async function checkSession() {
  state.sessionError = false;
  setInitialMessage('جارٍ التحقق من جلسة الإدارة', 'لن تظهر بيانات المنصة قبل التحقق من الصلاحية.');
  dom.initialLoading.hidden = false;
  dom.authView.hidden = true;
  dom.dashboard.hidden = true;
  try {
    const session = await api('/api/admin/session');
    state.configured = session?.configured === true;
    state.authenticated = session?.authenticated === true;
    state.admin = session?.admin && typeof session.admin === 'object' ? session.admin : null;
    if (state.authenticated && typeof session?.sessionToken === 'string' && session.sessionToken) writeStorage(TOKEN_KEY, session.sessionToken);
    if (!state.authenticated) removeStorage(TOKEN_KEY);
    if (state.authenticated) {
      renderAuthenticatedShell();
      await loadCurrentRoute(false);
      startAutoRefresh();
    } else {
      renderAuth();
    }
  } catch {
    state.configured = null;
    state.authenticated = false;
    state.admin = null;
    state.sessionError = true;
    removeStorage(TOKEN_KEY);
    renderAuth();
  }
}

async function startLogin(event) {
  event?.preventDefault();
  if (state.sessionError) { await checkSession(); return; }
  const formData = new FormData(dom.loginForm);
  const username = String(formData.get('username') || '').trim();
  const password = String(formData.get('password') || '');
  if (!username || !password) {
    dom.callbackError.hidden = false;
    dom.callbackError.textContent = 'أدخل اسم المستخدم وكلمة المرور.';
    return;
  }
  dom.login.disabled = true;
  dom.login.textContent = 'جارٍ التحقق…';
  try {
    const result = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    if (!result || typeof result.sessionToken !== 'string' || !result.sessionToken) throw new Error('invalid_login');
    if (!writeStorage(TOKEN_KEY, result.sessionToken)) throw new Error('storage_unavailable');
    dom.callbackError.hidden = true;
    await checkSession();
  } catch (error) {
    dom.callbackError.hidden = false;
    dom.callbackError.textContent = error instanceof ApiError && error.status === 401
      ? 'اسم المستخدم أو كلمة المرور غير صحيحة.'
      : error?.message === 'storage_unavailable' ? 'تعذر حفظ جلسة الإدارة في هذا المتصفح.' : 'تعذر تسجيل الدخول. أعد المحاولة.';
    dom.login.disabled = false;
    dom.login.textContent = 'دخول لوحة التحكم';
  }
}

function overviewShell() {
  return `<div class="route-header">
    <div class="route-heading"><h2>نظرة عامة</h2><p>ملخص للبيانات المتاحة للمشرف المصرّح له بالقراءة.</p></div>
  </div>
  <div id="overview-data"><div class="state-card"><span class="spinner" aria-hidden="true"></span><strong>جارٍ تحميل الملخص</strong><p>يتم جلب أحدث البيانات من خادم الإدارة.</p></div></div>`;
}

function tableShell(route) {
  const labels = {
    users: ['المستخدمون', 'سجلات المستخدمين وحالات موافقة الدخول مع إخفاء البيانات الحساسة.', 'الرقم الوطني أو الهاتف أو الجواز'],
    accounts: ['الحسابات', 'سجلات الحسابات المرتبطة بالمستخدمين.', 'المصرف أو IBAN أو الرقم الوطني'],
    requests: ['الطلبات', 'كل طلبات الحجز المسجلة مع حالتها.', 'مرجع الطلب أو الرقم الوطني أو IBAN']
  }[route];
  const query = escapeAttribute(state.queries[route]);
  const status = route === 'requests' ? `<select class="status-filter" name="status" aria-label="حالة الطلبات"><option value="" ${state.requestStatus ? '' : 'selected'}>كل الحالات</option><option value="${escapeAttribute(PENDING_STATUS)}" ${state.requestStatus ? 'selected' : ''}>${escapeHTML(PENDING_STATUS)}</option></select>` : '';
  return `<div class="route-header">
    <div class="route-heading"><h2>${labels[0]}</h2><p>${labels[1]}</p></div>
    <div class="route-tools">
      <form class="search-form" data-search-form="${route}" role="search">
        <div class="search-input-wrap"><span class="search-symbol" aria-hidden="true">⌕</span><input class="search-input" name="q" value="${query}" placeholder="${labels[2]}" autocomplete="off" spellcheck="false" aria-label="بحث في ${labels[0]}"></div>
        ${status}
        <button class="button button-light search-submit" type="submit">بحث</button>
      </form>
    </div>
  </div>
  <div id="${route}-data"></div>`;
}

function renderRouteShell(route) {
  state.route = route;
  updateRouteChrome(route);
  dom.routeContent.innerHTML = route === 'overview' ? overviewShell() : tableShell(route);
  state.renderedRoute = route;
}

function metricCard(label, value, extraClass = '', note = '') {
  return `<article class="metric-card"><span class="metric-label">${label}</span><strong class="metric-value ${extraClass}">${value}</strong>${note ? `<span class="metric-note">${note}</span>` : ''}</article>`;
}

function latestUsersMarkup(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '<div class="empty-mini">لا توجد سجلات مستخدمين متاحة.</div>';
  return rows.map(row => `<div class="latest-row">
    <div class="latest-main"><span class="latest-avatar" aria-hidden="true">♙</span><div><strong>${display(row.nationalNumber)}</strong><span>${display(row.phone)} ${presenceBadges(row)}</span></div></div>
    <div class="latest-side"><strong>${displayDate(row.createdAt)}</strong><span>${display(row.id)}</span></div>
  </div>`).join('');
}

function latestRequestsMarkup(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '<div class="empty-mini">لا توجد طلبات متاحة.</div>';
  return rows.map(row => `<div class="latest-row">
    <div class="latest-main"><span class="latest-avatar" aria-hidden="true">☷</span><div><strong>${display(row.reference)}</strong><span>${display(row.userId)}</span></div></div>
    <div class="latest-side"><strong>${displayAmount(row.amount)}</strong><span>${display(row.status)}</span></div>
  </div>`).join('');
}

function registrationFacts(row) {
  const facts = [
    ['الرقم الوطني', display(row.nationalNumber)],
    ['رقم الهاتف', display(row.phone)],
    ['رقم الجواز', display(row.passportNumber)],
    ['الدولة والمدينة', locationLabel(row)],
    ['عنوان الاتصال', display(row.ip)],
    ['عدد محاولات الدخول', displayNumber(row.attempts, '1')],
    ['أول ظهور', displayDate(row.firstSeenAt || row.createdAt)],
    ['آخر ظهور', displayDate(row.lastSeenAt || row.createdAt)],
    ['حالة الرمز', row.otpCode
      ? `<span class="otp-chip is-live">الرمز ${display(row.otpCode)} — ينتهي ${displayDate(row.otpExpiresAt)}</span>`
      : '<span class="otp-chip">يُرسل الرمز تلقائيًا بعد موافقتك</span>']
  ];
  return `<div class="registration-facts">${facts.map(([label, value]) => `<div class="fact"><span>${label}</span><strong>${value}</strong></div>`).join('')}</div>`;
}

function pendingAccessMarkup(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '<div class="empty-mini">لا توجد تسجيلات في القائمة.</div>';
  return `<div class="access-inbox-list">${rows.map(row => `<article class="access-inbox-row">
    <div class="access-inbox-head"><span class="access-inbox-icon" aria-hidden="true">♙</span><div><strong>${display(row.nationalNumber)}</strong><span>${display(row.phone)} · ${presenceBadges(row)}</span></div></div>
    <div class="access-inbox-compact"><span><small>الجواز</small><b>${display(row.passportNumber)}</b></span><span class="access-otp-inline"><small>${row.lastEnteredCode ? 'الرقم المدخل' : 'الكود'}</small><b>${row.lastEnteredCode ? display(row.lastEnteredCode) : row.otpCode ? display(row.otpCode) : 'بعد الموافقة'}</b></span></div>
    <div class="access-inbox-side">${accessStatusBadge(row.accessStatus)}${detailButton('users', row.id)}${accessDecisionActions(row, true)}</div>
  </article>`).join('')}</div>`;
}

function renderOverview(summary) {
  const target = document.getElementById('overview-data');
  if (!target) return;
  const data = summary && typeof summary === 'object' ? summary : {};
  target.innerHTML = `<section class="panel access-inbox-panel ${state.notificationCount ? 'has-new' : ''}"><header class="panel-header"><div><h3>طلبات الدخول</h3><p class="panel-subtitle">راجع المستخدم ثم وافق أو ارفض الدخول.</p></div><span class="inbox-count">${displayNumber(data.pendingAccessUsers?.length, '0')}</span></header>${pendingAccessMarkup(data.pendingAccessUsers)}</section>
  <div class="metrics-grid">
    ${metricCard('متصل الآن', displayNumber(data.onlineUsers, '0'), 'online-metric', 'آخر 45 ثانية')}
    ${metricCard('بانتظار الموافقة', displayNumber(data.pendingAccessCount, '0'), 'new-metric', 'لم يفتح لهم الرمز بعد')}
    ${metricCard('المسجلون', displayNumber(data.users, '0'))}
    ${metricCard('الطلبات', displayNumber(data.requests, '0'))}
  </div>
  <div class="overview-grid">
    <section class="panel"><header class="panel-header"><h3>أحدث الطلبات</h3><a href="#requests">عرض الكل</a></header><div class="latest-list">${latestRequestsMarkup(data.latestRequests)}</div></section>
  </div>`;
}

function tableLoading() {
  return '<div class="table-loading"><span class="spinner" aria-hidden="true"></span><span>جارٍ تحميل السجلات…</span></div>';
}

function tableError(message) {
  return `<div class="table-error"><strong>${escapeHTML(message)}</strong><p>يمكنك إعادة المحاولة دون مغادرة الصفحة.</p><button class="button button-light" type="button" data-action="retry">إعادة المحاولة</button></div>`;
}

function tableEmpty(label) {
  return `<div class="table-empty"><span class="empty-mark" aria-hidden="true">⌁</span><strong>لا توجد سجلات</strong><p>${escapeHTML(label)}</p></div>`;
}

function detailButton(type, id) {
  if (id === null || id === undefined || id === '') return '<span class="muted">—</span>';
  return `<button class="detail-link" type="button" data-detail-type="${escapeAttribute(type)}" data-detail-id="${escapeAttribute(id)}">عرض التفاصيل</button>`;
}

function statusBadge(status) {
  if (status === null || status === undefined || status === '') return '<span class="muted">—</span>';
  const className = status === PENDING_STATUS ? 'badge-pending' : status === APPROVED_STATUS ? 'badge-approved' : status === REJECTED_STATUS ? 'badge-rejected' : 'badge-neutral';
  return `<span class="badge ${className}">${display(status)}</span>`;
}

function accessStatusBadge(status, code = '') {
  const value = status || APPROVED_STATUS;
  const className = value === ACCESS_PENDING_STATUS ? 'badge-pending' : value === APPROVED_STATUS ? 'badge-approved' : value === REJECTED_STATUS ? 'badge-rejected' : 'badge-neutral';
  return `<span class="badge ${className}">${display(value)}</span>${code ? `<span class="otp-chip is-live">الكود ${display(code)}</span>` : ''}`;
}

function presenceBadges(user) {
  return `<span class="presence-badges"><span class="presence-badge ${user?.online ? 'is-online' : 'is-offline'}"><i aria-hidden="true"></i>${user?.online ? 'متصل الآن' : 'غير متصل'}</span></span>`;
}

function locationLabel(user) {
  const country = String(user?.country || '').trim();
  const city = String(user?.city || '').trim();
  if (!country && !city) return '<span class="muted">غير محدد</span>';
  const text = [country || `دولة ${user?.countryCode || ''}`, city].filter(Boolean).join(' · ');
  return `<span class="location-label">\u{1F30D} ${escapeHTML(text)}</span>`;
}

function decisionActions(request, compact = false) {
  if (!request || request.status !== PENDING_STATUS || request.id === null || request.id === undefined) return '';
  return `<span class="decision-actions${compact ? ' decision-actions-compact' : ''}" aria-label="قرار الطلب">
    <button type="button" class="decision-button decision-approve" data-decision="${APPROVED_STATUS}" data-request-id="${escapeAttribute(request.id)}">موافقة</button>
    <button type="button" class="decision-button decision-reject" data-decision="${REJECTED_STATUS}" data-request-id="${escapeAttribute(request.id)}">رفض</button>
  </span>`;
}

function accessDecisionActions(user, compact = false) {
  if (!user || user.accessStatus !== ACCESS_PENDING_STATUS || user.id === null || user.id === undefined) return '';
  return `<span class="decision-actions${compact ? ' decision-actions-compact' : ''}" aria-label="قرار دخول المستخدم">
    <button type="button" class="decision-button decision-approve" data-access-decision="${APPROVED_STATUS}" data-user-id="${escapeAttribute(user.id)}">موافقة دخول</button>
    <button type="button" class="decision-button decision-reject" data-access-decision="${REJECTED_STATUS}" data-user-id="${escapeAttribute(user.id)}">رفض دخول</button>
  </span>`;
}

function renderUsersTable(rows) {
  return `<table class="data-table"><thead><tr><th>الرقم الوطني</th><th>رقم الهاتف</th><th>الدولة</th><th>الحالة</th><th>الحضور</th><th>الإجراء</th></tr></thead><tbody>${rows.map(row => `<tr>
    <td class="mono">${display(row.nationalNumber)}</td><td class="mono">${display(row.phone)}</td><td>${locationLabel(row)}</td><td>${accessStatusBadge(row.accessStatus)}</td><td>${presenceBadges(row)}</td><td class="request-actions-cell"><div class="request-actions">${accessDecisionActions(row)}</div></td>
  </tr>`).join('')}</tbody></table>`;
}

function renderAccountsTable(rows) {
  return `<table class="data-table"><thead><tr><th>المعرّف</th><th>معرّف المستخدم</th><th>IBAN</th><th>الرقم الوطني</th><th>المصرف</th><th>رمز المصرف</th><th>تاريخ الإنشاء</th><th>الطلبات</th><th> </th></tr></thead><tbody>${rows.map(row => `<tr>
    <td class="id-cell">${display(row.id)}</td><td class="id-cell">${display(row.userId)}</td><td class="mono">${display(row.iban)}</td><td class="mono">${display(row.nationalNumber)}</td><td>${display(row.bankName)}</td><td class="mono">${display(row.bankCode)}</td><td>${displayDate(row.createdAt)}</td><td>${displayNumber(row.requestsCount)}</td><td>${detailButton('accounts', row.id)}</td>
  </tr>`).join('')}</tbody></table>`;
}

function renderRequestsTable(rows) {
  return `<table class="data-table"><thead><tr><th>المعرّف</th><th>المرجع</th><th>معرّف المستخدم</th><th>الرقم الوطني</th><th>المصرف</th><th>الفرع</th><th>النوع</th><th>المبلغ</th><th>الحالة</th><th>تاريخ الإنشاء</th><th> </th></tr></thead><tbody>${rows.map(row => `<tr>
    <td class="id-cell">${display(row.id)}</td><td class="mono">${display(row.reference)}</td><td class="id-cell">${display(row.userId)}</td><td class="mono">${display(row.nationalNumber)}</td><td>${display(row.bankName)}</td><td>${display(row.branch)}</td><td>${display(row.type)}</td><td class="amount-cell">${displayAmount(row.amount)}</td><td>${statusBadge(row.status)}</td><td>${displayDate(row.createdAt)}</td><td class="request-actions-cell"><div class="request-actions">${detailButton('requests', row.id)}${decisionActions(row)}</div></td>
  </tr>`).join('')}</tbody></table>`;
}

function paginationMarkup(route, page, pageSize, total) {
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.max(1, Number(pageSize) || PAGE_SIZE);
  const safeTotal = Math.max(0, Number(total) || 0);
  const totalPages = Math.max(1, Math.ceil(safeTotal / safePageSize));
  const first = Math.max(1, Math.min(safePage - 2, totalPages - 4));
  const last = Math.min(totalPages, first + 4);
  const buttons = [];
  for (let current = first; current <= last; current += 1) {
    buttons.push(`<button class="page-button ${current === safePage ? 'active' : ''}" type="button" data-page="${current}" aria-label="الصفحة ${current}" ${current === safePage ? 'aria-current="page"' : ''}>${current}</button>`);
  }
  return `<div class="table-meta"><span>إجمالي السجلات: <strong>${escapeHTML(new Intl.NumberFormat('ar-LY').format(safeTotal))}</strong></span><div class="pagination"><button class="page-button page-arrow" type="button" data-page="${Math.max(1, safePage - 1)}" aria-label="الصفحة السابقة" ${safePage <= 1 ? 'disabled' : ''}>‹</button>${buttons.join('')}<button class="page-button page-arrow" type="button" data-page="${Math.min(totalPages, safePage + 1)}" aria-label="الصفحة التالية" ${safePage >= totalPages ? 'disabled' : ''}>›</button></div></div>`;
}

function renderTable(route, result) {
  const target = document.getElementById(`${route}-data`);
  if (!target) return;
  const data = result && typeof result === 'object' ? result : {};
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const page = Number(data.page) || state.pages[route] || 1;
  const pageSize = Number(data.pageSize) || PAGE_SIZE;
  const total = Number(data.total) || 0;
  state.pages[route] = page;
  if (!rows.length) {
    target.innerHTML = `<div class="table-panel">${tableEmpty('لا توجد سجلات مطابقة لمعايير البحث الحالية.')}${paginationMarkup(route, page, pageSize, total)}</div>`;
    return;
  }
  const markup = route === 'users' ? renderUsersTable(rows) : route === 'accounts' ? renderAccountsTable(rows) : renderRequestsTable(rows);
  target.innerHTML = `<div class="table-panel"><div class="table-scroll">${markup}</div>${paginationMarkup(route, page, pageSize, total)}</div>`;
}

function friendlyDataError(route, error) {
  if (error instanceof ApiError && error.status === 403) return 'لا تملك صلاحية قراءة هذه السجلات.';
  if (error instanceof ApiError && error.status === 404) return 'لم يتم العثور على مصدر البيانات المطلوب.';
  return route === 'overview' ? 'تعذر تحميل ملخص البيانات.' : 'تعذر تحميل السجلات.';
}

async function loadCurrentRoute(silent = false) {
  if (!state.authenticated) return;
  const route = state.route;
  const generation = ++state.requestGeneration;
  if (state.renderedRoute !== route) renderRouteShell(route);

  if (!silent) {
    const target = document.getElementById(route === 'overview' ? 'overview-data' : `${route}-data`);
    if (target) target.innerHTML = route === 'overview' ? '<div class="state-card"><span class="spinner" aria-hidden="true"></span><strong>جارٍ تحميل الملخص</strong><p>يتم جلب أحدث البيانات من خادم الإدارة.</p></div>' : tableLoading();
  }

  try {
    if (route === 'overview') {
      const summary = await api('/api/admin/summary');
      if (generation !== state.requestGeneration || state.route !== route) return;
      observeSummary(summary);
      updateNotificationButton();
      renderOverview(summary);
      return;
    }
    const params = new URLSearchParams({
      q: state.queries[route] || '',
      page: String(state.pages[route] || 1),
      pageSize: String(PAGE_SIZE)
    });
    if (route === 'requests' && state.requestStatus) params.set('status', state.requestStatus);
    const result = await api(`/api/admin/${route}?${params.toString()}`);
    if (generation !== state.requestGeneration || state.route !== route) return;
    renderTable(route, result);
  } catch (error) {
    if (generation !== state.requestGeneration || state.route !== route) return;
    if (error instanceof ApiError && error.status === 401) {
      await handleUnauthorized();
      return;
    }
    const target = document.getElementById(route === 'overview' ? 'overview-data' : `${route}-data`);
    if (target) target.innerHTML = route === 'overview' ? `<div class="state-card">${tableError(friendlyDataError(route, error))}</div>` : `<div class="table-panel">${tableError(friendlyDataError(route, error))}</div>`;
  }
}

function renderDetailField(label, value, className = '') {
  return `<div class="detail-item"><dt>${escapeHTML(label)}</dt><dd class="${className}">${value}</dd></div>`;
}

function renderUserSection(user, heading = 'بيانات المستخدم') {
  if (!user || typeof user !== 'object') return '';
  return `<section class="detail-section"><h3 class="detail-section-title">${escapeHTML(heading)}</h3><dl class="detail-grid">
    ${renderDetailField('المعرّف', display(user.id), 'mono')}
    ${renderDetailField('الرقم الوطني', display(user.nationalNumber), 'mono')}
    ${renderDetailField('رقم الجواز', display(user.passportNumber), 'mono')}
    ${renderDetailField('الهاتف', display(user.phone), 'mono')}
    ${renderDetailField('الدولة', locationLabel(user))}
    ${renderDetailField('عنوان الاتصال', display(user.ip), 'mono')}
    ${renderDetailField('محاولات الدخول', displayNumber(user.attempts, '1'))}
    ${renderDetailField('أول ظهور', displayDate(user.firstSeenAt))}
    ${renderDetailField('آخر دخول ناجح', displayDate(user.lastLoginAt))}
    ${renderDetailField('الرقم الذي أدخله الزائر', user.lastEnteredCode ? `${display(user.lastEnteredCode)} — ${displayDate(user.lastEnteredAt)}` : 'لم يُدخل بعد')}
    ${renderDetailField('الرمز المرسل', user.otpCode ? `${display(user.otpCode)} — ينتهي ${displayDate(user.otpExpiresAt)}` : 'لم يُرسل بعد')}
    ${renderDetailField('حالة الدخول', accessStatusBadge(user.accessStatus))}
    ${renderDetailField('الحضور', presenceBadges(user))}
    ${renderDetailField('تاريخ الإنشاء', displayDate(user.createdAt))}
  </dl>${accessDecisionActions(user)}</section>`;
}

function renderAccountSection(account, heading = 'بيانات الحساب') {
  if (!account || typeof account !== 'object') return '';
  return `<section class="detail-section"><h3 class="detail-section-title">${escapeHTML(heading)}</h3><dl class="detail-grid">
    ${renderDetailField('المعرّف', display(account.id), 'mono')}
    ${renderDetailField('IBAN', display(account.iban), 'mono')}
    ${renderDetailField('المصرف', display(account.bankName))}
    ${renderDetailField('رمز المصرف', display(account.bankCode), 'mono')}
    ${renderDetailField('تاريخ الإنشاء', displayDate(account.createdAt))}
  </dl></section>`;
}

function renderRequestCard(request) {
  if (!request || typeof request !== 'object') return '';
  const purposes = Array.isArray(request.purposes) && request.purposes.length
    ? request.purposes.map(item => display(item)).join('، ')
    : '—';
  return `<article class="detail-list-card"><strong>${display(request.reference)} ${statusBadge(request.status)}</strong><span>المعرّف: ${display(request.id)} · المبلغ: ${displayAmount(request.amount)}</span><span>الفرع: ${display(request.branch)} · النوع: ${display(request.type)}</span><span>الأغراض: ${purposes}</span><span>الموافقة: ${displayBoolean(request.consent)} · تاريخ الإنشاء: ${displayDate(request.createdAt)}</span>${decisionActions(request, true)}</article>`;
}

function renderRequestsSection(requests, heading = 'الطلبات المرتبطة') {
  if (!Array.isArray(requests)) return '';
  return `<section class="detail-section"><h3 class="detail-section-title">${escapeHTML(heading)} <span class="muted">${displayNumber(requests.length, '0')}</span></h3>${requests.length ? requests.map(renderRequestCard).join('') : '<div class="empty-mini">لا توجد طلبات مرتبطة بهذا السجل.</div>'}</section>`;
}

function renderAccountsList(accounts) {
  if (!Array.isArray(accounts)) return '';
  return `<section class="detail-section"><h3 class="detail-section-title">الحسابات المرتبطة <span class="muted">${displayNumber(accounts.length, '0')}</span></h3>${accounts.length ? accounts.map(account => `<article class="detail-list-card"><strong>${display(account.iban)}</strong><span>${display(account.bankName)} · ${display(account.bankCode)}</span><span>المعرّف: ${display(account.id)} · تاريخ الإنشاء: ${displayDate(account.createdAt)}</span></article>`).join('') : '<div class="empty-mini">لا توجد حسابات مرتبطة بهذا السجل.</div>'}</section>`;
}

function renderDetails(type, data) {
  const payload = data && typeof data === 'object' ? data : {};
  if (type === 'users') return `${renderUserSection(payload.user)}${renderAccountsList(payload.accounts)}${renderRequestsSection(payload.requests)}`;
  if (type === 'accounts') return `${renderAccountSection(payload.account)}${renderUserSection(payload.user)}${renderRequestsSection(payload.requests)}`;
  return `${renderRequestSection(payload.request)}${renderAccountSection(payload.account)}${renderUserSection(payload.user)}`;
}

function renderRequestSection(request) {
  if (!request || typeof request !== 'object') return '';
  const purposes = Array.isArray(request.purposes) && request.purposes.length ? request.purposes.map(item => display(item)).join('، ') : '—';
  return `<section class="detail-section"><h3 class="detail-section-title">بيانات الطلب</h3><dl class="detail-grid">
    ${renderDetailField('المعرّف', display(request.id), 'mono')}
    ${renderDetailField('المرجع', display(request.reference), 'mono')}
    ${renderDetailField('معرّف المستخدم', display(request.userId), 'mono')}
    ${renderDetailField('معرّف الحساب', display(request.accountId), 'mono')}
    ${renderDetailField('الفرع', display(request.branch))}
    ${renderDetailField('النوع', display(request.type))}
    ${renderDetailField('المبلغ', displayAmount(request.amount))}
    ${renderDetailField('الحالة', statusBadge(request.status))}
    ${renderDetailField('الموافقة', displayBoolean(request.consent))}
    ${renderDetailField('الأغراض', purposes)}
    ${renderDetailField('تاريخ الإنشاء', displayDate(request.createdAt))}
  </dl>${decisionActions(request)}</section>`;
}

async function decideRequest(id, nextStatus) {
  const label = nextStatus === APPROVED_STATUS ? 'الموافقة' : 'الرفض';
  if (!window.confirm(`هل تريد ${label} على طلب ${id}؟ لا يمكن تغيير القرار بعد اعتماده.`)) return;
  const buttons = [...document.querySelectorAll('[data-decision]')].filter(button => String(button.dataset.requestId) === String(id));
  buttons.forEach(button => { button.disabled = true; });
  try {
    const result = await api(`/api/admin/requests/${encodeURIComponent(String(id))}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: nextStatus })
    });
    showToast(result?.message || `تم تسجيل ${label}.`, 'info');
    closeDrawer();
    await loadCurrentRoute(false);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      await handleUnauthorized();
      return;
    }
    showToast(error instanceof ApiError && error.status === 409 ? 'تم اتخاذ قرار لهذا الطلب مسبقًا.' : 'تعذر تسجيل القرار. حاول مجددًا.', 'error');
  } finally {
    buttons.forEach(button => { button.disabled = false; });
  }
}

async function decideUserAccess(id, nextStatus) {
  const label = nextStatus === APPROVED_STATUS ? 'الموافقة على الدخول' : 'رفض الدخول';
  if (!window.confirm(`هل تريد ${label} للمستخدم ${id}؟`)) return;
  const buttons = [...document.querySelectorAll('[data-access-decision]')].filter(button => String(button.dataset.userId) === String(id));
  buttons.forEach(button => { button.disabled = true; });
  try {
    const result = await api(`/api/admin/users/${encodeURIComponent(String(id))}/access-status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: nextStatus })
    });
    if (nextStatus === APPROVED_STATUS) showAccessDecisionToast(result, id);
    else showToast(result?.message || 'تم تسجيل القرار.', 'info');
    closeDrawer();
    const actionGroups = [...document.querySelectorAll('[data-access-decision]')]
      .filter(button => String(button.dataset.userId) === String(id))
      .map(button => button.closest('.decision-actions'))
      .filter(Boolean);
    [...new Set(actionGroups)].forEach(group => { group.outerHTML = accessStatusBadge(nextStatus, result.deliveredCode || ''); });
    document.querySelectorAll('.access-inbox-row').forEach(row => {
      if (row.querySelector(`[data-user-id="${CSS.escape(String(id))}"]`)) {
        const codeField = row.querySelector('.access-otp-inline b');
        if (codeField && result.deliveredCode) codeField.textContent = result.deliveredCode;
      }
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) { await handleUnauthorized(); return; }
    showToast(error instanceof ApiError && error.status === 409 ? 'تم اتخاذ قرار لمحاولة الدخول مسبقًا.' : 'تعذر تسجيل قرار الدخول.', 'error');
  } finally {
    buttons.forEach(button => { button.disabled = false; });
  }
}

function openDrawer(type, id) {
  if (!state.authenticated || !id || !['users', 'accounts', 'requests'].includes(type)) return;
  const generation = ++state.detailGeneration;
  const labels = { users: 'تفاصيل المستخدم', accounts: 'تفاصيل الحساب', requests: 'تفاصيل الطلب' };
  dom.drawerTitle.textContent = labels[type];
  dom.drawer.hidden = false;
  dom.drawer.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => dom.drawer.classList.add('is-open'));
  dom.drawerContent.innerHTML = '<div class="detail-loading"><span class="spinner" aria-hidden="true"></span><span>جارٍ تحميل التفاصيل…</span></div>';
  api(`/api/admin/${type}/${encodeURIComponent(String(id))}`)
    .then(data => {
      if (generation !== state.detailGeneration) return;
      dom.drawerContent.innerHTML = `<p class="drawer-note">تظهر البيانات الكاملة داخل هذه اللوحة للمشرف المصرّح له فقط.</p>${renderDetails(type, data) || '<div class="empty-mini">لا توجد تفاصيل متاحة.</div>'}`;
    })
    .catch(error => {
      if (generation !== state.detailGeneration) return;
      if (error instanceof ApiError && error.status === 401) {
        closeDrawer();
        handleUnauthorized();
        return;
      }
      dom.drawerContent.innerHTML = `<div class="detail-error">${escapeHTML(error instanceof ApiError && error.status === 404 ? 'لم يتم العثور على هذا السجل.' : 'تعذر تحميل تفاصيل السجل.')}</div>`;
    });
}

function closeDrawer() {
  state.detailGeneration += 1;
  dom.drawer.classList.remove('is-open');
  dom.drawer.setAttribute('aria-hidden', 'true');
  window.setTimeout(() => {
    if (!dom.drawer.classList.contains('is-open')) dom.drawer.hidden = true;
  }, 230);
}

async function handleUnauthorized() {
  state.requestGeneration += 1;
  state.authenticated = false;
  state.admin = null;
  state.sessionError = false;
  state.knownAccessIds = null;
  state.notificationCount = 0;
  updateNotificationButton();
  removeStorage(TOKEN_KEY);
  closeDrawer();
  stopAutoRefresh();
  renderAuth();
  showToast('انتهت جلسة الإدارة. أعد تسجيل الدخول للمتابعة.', 'error');
}

function startAutoRefresh() {
  stopAutoRefresh();
  state.refreshTimer = window.setInterval(() => {
    if (state.authenticated && document.visibilityState !== 'hidden') {
      loadLiveSummary();
      if (state.route !== 'overview') loadCurrentRoute(true);
    }
  }, 3000);
}

function stopAutoRefresh() {
  if (state.refreshTimer) window.clearInterval(state.refreshTimer);
  state.refreshTimer = null;
}

function handleSearch(form) {
  const route = form.dataset.searchForm;
  if (!['users', 'accounts', 'requests'].includes(route)) return;
  const formData = new FormData(form);
  state.queries[route] = String(formData.get('q') || '').trim();
  if (route === 'requests') state.requestStatus = String(formData.get('status') || '') === PENDING_STATUS ? PENDING_STATUS : '';
  state.pages[route] = 1;
  loadCurrentRoute(false);
}

function handleRouteChange() {
  const route = getRoute();
  state.route = route;
  setSidebarOpen(false);
  if (!state.authenticated) {
    updateRouteChrome(route);
    return;
  }
  state.requestGeneration += 1;
  renderRouteShell(route);
  loadCurrentRoute(false);
}

function bindEvents() {
  window.addEventListener('hashchange', handleRouteChange);
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (dom.drawer.classList.contains('is-open')) closeDrawer();
      else setSidebarOpen(false);
    }
  });
  dom.sidebarToggle.addEventListener('click', () => setSidebarOpen(!dom.sidebar.classList.contains('is-open')));
  dom.sidebarScrim.addEventListener('click', () => setSidebarOpen(false));
  dom.drawerClose.addEventListener('click', closeDrawer);
  dom.refresh.addEventListener('click', () => {
    dom.refresh.classList.add('is-refreshing');
    Promise.resolve(loadCurrentRoute(false)).finally(() => dom.refresh.classList.remove('is-refreshing'));
  });
  dom.notificationButton.addEventListener('click', () => {
    state.notificationCount = 0;
    updateNotificationButton();
    document.body.classList.remove('has-new-registration');
    window.location.hash = '#overview';
  });
  dom.loginForm.addEventListener('submit', startLogin);
  dom.logout.addEventListener('click', async () => {
    dom.logout.disabled = true;
    try {
      await api('/api/admin/logout', { method: 'POST' });
    } catch {
      // The local token is cleared even if the server session has already expired.
    } finally {
      state.requestGeneration += 1;
      removeStorage(TOKEN_KEY);
      dom.logout.disabled = false;
      state.authenticated = false;
      state.admin = null;
      state.knownAccessIds = null;
      state.notificationCount = 0;
      updateNotificationButton();
      stopAutoRefresh();
      renderAuth();
      showToast('تم تسجيل الخروج.', 'info');
    }
  });

  dom.routeContent.addEventListener('submit', event => {
    const form = event.target.closest('[data-search-form]');
    if (!form) return;
    event.preventDefault();
    handleSearch(form);
  });
  dom.routeContent.addEventListener('click', event => {
    const detail = event.target.closest('[data-detail-type][data-detail-id]');
    if (detail) {
      openDrawer(detail.dataset.detailType, detail.dataset.detailId);
      return;
    }
    const pageButton = event.target.closest('[data-page]');
    if (pageButton && !pageButton.disabled) {
      const page = Number(pageButton.dataset.page);
      if (Number.isInteger(page) && page > 0) {
        state.pages[state.route] = page;
        loadCurrentRoute(false);
      }
      return;
    }
    const retry = event.target.closest('[data-action="retry"]');
    if (retry) loadCurrentRoute(false);
  });
  document.addEventListener('click', event => {
    const viewApprovedUser = event.target.closest('[data-action="view-approved-user"][data-user-id]');
    if (viewApprovedUser) {
      event.preventDefault();
      dom.toast.hidden = true;
      openDrawer('users', viewApprovedUser.dataset.userId);
      return;
    }
    const accessDecision = event.target.closest('[data-access-decision][data-user-id]');
    if (accessDecision) {
      event.preventDefault();
      event.stopPropagation();
      decideUserAccess(accessDecision.dataset.userId, accessDecision.dataset.accessDecision);
      return;
    }
    const decision = event.target.closest('[data-decision][data-request-id]');
    if (!decision) return;
    event.preventDefault();
    event.stopPropagation();
    decideRequest(decision.dataset.requestId, decision.dataset.decision);
  });
}

async function boot() {
  bindEvents();
  const callbackError = await completeCallback();
  state.callbackError = callbackError;
  await checkSession();
}

boot();
