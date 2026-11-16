import { verification } from './ui.js';
import { icon } from './data.js';

export function login() {
  return `<div class="login-shell">
    <header class="login-header"><img src="/assets/login-logo.png" alt="مصرف ليبيا المركزي — CENTRAL BANK OF LIBYA"></header>
    <section class="login-card" aria-label="تسجيل الدخول">
      <aside class="transfer-notice">${icon('money')}<p>يمكنكم الآن حجز حوالات دولية مباشرة للأغراض<br class="notice-break"> التجارية للشركات وصغار التجار.</p></aside>
      <form id="login-form" class="login-form" novalidate>
        <div class="form-field"><label for="national">الرقم الوطني</label><input id="national" name="national" type="text" inputmode="numeric" maxlength="12" placeholder="119000123456" required autocomplete="off" spellcheck="false"></div>
        <div class="form-field"><label for="phone">رقم الهاتف</label><input id="phone" name="phone" type="text" inputmode="tel" maxlength="10" placeholder="09xxxxxxxx" required autocomplete="off" spellcheck="false"></div>
        ${verification('login')}
        <button type="submit" class="button black full-width login-submit">تسجيل الدخول</button>
      </form>
      <p class="login-switch">لا تمتلك حساب؟ <a href="#register">سجل حساب جديد الآن</a></p>
    </section>
    <p class="login-copyright">© 2026 منصة حجز العملة الأجنبية.</p>
  </div>`;
}
