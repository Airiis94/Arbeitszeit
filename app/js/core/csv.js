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

/** @param rows Zeilen aus computeAccount (optional gefiltert) */
export function daysToCsv(rows) {
  const header = ['Datum', 'Wochentag', 'Status', 'Tagesart', 'Kommen (gebucht)', 'Gehen (gebucht)', 'Pausen (gebucht)',
    'Arbeitszeit (gebucht)', 'Arbeitszeit (gebucht, Min)', 'Kommen (gestempelt)', 'Gehen (gestempelt)', 'Pausen (gestempelt)',
    'Arbeitszeit (gestempelt)', 'Differenz Tag', 'Korrektur', 'Zeitkonto', 'Notiz'];
  const out = rows.map((r) => [
    fmtDate(r.day, { weekday: false }),
    WEEKDAYS_SHORT[weekdayIndex(r.day)],
    STATUS_LABELS[r.status] || r.status,
    csvCell(r.dayType ? DAY_TYPES[r.dayType]?.label : ''),
    timeOfDay(r.bookedFirst),
    timeOfDay(r.bookedLast),
    r.status === 'empty' ? '' : dur(r.bookedBreakMin),
    r.bookedNetMin == null || (r.status === 'empty' && !r.creditMin) ? '' : dur(r.bookedNetMin),
    r.bookedNetMin ?? '',
    timeOfDay(r.firstStart),
    timeOfDay(r.lastEnd),
    r.status === 'empty' ? '' : dur(r.breakMin + (r.autoBreakMin || 0)),
    r.status === 'empty' ? '' : dur(r.netMin),
    r.effect ? fmtDuration(r.effect, { sign: true }) : '',
    r.correction ? fmtDuration(r.correction, { sign: true }) : '',
    fmtDuration(r.balance, { sign: true }),
    csvCell(r.note || '', { text: true }),
  ]);
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
