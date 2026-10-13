// Datenmodell: Datensatz-Fabriken, Standardwerte, Konstanten.
// Siehe docs/DATENMODELL.md für die vollständige Beschreibung.

import { todayKey } from './time.js';

export const APP_VERSION = '1.0.0';
/** Version des Datenformats (IndexedDB-Schema und Backup-Format). */
export const SCHEMA_VERSION = 1;

export const COLLECTIONS = ['intervals', 'dayInfos', 'activities', 'corrections', 'audit'];

export const INTERVAL_KINDS = ['work', 'break'];
export const SOURCES = ['clock', 'manual'];
export const INTENSITIES = ['niedrig', 'mittel', 'hoch'];

/** Tagesarten (nur zur Kennzeichnung, z. B. im Kalender und im Ausbildungsnachweis). */
export const DAY_TYPES = {
  arbeit: { label: 'Arbeitstag' },
  urlaub: { label: 'Urlaub' },
  krank: { label: 'Krank' },
  feiertag: { label: 'Feiertag' },
  frei: { label: 'Frei' },
  ausgleich: { label: 'Freizeitausgleich' },
  schule: { label: 'Berufsschule' },
};

export function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Jeder synchronisierbare Datensatz trägt ID, Revision, Zeitstempel und ein Löschkennzeichen (Tombstone). */
export function newRecord(fields, now = Date.now()) {
  return { id: uuid(), createdAt: now, updatedAt: now, rev: 1, deleted: false, ...fields };
}

/** Neue Revision eines Datensatzes. updatedAt steigt streng monoton. */
export function touch(rec, changes, now = Date.now()) {
  return { ...rec, ...changes, updatedAt: Math.max(now, (rec.updatedAt || 0) + 1), rev: (rec.rev || 0) + 1 };
}

export function newInterval({ kind, day, start = null, end = null, durationMin = null, source = 'manual', note = '' }, now) {
  return newRecord({ kind, day, start, end, durationMin, source, note }, now);
}

export const DEFAULT_AUTO_BREAK_RULES = [
  { afterMin: 6 * 60, breakMin: 30 },
  { afterMin: 9 * 60, breakMin: 45 },
];

export function defaultSettings(today = todayKey()) {
  return {
    accountStart: today,
    startBalanceMin: 0,
    // Raster der gebuchten Zeiten in Minuten (15 = Viertelstunde)
    rounding: { interval: 15 },
    autoBreak: { enabled: false, rules: DEFAULT_AUTO_BREAK_RULES.map((r) => ({ ...r })) },
    theme: 'system',
    backupReminderDays: 7,
    // Angaben für den Ausbildungsnachweis (Excel-Export)
    report: { name: '', trainingStart: null },
    updatedAt: 0,
  };
}

/** Ergänzt fehlende Felder (z. B. nach Import aus älterer Version) mit Standardwerten. */
export function normalizeSettings(s, today = todayKey()) {
  const d = defaultSettings(today);
  const out = { ...d, ...(s || {}) };
  out.rounding = { ...d.rounding, ...(s?.rounding || {}) };
  out.autoBreak = { ...d.autoBreak, ...(s?.autoBreak || {}) };
  out.report = { ...d.report, ...(s?.report || {}) };
  // Felder früherer Versionen (Sollzeit, Arbeitszeitplan, Verrechnungsart) werden nicht mehr verwendet.
  delete out.targetRules;
  delete out.countEmptyDays;
  delete out.rounding.mode;
  delete out.rounding.carryRule;
  return out;
}
