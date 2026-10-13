// Zeit- und Datumshilfen. Reine Funktionen, im Browser und in Node nutzbar.
//
// Konventionen:
// - Zeitpunkte sind Epoch-Millisekunden (absolut, zeitzonenunabhängig).
// - Kalendertage sind Schlüssel im Format "YYYY-MM-DD" in lokaler Zeit des Geräts.
// - Dauern sind ganze Minuten (Integer). Es gibt keine Gleitkomma-Dauern.

export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

const DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export const WEEKDAYS_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
export const WEEKDAYS_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
export const MONTHS_LONG = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

const pad = (n) => String(n).padStart(2, '0');

/** Schneidet Sekunden ab: Stempelzeiten werden minutengenau gespeichert (wie eine Uhr sie anzeigt). */
export function floorToMinute(ms) {
  return Math.floor(ms / MINUTE_MS) * MINUTE_MS;
}

/** Lokaler Kalendertag eines Zeitpunkts. */
export function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayKey(now = Date.now()) {
  return dayKey(now);
}

export function parseDayKey(key) {
  const m = DAY_KEY_RE.exec(key || '');
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3] };
}

export function isValidDayKey(key) {
  const p = parseDayKey(key);
  if (!p) return false;
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d));
  return dt.getUTCFullYear() === p.y && dt.getUTCMonth() === p.m - 1 && dt.getUTCDate() === p.d;
}

// Kalenderarithmetik läuft über UTC, damit Sommerzeitwechsel keine Tage verschieben.
function utcFromKey(key) {
  const p = parseDayKey(key);
  if (!p) throw new Error(`Ungültiges Datum: ${key}`);
  return Date.UTC(p.y, p.m - 1, p.d);
}

function keyFromUtc(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(key, n) {
  return keyFromUtc(utcFromKey(key) + n * DAY_MS);
}

export function daysBetween(a, b) {
  return Math.round((utcFromKey(b) - utcFromKey(a)) / DAY_MS);
}

/** 0 = Montag … 6 = Sonntag */
export function weekdayIndex(key) {
  return (new Date(utcFromKey(key)).getUTCDay() + 6) % 7;
}

export function startOfWeek(key) {
  return addDays(key, -weekdayIndex(key));
}

export function monthKey(key) {
  return key.slice(0, 7);
}

export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function firstOfMonth(mk) {
  return `${mk}-01`;
}

export function lastOfMonth(mk) {
  const [y, m] = mk.split('-').map(Number);
  return `${mk}-${pad(daysInMonth(y, m))}`;
}

export function addMonths(mk, n) {
  const [y, m] = mk.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}

export function isLastDayOfMonth(key) {
  return lastOfMonth(monthKey(key)) === key;
}

/** ISO-Kalenderwoche */
export function isoWeek(key) {
  const t = new Date(utcFromKey(key));
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((t - firstThursday) / DAY_MS - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

export function parseTime(str) {
  const m = TIME_RE.exec((str || '').trim());
  if (!m) return null;
  return { h: +m[1], min: +m[2] };
}

/** Lokale Uhrzeit "HH:MM" an einem Kalendertag (optional +n Tage) → Epoch-ms. */
export function localTimestamp(key, hhmm, plusDays = 0) {
  const p = parseDayKey(addDays(key, plusDays));
  const t = parseTime(hhmm);
  if (!p || !t) return null;
  return new Date(p.y, p.m - 1, p.d, t.h, t.min, 0, 0).getTime();
}

export function timeOfDay(ms) {
  if (ms == null) return '';
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Dauer zwischen zwei Zeitpunkten in ganzen Minuten (abgeschnitten). */
export function minutesBetween(startMs, endMs) {
  return Math.floor((endMs - startMs) / MINUTE_MS);
}

/** 470 → "7:50", -20 → "−0:20"; mit sign: true auch "+0:20". */
export function fmtDuration(min, { sign = false } = {}) {
  if (min == null || Number.isNaN(min)) return '–';
  const neg = min < 0;
  const abs = Math.abs(Math.trunc(min));
  const s = `${Math.floor(abs / 60)}:${pad(abs % 60)}`;
  if (neg) return `−${s}`;
  return sign && abs > 0 ? `+${s}` : s;
}

/**
 * Akzeptiert "90", "1:30", "1,5h", "1.5 h", "45 min", "2h". Liefert Minuten oder null.
 * Ein reines "1,5" ohne Einheit wird als Stunden gelesen, ganze Zahlen als Minuten.
 */
export function parseDuration(input) {
  if (input == null) return null;
  let s = String(input).trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  let neg = false;
  if (s.startsWith('-') || s.startsWith('−')) { neg = true; s = s.slice(1); }
  else if (s.startsWith('+')) s = s.slice(1);
  let min = null;
  let m;
  if ((m = /^(\d{1,4}):([0-5]\d)$/.exec(s))) min = +m[1] * 60 + +m[2];
  else if ((m = /^(\d+)(min|m)?$/.exec(s))) min = +m[1];
  else if ((m = /^(\d+(?:[.,]\d+)?)(h|std)?$/.exec(s))) min = Math.round(parseFloat(m[1].replace(',', '.')) * 60);
  else if ((m = /^(\d+)h(\d+)(min|m)?$/.exec(s))) min = +m[1] * 60 + +m[2];
  if (min == null || !Number.isFinite(min)) return null;
  return neg ? -min : min;
}

export function fmtDate(key, { weekday = true, year = true } = {}) {
  const p = parseDayKey(key);
  if (!p) return key;
  const wd = weekday ? `${WEEKDAYS_SHORT[weekdayIndex(key)]}, ` : '';
  return `${wd}${pad(p.d)}.${pad(p.m)}.${year ? p.y : ''}`;
}

export function fmtMonth(mk) {
  const [y, m] = mk.split('-').map(Number);
  return `${MONTHS_LONG[m - 1]} ${y}`;
}

export function fmtDateTime(ms) {
  if (!ms) return '–';
  return `${fmtDate(dayKey(ms))} ${timeOfDay(ms)}`;
}

/** Zeitpunkt als "HH:MM", mit Datumszusatz wenn er nicht auf `refDay` liegt (z. B. Nachtschicht). */
export function fmtTimeRel(ms, refDay) {
  if (ms == null) return '…';
  const k = dayKey(ms);
  if (k === refDay) return timeOfDay(ms);
  const diff = daysBetween(refDay, k);
  if (diff === 1) return `${timeOfDay(ms)} (+1 Tag)`;
  return `${timeOfDay(ms)} (${fmtDate(k, { weekday: false })})`;
}
