// Ausbildungsnachweis: Wochenblätter im Layout der Vorlage „Ausbildungsnachweise_m_Deckblatt“.
//
// Je Tag: erste Zeile „Arbeitszeit 08:47–17:02, Pause 0:30“, darunter die Tätigkeiten mit
// Einzelstunden; „Gesamtstunden“ = Netto-Arbeitszeit des Tages; „Ausbildungsabteilung“ = Kategorie.
// Mo–Fr haben mindestens 5 Zeilen, Samstag 3 (wie in der Vorlage); bei mehr Einträgen wächst der Block.
// Sonntag erscheint nur, wenn an dem Tag etwas erfasst wurde.

import {
  addDays, startOfWeek, isoWeek, fmtDate, fmtDuration, fmtTimeRel, WEEKDAYS_LONG, daysBetween, parseDayKey, isValidDayKey,
} from './time.js';
import { computeDay, groupByDay } from './calc.js';
import { DAY_TYPES } from './model.js';
import { buildXlsx, STYLE } from './xlsx.js';

const MIN_ROWS = [5, 5, 5, 5, 5, 3, 3];

/** Nachweis-Nr. = Woche seit Ausbildungsbeginn (1 = Woche des Beginns). */
export function reportNumber(weekStart, trainingStart) {
  if (!isValidDayKey(trainingStart)) return null;
  const n = Math.floor(daysBetween(startOfWeek(trainingStart), weekStart) / 7) + 1;
  return n >= 1 ? n : null;
}

/** Ausbildungsjahr (1, 2, 3 …) zum Wochenbeginn. */
export function trainingYear(weekStart, trainingStart) {
  if (!isValidDayKey(trainingStart) || weekStart < startOfWeek(trainingStart)) return null;
  const a = parseDayKey(trainingStart);
  const b = parseDayKey(weekStart < trainingStart ? trainingStart : weekStart);
  let years = b.y - a.y;
  if (b.m < a.m || (b.m === a.m && b.d < a.d)) years -= 1;
  return Math.max(0, years) + 1;
}

function workLine(day, d) {
  if (!d.sessions.length) return null;
  const ranges = d.sessions
    .filter((s) => s.start != null)
    .map((s) => `${fmtTimeRel(s.start, day)}–${s.end != null ? fmtTimeRel(s.end, day) : '…'}`)
    .join(', ');
  const pause = d.breakMin + d.autoBreakMin;
  let text = `Arbeitszeit ${ranges}, Pause ${fmtDuration(pause)}`;
  if (d.autoBreakMin) text += ` (davon ${fmtDuration(d.autoBreakMin)} automatisch)`;
  if (d.status === 'running') text += ' (läuft noch)';
  if (d.status === 'incomplete' || d.status === 'conflict') text += ' (unvollständig – bitte prüfen)';
  return text;
}

/**
 * Daten einer Woche für den Nachweis.
 * @returns {{ weekStart, weekEnd, kw, nr, year, name, days: [{day, label, lines:[{text, minutes, dept, info}], netMin}], totalMin }}
 */
export function buildWeekReport({ weekStart, intervals = [], activities = [], dayInfos = [], settings, now = Date.now() }) {
  const ws = startOfWeek(weekStart);
  const byDay = groupByDay(intervals);
  const actsByDay = groupByDay(activities);
  const infoByDay = new Map(dayInfos.filter((x) => !x.deleted).map((x) => [x.day, x]));
  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const day = addDays(ws, i);
    const d = computeDay(byDay.get(day) || [], { now, autoBreak: settings.autoBreak });
    const info = infoByDay.get(day);
    const acts = (actsByDay.get(day) || []).sort((a, b) => a.createdAt - b.createdAt);
    const lines = [];
    const wl = workLine(day, d);
    if (wl) lines.push({ text: wl, minutes: null, dept: '', info: true });
    if (info?.dayType && info.dayType !== 'arbeit') lines.push({ text: DAY_TYPES[info.dayType]?.label || info.dayType, minutes: null, dept: '', info: true });
    for (const a of acts) {
      lines.push({ text: a.description ? `${a.title} – ${a.description}` : a.title, minutes: a.minutes, dept: a.category || '', info: false });
    }
    if (i === 6 && !lines.length) continue; // Sonntag nur bei Einträgen
    days.push({ day, label: WEEKDAYS_LONG[i], lines, netMin: d.netMin, minRows: MIN_ROWS[i] });
  }
  const report = settings.report || {};
  return {
    weekStart: ws,
    weekEnd: addDays(ws, days.length === 7 ? 6 : 5),
    kw: isoWeek(ws),
    nr: reportNumber(ws, report.trainingStart),
    year: trainingYear(ws, report.trainingStart),
    name: report.name || '',
    days,
    totalMin: days.reduce((s, x) => s + x.netMin, 0),
  };
}

const hours = (min) => Math.round((min / 60) * 10000) / 10000;

/** Wandelt einen Wochenbericht in ein Tabellenblatt (Layout der Vorlage). */
export function weekSheet(rep, sheetName) {
  const cells = [];
  const merges = [];
  const rowHeights = { 3: 22, 7: 26 };
  const put = (ref, v, style, f) => cells.push({ ref, v, style, f });

  put('C1', `Name: ${rep.name || '____________________________'}`, STYLE.plain);
  merges.push('C1:G1');
  put('A3', `Ausbildungsnachweis Nr. ${rep.nr ?? '______'}`, STYLE.title);
  merges.push('A3:B3');
  put('C3', `für die Woche vom ${fmtDate(rep.weekStart, { weekday: false })} bis ${fmtDate(rep.weekEnd, { weekday: false })}`, STYLE.plain);
  merges.push('C3:G3');
  put('C5', `Ausbildungsjahr: ${rep.year ? `${rep.year}.` : '______'}   (KW ${rep.kw})`, STYLE.plain);
  merges.push('C5:G5');

  put('A7', '', STYLE.header);
  put('B7', 'Ausgeführte Arbeiten, Unterricht, Unterweisungen usw.', STYLE.header);
  put('C7', '', STYLE.header);
  merges.push('B7:C7');
  put('D7', 'Einzel-stunden', STYLE.header);
  put('E7', 'Gesamt-stunden', STYLE.header);
  put('F7', 'Ausbildungsabteilung', STYLE.header);
  put('G7', '', STYLE.header);
  merges.push('F7:G7');

  let r = 8;
  const totalRefs = [];
  for (const day of rep.days) {
    const n = Math.max(day.minRows, day.lines.length);
    const first = r;
    const last = r + n - 1;
    for (let i = 0; i < n; i += 1) {
      const row = r + i;
      const line = day.lines[i];
      put(`A${row}`, i === 0 ? day.label : '', STYLE.dayLabel);
      put(`B${row}`, line ? line.text : '', line?.info ? STYLE.info : STYLE.text);
      put(`C${row}`, '', STYLE.text);
      merges.push(`B${row}:C${row}`);
      put(`D${row}`, line?.minutes != null ? hours(line.minutes) : '', STYLE.hours);
      put(`E${row}`, '', STYLE.hours);
      put(`F${row}`, line?.dept || '', STYLE.text);
      put(`G${row}`, '', STYLE.text);
      merges.push(`F${row}:G${row}`);
      const len = line ? line.text.length : 0;
      if (len > 52) rowHeights[row] = 12.75 * Math.min(4, Math.ceil(len / 52));
    }
    merges.push(`A${first}:A${last}`);
    // Gesamtstunden = Netto-Arbeitszeit des Tages (unterste Zeile des Tagesblocks, wie in der Vorlage)
    put(`E${last}`, hours(day.netMin), STYLE.totalHours);
    totalRefs.push(`E${last}`);
    r = last + 1;
  }
  put(`C${r}`, 'Gesamtstunden', STYLE.rightBold);
  merges.push(`C${r}:D${r}`);
  put(`E${r}`, hours(rep.totalMin), STYLE.totalHours, `SUM(${totalRefs.join(',')})`);
  rowHeights[r] = 18;

  put(`A${r + 2}`, 'Für die Richtigkeit', STYLE.italic);
  put(`A${r + 5}`, '________    _______________________________', STYLE.plain);
  put(`D${r + 5}`, '________    ________________________', STYLE.plain);
  put(`A${r + 6}`, 'Datum               Unterschrift des Auszubildenden', STYLE.small);
  put(`D${r + 6}`, 'Datum               Unterschrift des Ausbilders', STYLE.small);

  return { name: sheetName, cols: [5, 42, 12, 7, 8, 3, 18], rowHeights, cells, merges };
}

/** Alle Wochen (Montag) im Zeitraum [from, to]. */
export function weeksInRange(from, to) {
  const out = [];
  for (let w = startOfWeek(from); w <= to; w = addDays(w, 7)) out.push(w);
  return out;
}

/** Erstellt die Excel-Datei mit einem Blatt pro Woche. @returns {Uint8Array} */
export function buildNachweisXlsx({ from, to, data, now = Date.now() }) {
  const weeks = weeksInRange(from, to);
  if (!weeks.length) throw new Error('Kein Zeitraum gewählt.');
  if (weeks.length > 60) throw new Error('Bitte höchstens 60 Wochen auf einmal exportieren.');
  const multiYear = new Set(weeks.map((w) => w.slice(0, 4))).size > 1;
  const sheets = weeks.map((w) => {
    const rep = buildWeekReport({ weekStart: w, ...data, now });
    const kw = String(rep.kw).padStart(2, '0');
    return weekSheet(rep, multiYear ? `KW${kw} ${w.slice(0, 4)}` : `KW${kw}`);
  });
  return buildXlsx(sheets, { title: 'Ausbildungsnachweis' });
}

