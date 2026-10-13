// CSV-Export (Semikolon-getrennt, UTF-8 mit BOM – öffnet direkt korrekt in Excel/LibreOffice).

import { fmtDuration, fmtDate, timeOfDay, WEEKDAYS_SHORT, weekdayIndex } from './time.js';
import { STATUS_LABELS } from './calc.js';
import { DAY_TYPES } from './model.js';

const BOM = '﻿';

/** Maskiert ein Feld. Textfelder werden gegen Formel-Injektion (=, +, -, @) geschützt. */
export function csvCell(value, { text = false } = {}) {
  if (value == null) return '';
  let s = String(value);
  if (text && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[;"\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(header, rows) {
  return BOM + [header, ...rows].map((r) => r.join(';')).join('\r\n') + '\r\n';
}

const dur = (m) => (m == null ? '' : fmtDuration(m));

/** @param rows Zeilen aus computeAccount (optional gefiltert), @param infoByDay Map Tag → dayInfo */
export function daysToCsv(rows, infoByDay = new Map()) {
  const header = ['Datum', 'Wochentag', 'Status', 'Tagesart', 'Beginn', 'Ende', 'Anwesenheit', 'Pausen', 'Auto-Pause',
    'Netto', 'Netto (Min)', 'Soll', 'Rest Vortag', 'Angerechnet', 'Rest danach', 'Verfallen', 'Tagesdifferenz',
    'Korrektur', 'Monatsabschluss Gutschrift', 'Saldo', 'Notiz'];
  const out = rows.map((r) => {
    const info = infoByDay.get(r.day);
    return [
      fmtDate(r.day, { weekday: false }),
      WEEKDAYS_SHORT[weekdayIndex(r.day)],
      STATUS_LABELS[r.status] || r.status,
      csvCell(r.dayType ? DAY_TYPES[r.dayType]?.label : ''),
      timeOfDay(r.firstStart),
      timeOfDay(r.lastEnd),
      dur(r.grossMin),
      dur(r.breakMin),
      dur(r.autoBreakMin),
      dur(r.netMin),
      r.netMin ?? '',
      dur(r.target),
      r.counted ? dur(r.carryIn) : '',
      r.counted ? dur(r.credited) : '',
      dur(r.carryOut),
      r.forfeited || r.flushForfeit ? dur(r.forfeited + r.flushForfeit) : '',
      r.counted ? fmtDuration(r.diff, { sign: true }) : '',
      r.correction ? fmtDuration(r.correction, { sign: true }) : '',
      r.flushCredit ? dur(r.flushCredit) : '',
      fmtDuration(r.balance, { sign: true }),
      csvCell(info?.note || '', { text: true }),
    ];
  });
  return toCsv(header, out);
}

export function activitiesToCsv(activities) {
  const header = ['Datum', 'Bezeichnung', 'Beschreibung', 'Dauer (Min)', 'Dauer', 'Intensität', 'Kategorie'];
  const out = activities
    .filter((a) => !a.deleted)
    .sort((a, b) => a.day.localeCompare(b.day) || a.createdAt - b.createdAt)
    .map((a) => [
      fmtDate(a.day, { weekday: false }),
      csvCell(a.title, { text: true }),
      csvCell(a.description || '', { text: true }),
      a.minutes,
      fmtDuration(a.minutes),
      csvCell(a.intensity || ''),
      csvCell(a.category || '', { text: true }),
    ]);
  return toCsv(header, out);
}
