export const banks = [
  { id: 'lib', ar: 'المصرف الإسلامي الليبي', en: 'Libyan Islamic Bank' },
  { id: 'tadhamon', ar: 'المصرف التضامن', en: 'Tadhamon Bank' },
  { id: 'lfb', ar: 'المصرف الليبي الخارجي', en: 'Libyan Foreign Bank' },
  { id: 'aman', ar: 'مصرف الأمان', en: 'Aman Bank' },
  { id: 'andalus', ar: 'مصرف الأندلس', en: 'Andalus Bank' },
  { id: 'ejmaa', ar: 'مصرف الإجماع العربي', en: 'Ejmaa Bank' },
  { id: 'bcd', ar: 'مصرف التجارة والتنمية', en: 'Bank of Commerce & Development' },
  { id: 'ncb', ar: 'مصرف التجاري الوطني', en: 'National Commercial Bank' },
  { id: 'development', ar: 'مصرف التنمية', en: 'Development Bank' },
  { id: 'jumhouria', ar: 'مصرف الجمهورية', en: 'Jumhouria Bank' },
  { id: 'firstgulf', ar: 'مصرف الخليج الأول', en: 'First Gulf Libyan Bank' },
  { id: 'assaray', ar: 'مصرف السراي', en: 'Assaray Bank' },
  { id: 'sahara', ar: 'مصرف الصحارى', en: 'Sahara Bank' },
  { id: 'ubci', ar: 'مصرف المتحد', en: 'UBCI Bank' },
  { id: 'med', ar: 'مصرف المتوسط', en: 'Meditbank Bank' },
  { id: 'nuran', ar: 'مصرف النوران', en: 'Nuran Bank' },
  { id: 'waha', ar: 'مصرف الواحة', en: 'Waha Bank' },
  { id: 'wehda', ar: 'مصرف الوحدة', en: 'Wehda Bank' },
  { id: 'alwafa', ar: 'مصرف الوفاء', en: 'Alwafa Bank' },
  { id: 'yaqeen', ar: 'مصرف اليقين', en: 'Yaqeen Bank' }
];

export const purposes = ['السياحة الشخصية', 'سياحة الأعمال', 'السياحة بغرض الدراسة', 'الحج والعمرة', 'السياحة الطبية', 'شراء سلع'];
export const demo = { national: '119900000001', passport: 'DEMO1234', phone: '0912000000', iban: 'LY23001000000000000000000' };

const shapes = {
  bank: '<path d="m3 8 9-5 9 5M5 10v9m5-9v9m4-9v9m5-9v9M3 21h18M3 9h18"/>',
  requests: '<rect x="7" y="3" width="13" height="15" rx="1"/><path d="M16 18v3H4V6h3m3 2h7m-7 4h7m-7 4h4"/>',
  money: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M3 10h3m12 4h3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18m-15 6h4"/>',
  person: '<circle cx="12" cy="7" r="3"/><path d="M6 21v-3a6 6 0 0 1 12 0v3"/>',
  phone: '<path d="M5 3h4l2 5-3 2a12 12 0 0 0 6 6l2-3 5 2v4c0 3-4 3-9 0S3 8 3 5q0-2 2-2Z"/>',
  id: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8" cy="10" r="2"/><path d="M5 16a3 3 0 0 1 6 0m3-7h4m-4 4h4"/>',
  passport: '<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="11" r="4"/><path d="M8 11h8m-4-4v8m-2 3h4"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18"/>',
  undo: '<path d="M9 15 4 10l5-5"/><path d="M4 10h9a7 7 0 0 1 7 7v3"/>',
  alert: '<circle cx="12" cy="12" r="10" fill="currentColor" stroke="none"/><path d="M12 6v7m0 3v1" stroke="white" stroke-width="2"/>'
};
export function icon(name, extra = '') {
  return `<svg class="icon ${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name] || shapes.bank}</svg>`;
}
export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
export function bankById(id) { return banks.find(bank => bank.id === id) || banks[0]; }
