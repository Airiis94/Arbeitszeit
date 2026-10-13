// Backup-Format: Aufbau, Prüfung, Migration und Zusammenführung. Reine Funktionen.
//
// Datei:
// {
//   "format": "arbeitszeit-backup",
//   "schemaVersion": 1,
//   "appVersion": "1.0.0",
//   "exportedAt": "2026-10-13T15:30:00.000Z",
//   "deviceId": "…",
//   "data": { "settings": {…}, "intervals": […], "dayInfos": […], "activities": […],
//             "corrections": […], "audit": […] },
//   "checksum": "sha256:…"   // über JSON.stringify(data)
// }

import { SCHEMA_VERSION, APP_VERSION, COLLECTIONS, INTENSITIES, DAY_TYPES } from './model.js';
import { isValidDayKey } from './time.js';
import { extractBackupJson } from './textreport.js';

export const BACKUP_FORMAT = 'arbeitszeit-backup';

export async function sha256Hex(text) {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function buildBackup({ settings, intervals, dayInfos, activities, corrections, audit }, { deviceId = null, now = Date.now() } = {}) {
  const data = { settings, intervals, dayInfos, activities, corrections, audit };
  return {
    format: BACKUP_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date(now).toISOString(),
    deviceId,
    data,
    checksum: `sha256:${await sha256Hex(JSON.stringify(data))}`,
  };
}

/** Migrationen älterer Backup-Versionen auf die aktuelle Version: MIGRATIONS[v] hebt v-1 → v. */
const MIGRATIONS = {
  // 2: (data) => { …; return data; },
};

export function migrateBackupData(data, fromVersion) {
  let d = data;
  for (let v = fromVersion + 1; v <= SCHEMA_VERSION; v += 1) {
    if (MIGRATIONS[v]) d = MIGRATIONS[v](d);
  }
  return d;
}

const isInt = Number.isInteger;
const isStr = (v) => typeof v === 'string';
const isTs = (v) => v === null || (isInt(v) && v > 0);

function checkBase(r, where, errors) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) { errors.push(`${where}: kein Objekt`); return false; }
  if (!isStr(r.id) || !r.id) errors.push(`${where}: fehlende ID`);
  if (!isInt(r.rev) || r.rev < 1) errors.push(`${where}: ungültige Revision`);
  if (!isInt(r.updatedAt)) errors.push(`${where}: ungültiger Änderungszeitstempel`);
  if (typeof r.deleted !== 'boolean') errors.push(`${where}: fehlendes Löschkennzeichen`);
  return true;
}

const VALIDATORS = {
  intervals(r, w, e) {
    if (!['work', 'break'].includes(r.kind)) e.push(`${w}: unbekannte Art „${r.kind}“`);
    if (!isValidDayKey(r.day)) e.push(`${w}: ungültiger Tag`);
    if (!isTs(r.start) || !isTs(r.end)) e.push(`${w}: ungültiger Zeitstempel`);
    if (r.durationMin != null && (!isInt(r.durationMin) || r.durationMin <= 0)) e.push(`${w}: ungültige Dauer`);
    for (const f of ['startRound', 'endRound']) if (r[f] != null && !['down', 'up'].includes(r[f])) e.push(`${w}: ungültige Buchungsrichtung`);
    if (!r.deleted && r.kind === 'work' && r.start == null) e.push(`${w}: Arbeitsphase ohne Beginn`);
    if (!r.deleted && r.kind === 'break' && r.start == null && r.durationMin == null) e.push(`${w}: Pause ohne Zeit/Dauer`);
  },
  dayInfos(r, w, e) {
    if (!isValidDayKey(r.day)) e.push(`${w}: ungültiger Tag`);
    if (r.dayType != null && !DAY_TYPES[r.dayType]) e.push(`${w}: unbekannte Tagesart`);
    if (r.targetOverrideMin != null && (!isInt(r.targetOverrideMin) || r.targetOverrideMin < 0)) e.push(`${w}: ungültiges Soll`);
  },
  activities(r, w, e) {
    if (!isValidDayKey(r.day)) e.push(`${w}: ungültiger Tag`);
    if (!r.deleted && (!isStr(r.title) || !r.title.trim())) e.push(`${w}: fehlende Bezeichnung`);
    if (!isInt(r.minutes) || r.minutes < 0) e.push(`${w}: ungültige Dauer`);
    if (r.intensity != null && !INTENSITIES.includes(r.intensity)) e.push(`${w}: ungültige Intensität`);
  },
  corrections(r, w, e) {
    if (!isValidDayKey(r.day)) e.push(`${w}: ungültiger Tag`);
    if (!isInt(r.minutes)) e.push(`${w}: ungültige Minuten`);
    if (!r.deleted && (!isStr(r.reason) || !r.reason.trim())) e.push(`${w}: fehlende Begründung`);
  },
  audit(r, w, e) {
    if (!isInt(r.at)) e.push(`${w}: ungültiger Zeitpunkt`);
  },
};

function validateSettings(s, errors) {
  if (!s || typeof s !== 'object') { errors.push('Einstellungen fehlen'); return; }
  if (!isValidDayKey(s.accountStart)) errors.push('Einstellungen: ungültiger Kontobeginn');
  if (!isInt(s.startBalanceMin)) errors.push('Einstellungen: ungültiger Anfangssaldo');
  if (s.rounding != null && (!isInt(s.rounding.interval) || s.rounding.interval < 1 || s.rounding.interval > 240)) {
    errors.push('Einstellungen: ungültiges Buchungsraster');
  }
}

/**
 * Prüft eine eingelesene Backup-Datei (Text). Wirft nie – liefert { ok, errors, warnings, backup }.
 */
export async function parseBackup(text) {
  const errors = [];
  const warnings = [];
  let obj;
  const json = extractBackupJson(text);
  if (json == null) {
    return { ok: false, errors: ['Die Datei enthält keine Sicherungsdaten (weder JSON noch Importdaten-Block einer Text-Sicherung).'], warnings };
  }
  try {
    obj = JSON.parse(json);
  } catch (e) {
    return { ok: false, errors: [`Die Datei ist kein gültiges JSON (${e.message}). Möglicherweise ist sie unvollständig.`], warnings };
  }
  if (!obj || obj.format !== BACKUP_FORMAT) {
    return { ok: false, errors: ['Die Datei ist keine Sicherung dieser App (Kennung „arbeitszeit-backup“ fehlt).'], warnings };
  }
  if (!isInt(obj.schemaVersion) || obj.schemaVersion < 1) {
    return { ok: false, errors: ['Unbekannte Version des Sicherungsformats.'], warnings };
  }
  if (obj.schemaVersion > SCHEMA_VERSION) {
    return { ok: false, errors: [`Die Sicherung stammt aus einer neueren App-Version (Format ${obj.schemaVersion}). Bitte App aktualisieren.`], warnings };
  }
  if (!obj.data || typeof obj.data !== 'object') {
    return { ok: false, errors: ['Die Sicherung enthält keine Daten.'], warnings };
  }

  if (isStr(obj.checksum) && obj.checksum.startsWith('sha256:')) {
    const actual = await sha256Hex(JSON.stringify(obj.data));
    if (`sha256:${actual}` !== obj.checksum) {
      warnings.push('Die Prüfsumme stimmt nicht: Die Datei wurde nach dem Export verändert. Bitte Inhalt prüfen.');
    }
  } else {
    warnings.push('Die Sicherung enthält keine Prüfsumme.');
  }

  const data = migrateBackupData(obj.data, obj.schemaVersion);
  validateSettings(data.settings, errors);
  for (const name of COLLECTIONS) {
    const list = data[name];
    if (list === undefined && name === 'audit') { data.audit = []; continue; }
    if (!Array.isArray(list)) { errors.push(`Bereich „${name}“ fehlt oder ist keine Liste.`); continue; }
    const ids = new Set();
    list.forEach((r, i) => {
      const where = `${name}[${i}]`;
      if (!checkBase(r, where, errors)) return;
      if (ids.has(r.id)) errors.push(`${where}: doppelte ID`);
      ids.add(r.id);
      VALIDATORS[name](r, where, errors);
    });
  }
  if (errors.length > 50) errors.splice(50, errors.length - 50, `… und weitere Fehler`);
  return { ok: errors.length === 0, errors, warnings, backup: { ...obj, data } };
}

export function backupSummary(backup) {
  const d = backup.data;
  const liveCount = (l) => (l || []).filter((r) => !r.deleted).length;
  const days = new Set((d.intervals || []).filter((r) => !r.deleted).map((r) => r.day));
  const sorted = [...days].sort();
  return {
    exportedAt: backup.exportedAt,
    appVersion: backup.appVersion,
    intervals: liveCount(d.intervals),
    days: days.size,
    firstDay: sorted[0] || null,
    lastDay: sorted[sorted.length - 1] || null,
    activities: liveCount(d.activities),
    corrections: liveCount(d.corrections),
  };
}

/**
 * Plant das Zusammenführen einer Sammlung (nach ID).
 *  - neu in der Sicherung        → übernehmen
 *  - identisch                    → nichts tun
 *  - Sicherung neuer (updatedAt)  → übernehmen
 *  - lokal neuer oder gleich alt  → lokal behalten (wird gezählt und angezeigt)
 * Löschungen sind Tombstones (deleted: true) und werden wie Änderungen behandelt.
 */
export function planMerge(local, incoming) {
  const byId = new Map(local.map((r) => [r.id, r]));
  const puts = [];
  const stats = { added: 0, updated: 0, unchanged: 0, keptLocal: 0 };
  for (const r of incoming) {
    const l = byId.get(r.id);
    if (!l) { puts.push(r); stats.added += 1; continue; }
    if (l.rev === r.rev && l.updatedAt === r.updatedAt && JSON.stringify(l) === JSON.stringify(r)) { stats.unchanged += 1; continue; }
    if (r.updatedAt > l.updatedAt) { puts.push(r); stats.updated += 1; } else stats.keptLocal += 1;
  }
  return { puts, stats };
}
