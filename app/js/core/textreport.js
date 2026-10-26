// Lesbare Text-Sicherung: oben die Zeiten als Text (je Tag gebucht/gestempelt, Pausen, Differenz,
// Zeitkonto, Tätigkeiten), unten ein abgetrennter Datenblock (Base64), mit dem die Datei wieder
// importiert werden kann. So ist die Datei für Menschen lesbar und bleibt trotzdem eine vollständige
// Sicherung.

import { fmtDate, fmtDuration, fmtDateTime, fmtTimeRel, todayKey } from './time.js';
import { computeAccount, dayRow, groupByDay, STATUS_LABELS } from './calc.js';
import { bookDay, bookingInterval } from './booking.js';
import { DAY_TYPES, INTENSITIES } from './model.js';

export const DATA_BEGIN = '===== DATEN FÜR DEN IMPORT (bitte nicht verändern) =====';
export const DATA_END = '===== ENDE DER IMPORTDATEN =====';
const DATA_PREFIX = 'AZB1:';

// ---------- Base64 (UTF-8) ----------

export function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return globalThis.btoa(bin);
}

export function fromBase64(b64) {
  const bin = globalThis.atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Holt den JSON-Text einer Sicherung aus einer Datei: entweder reines JSON (.json) oder der
 * Datenblock einer Text-Sicherung (.txt). Liefert null, wenn kein Datenblock gefunden wurde.
 */
export function extractBackupJson(text) {
  const t = String(text).replace(/^﻿/, '');
  if (t.trimStart().startsWith('{')) return t;
  const a = t.indexOf(DATA_BEGIN);
  if (a < 0) return null;
  const b = t.indexOf(DATA_END, a);
  const block = t.slice(a + DATA_BEGIN.length, b < 0 ? undefined : b).replace(/\s+/g, '');
  if (!block.startsWith(DATA_PREFIX)) return null;
  try {
    return fromBase64(block.slice(DATA_PREFIX.length));
  } catch {
    return '';
  }
}

// ---------- Text ----------

const sign = (m) => fmtDuration(m, { sign: true });

function rangeText(items, kind, day) {
  return items
    .filter((it) => it.rec.kind === kind && it.start != null)
    .sort((a, b) => a.start - b.start)
    .map((it) => {
      const booked = `${fmtTimeRel(it.start, day)}–${it.end != null ? fmtTimeRel(it.end, day) : 'läuft'}`;
      const actual = `${fmtTimeRel(it.rec.start, day)}–${it.rec.end != null ? fmtTimeRel(it.rec.end, day) : 'läuft'}`;
      return booked === actual ? booked : `${booked} (gestempelt ${actual})`;
    });
}

/**
 * Erstellt die lesbare Text-Sicherung.
 * @param data { settings, intervals, dayInfos, activities, corrections } (ohne gelöschte Einträge)
 * @param backup vollständiges Sicherungsobjekt (buildBackup) für den Datenblock
 */
export function buildTextBackup({ data, backup, now = Date.now() }) {
  const today = todayKey(now);
  const { settings } = data;
  const interval = bookingInterval(settings);
  const live = (l) => (l || []).filter((r) => !r.deleted);
  const intervals = live(data.intervals);
  const activities = live(data.activities);
  const dayInfos = live(data.dayInfos);
  const corrections = live(data.corrections);
  const acc = computeAccount({ intervals, dayInfos, corrections, settings, today, now });
  const byDay = groupByDay(intervals);
  const actsByDay = groupByDay(activities);
  const infoByDay = new Map(dayInfos.map((d) => [d.day, d]));
  const days = [...new Set([...byDay.keys(), ...actsByDay.keys(), ...dayInfos.filter((d) => d.dayType !== 'arbeit' || d.note).map((d) => d.day)])].sort();

  const out = [];
  out.push(`ARBEITSZEIT – Sicherung vom ${fmtDateTime(now)}`);
  if (settings.report?.name) out.push(`Name: ${settings.report.name}`);
  out.push(days.length ? `Zeitraum: ${fmtDate(days[0])} bis ${fmtDate(days[days.length - 1])} (${days.length} ${days.length === 1 ? 'Tag' : 'Tage'})` : 'Noch keine Einträge.');
  out.push(`Zeitkonto: ${sign(acc.balance)} (Differenzminuten zur gebuchten ${interval === 15 ? 'Viertelstunde' : `${interval}-Minuten-Zeit`}, Kontobeginn ${fmtDate(acc.start)})`);
  out.push('');

  let lastMonth = '';
  for (const day of days) {
    const ivs = byDay.get(day) || [];
    const info = infoByDay.get(day) || null;
    const row = acc.rowsByDay.get(day) || dayRow(day, ivs, info, settings, now, interval);
    const booking = bookDay(ivs, interval);
    const month = day.slice(0, 7);
    if (month !== lastMonth) {
      const [y, m] = month.split('-');
      out.push(`---------------- ${m}/${y} ----------------`);
      lastMonth = month;
    }
    const type = info?.dayType && info.dayType !== 'arbeit' ? ` · ${DAY_TYPES[info.dayType]?.label || info.dayType}` : '';
    const status = row.status !== 'complete' && row.status !== 'empty' ? ` · ${STATUS_LABELS[row.status]}` : '';
    out.push(`${fmtDate(day)}${type}${status}`);
    if (row.creditMin) out.push(`  ${DAY_TYPES[info.dayType]?.label || 'Abwesenheit'} angerechnet: ${fmtDuration(row.creditMin)}${info.creditStart && info.creditEnd ? ` (${info.creditStart}–${info.creditEnd})` : ''}`);
    for (const r of rangeText(booking.items, 'work', day)) out.push(`  Arbeit: ${r}`);
    for (const r of rangeText(booking.items, 'break', day)) out.push(`  Pause:  ${r}`);
    for (const it of booking.items.filter((x) => x.rec.kind === 'break' && x.rec.start == null)) {
      out.push(`  Pause:  ${fmtDuration(it.durationMin)}${it.durationMin !== it.rec.durationMin ? ` (erfasst ${fmtDuration(it.rec.durationMin)})` : ''}`);
    }
    if (ivs.length) {
      const work = row.bookedNetMin == null ? `${fmtDuration(row.netMin)} (läuft)` : fmtDuration(row.bookedNetMin);
      const parts = [`Arbeitszeit ${work}`, `Pausen ${fmtDuration(row.bookedBreakMin)}`];
      if (row.effect) parts.push(`Differenz ${sign(row.effect)}`);
      if (row.correction) parts.push(`Korrektur ${sign(row.correction)}`);
      if (row.balance != null) parts.push(`Zeitkonto ${sign(row.balance)}`);
      out.push(`  ${parts.join(' · ')}`);
    }
    const acts = (actsByDay.get(day) || []).sort((a, b) => a.createdAt - b.createdAt);
    if (acts.length) {
      out.push('  Tätigkeiten:');
      for (const a of acts) {
        const extra = [fmtDuration(a.minutes), a.category, INTENSITIES.includes(a.intensity) ? `Intensität ${a.intensity}` : null].filter(Boolean).join(', ');
        out.push(`    - ${a.title} (${extra})${a.description ? `: ${a.description.replace(/\s+/g, ' ')}` : ''}`);
      }
    }
    if (info?.note) out.push(`  Notiz: ${info.note.replace(/\s+/g, ' ')}`);
    out.push('');
  }

  if (corrections.length) {
    out.push('Korrekturen am Zeitkonto:');
    for (const c of [...corrections].sort((a, b) => a.day.localeCompare(b.day))) out.push(`  ${fmtDate(c.day)}  ${sign(c.minutes)}  ${c.reason}`);
    out.push('');
  }

  out.push('Hinweis: Diese Datei ist auch eine vollständige Sicherung. Zum Wiederherstellen in der App');
  out.push('Einstellungen → „Sicherung importieren …“ wählen und diese Datei auswählen.');
  out.push('');
  out.push(DATA_BEGIN);
  const b64 = DATA_PREFIX + toBase64(JSON.stringify(backup));
  for (let i = 0; i < b64.length; i += 76) out.push(b64.slice(i, i + 76));
  out.push(DATA_END);
  return `${out.join('\r\n')}\r\n`;
}
