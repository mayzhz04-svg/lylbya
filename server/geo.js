// تحديد دولة الزائر من اتصاله: ترويسة Cloudflare إن وُجدت، ثم بحث جغرافي عبرIP مع تخزين مؤقت قصير.
const ARABIC_NAMES = {
  LY: 'ليبيا', TN: 'تونس', EG: 'مصر', DZ: 'الجزائر', MA: 'المغرب', SD: 'السودان', MR: 'موريتانيا',
  SA: 'السعودية', AE: 'الإمارات', QA: 'قطر', KW: 'الكويت', BH: 'البحرين', OM: 'عُمان', YE: 'اليمن',
  JO: 'الأردن', PS: 'فلسطين', LB: 'لبنان', SY: 'سوريا', IQ: 'العراق', TR: 'تركيا', IR: 'إيران',
  IL: 'فلسطين', PK: 'باكستان', IN: 'الهند', BD: 'بنغلاديش', AF: 'أفغانستان', ID: 'إندونيسيا',
  MY: 'ماليزيا', CN: 'الصين', JP: 'اليابان', KR: 'كوريا الجنوبية', TH: 'تايلاند', PH: 'الفلبين',
  VN: 'فيتنام', SG: 'سنغافورة', AU: 'أستراليا', NZ: 'نيوزيلندا', GB: 'بريطانيا', IE: 'أيرلندا',
  FR: 'فرنسا', DE: 'ألمانيا', IT: 'إيطاليا', ES: 'إسبانيا', PT: 'البرتغال', GR: 'اليونان',
  MT: 'مالطا', NL: 'هولندا', BE: 'بلجيكا', LU: 'لوكسمبورغ', CH: 'سويسرا', AT: 'النمسا',
  SE: 'السويد', NO: 'النرويج', DK: 'الدنمارك', FI: 'فنلندا', IS: 'آيسلندا', PL: 'بولندا',
  CZ: 'تشيكيا', SK: 'سلوفاكيا', HU: 'المجر', RO: 'رومانيا', BG: 'بلغاريا', RS: 'صربيا',
  HR: 'كرواتيا', SI: 'سلوفينيا', UA: 'أوكرانيا', BY: 'بيلاروسيا', MD: 'مولدوفا', RU: 'روسيا',
  CA: 'كندا', US: 'أمريكا', MX: 'المكسيك', BR: 'البرازيل', AR: 'الأرجنتين', CL: 'تشيلي',
  CO: 'كولومبيا', PE: 'بيرو', NG: 'نيجيريا', GH: 'غانا', KE: 'كينيا', ET: 'إثيوبيا',
  SO: 'الصومال', DJ: 'جيبوتي', TZ: 'تنزانيا', UG: 'أوغندا', ZA: 'جنوب أفريقيا', ZM: 'زامبيا',
 ZW: 'زيمبابوي', CM: 'الكاميرون', SN: 'السنغال', CI: 'ساحل العاج', ML: 'مالي', TD: 'تشاد',
  ER: 'إريتريا', CF: 'جمهورية أفريقيا الوسطى', GA: 'الغابون', AO: 'أنغولا', MZ: 'موزمبيق'
};

const memory = new Map();
const CACHE_MS = 6 * 60 * 60 * 1000;
const MAX_ENTRIES = 4000;

export function clientIp(req) {
  const direct = String(req.headers['cf-connecting-ip'] || '').trim();
  if (direct) return direct.slice(0, 45);
  const chain = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (chain) return chain.slice(0, 45);
  return String(req.socket?.remoteAddress || req.ip || '').replace(/^::ffff:/, '').slice(0, 45);
}

export function headerCountry(req) {
  const code = String(req.headers['cf-ipcountry'] || '').toUpperCase();
  return /^[A-Z]{2}$/.test(code) && code !== 'XX' && code !== 'T1' ? code : '';
}

export function countryLabel(code, fallbackName = '') {
  const upper = String(code || '').toUpperCase();
  return ARABIC_NAMES[upper] || String(fallbackName || '').trim() || (upper ? `دولة ${upper}` : '');
}

async function fetchJson(url, timeoutMs = 2200) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function lookup(ip) {
  if (!ip || ip === '127.0.0.1' || ip === '::1' || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) return null;
  const cached = memory.get(ip);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const first = await fetchJson(`https://ipapi.co/${encodeURIComponent(ip)}/json/`);
  let value = first?.country_code && !first.error ? {
    code: String(first.country_code).toUpperCase(),
    name: String(first.country_name || ''),
    city: String(first.city || '')
  } : null;
  if (!value) {
    const second = await fetchJson(`https://ipwho.is/${encodeURIComponent(ip)}`);
    if (second?.success !== false && second?.country_code) {
      value = { code: String(second.country_code).toUpperCase(), name: String(second.country || ''), city: String(second.city || '') };
    }
  }
  if (memory.size > MAX_ENTRIES) memory.clear();
  if (value) memory.set(ip, { value, at: Date.now() });
  return value;
}

export async function resolveLocation(req) {
  const ip = clientIp(req);
  const code = headerCountry(req);
  if (code) {
    const found = await lookup(ip);
    const sameCountry = found && found.code === code;
    return { ip, code, name: countryLabel(code, found?.name || ''), city: sameCountry ? found.city : '' };
  }
  const found = await lookup(ip);
  if (!found) return { ip, code: '', name: '', city: '' };
  return { ip, code: found.code, name: countryLabel(found.code, found.name), city: found.city };
}

export const __testing = { memory, ARABIC_NAMES };
