// Ausbildungsnachweis: Wochenblätter im Layout der Vorlage „Ausbildungsnachweise_m_Deckblatt“.
//
// Je Tag: die Tätigkeiten mit Einzelstunden. Spalte „Ausbildungsabteilung & Tagesarbeitszeit“: zuerst je
// Tätigkeit die Abteilung (= Kategorie, in der Zeile der Tätigkeit), direkt darunter je eine Zelle
// „Arbeitszeit 08:45–17:00“ und „Pause 0:30“ – jede Zelle einzeilig. Laufende Tage zählen erst nach Feierabend.
// Mo–Fr haben mindestens 5 Zeilen, Samstag 3 (wie in der Vorlage); bei mehr Einträgen wächst der Block.
// Sonntag erscheint nur, wenn an dem Tag etwas erfasst wurde.

import {
  addDays, startOfWeek, isoWeek, fmtDate, fmtDuration, fmtTimeRel, WEEKDAYS_LONG, daysBetween, parseDayKey, isValidDayKey,
} from './time.js';
import { computeDay, groupByDay, calcAutoBreak } from './calc.js';
import { bookDay, bookingInterval } from './booking.js';
import { DAY_TYPES } from './model.js';
import { buildXlsx, STYLE } from './xlsx.js';

const MIN_ROWS = [5, 5, 5, 5, 5, 3, 3];
// Zeichen je Zeile in „Ausgeführte Arbeiten“ (B:C)
const TEXT_WIDTH = 42;

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

/** Gebuchte Tagesarbeitszeit als einzeilige Zellen: „Arbeitszeit 08:45–17:15“, „Pause 0:30“. */
function workTimes(day, d, booked) {
  if (!d.sessions.length) return null;
  const ranges = booked.items
    .filter((it) => it.rec.kind === 'work' && it.start != null)
    .sort((a, b) => a.start - b.start)
    .map((it) => `${fmtTimeRel(it.start, day)}–${it.end != null ? fmtTimeRel(it.end, day) : '…'}`);
  // mehrere Arbeitsphasen: je Phase eine Zelle, damit jede Zelle einzeilig bleibt
  const out = ranges.map((r, i) => (i === 0 ? `Arbeitszeit ${r}` : `und ${r}`));
  let pause = `Pause ${fmtDuration(booked.bookedBreakMin)}`;
  if (d.status === 'running') pause += ' (läuft)';
  if (d.status === 'incomplete' || d.status === 'conflict') pause += ' (prüfen)';
  out.push(pause);
  return out;
}

/**
 * Daten einer Woche für den Nachweis.
 * @returns {{ weekStart, weekEnd, kw, nr, year, name, days: [{day, label, times: [text]|null, lines:[{text, minutes, dept, info}], netMin}], totalMin }}
 */
export function buildWeekReport({ weekStart, intervals = [], activities = [], dayInfos = [], settings, now = Date.now() }) {
  const ws = startOfWeek(weekStart);
  const byDay = groupByDay(intervals);
  const actsByDay = groupByDay(activities);
  const infoByDay = new Map(dayInfos.filter((x) => !x.deleted).map((x) => [x.day, x]));
  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const day = addDays(ws, i);
    const ivs = byDay.get(day) || [];
    const d = computeDay(ivs, { now, autoBreak: settings.autoBreak });
    const b = bookDay(ivs, bookingInterval(settings));
    // Gebuchte Werte (Viertelstunden); automatische Pause nur, wenn ausdrücklich aktiviert
    const auto = b.bookedNetMin != null && settings.autoBreak?.enabled ? calcAutoBreak(b.bookedNetMin, b.bookedBreakMin, settings.autoBreak.rules) : 0;
    const booked = { items: b.items, bookedBreakMin: b.bookedBreakMin + auto };
    const netMin = b.bookedNetMin == null ? 0 : Math.max(0, b.bookedNetMin - auto);
    const info = infoByDay.get(day);
    const acts = (actsByDay.get(day) || []).sort((a, b) => a.createdAt - b.createdAt);
    const lines = [];
    const times = workTimes(day, d, booked);
    if (info?.dayType && info.dayType !== 'arbeit') lines.push({ text: DAY_TYPES[info.dayType]?.label || info.dayType, minutes: null, dept: '', info: true });
    for (const a of acts) {
      lines.push({ text: a.description ? `${a.title} – ${a.description}` : a.title, minutes: a.minutes, dept: a.category || '', info: false });
    }
    if (i === 6 && !lines.length && !times) continue; // Sonntag nur bei Einträgen
    // Stunden gesamt = Arbeitszeit + Pause (gebucht); erst nach Feierabend, sonst 0
    const breakMin = b.bookedNetMin == null ? 0 : booked.bookedBreakMin;
    const worked = d.sessions.length > 0;
    days.push({ day, label: WEEKDAYS_LONG[i], times, lines, netMin, breakMin, grossMin: netMin + breakMin, worked, minRows: MIN_ROWS[i] });
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
    totalBreakMin: days.reduce((s, x) => s + x.breakMin, 0),
    totalGrossMin: days.reduce((s, x) => s + x.grossMin, 0),
  };
}

const hours = (min) => Math.round((min / 60) * 10000) / 10000;

/**
 * Zeilen eines Tagesblocks (für Excel und Druckansicht gleich): je Zeile Tätigkeit, Einzelstunden und
 * rechte Spalte – zuerst die Abteilung der Tätigkeit dieser Zeile, direkt nach der letzten Tätigkeit je
 * eine Zeile Arbeitszeit und Pause. Mindestens `minRows` Zeilen.
 * @returns [{ text, info, minutes, side: [Text] (höchstens einer), sideInfo }]
 */
export function dayBlockRows(day) {
  const k = day.lines.length;
  const times = day.times || [];
  const n = Math.max(day.minRows, k + times.length, 1);
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    const line = day.lines[i];
    const time = i >= k ? times[i - k] : null;
    const side = line?.dept ? [line.dept] : time ? [time] : [];
    rows.push({ text: line ? line.text : '', info: !!line?.info, minutes: line?.minutes ?? null, side, sideInfo: !!time });
  }
  return rows;
}

/** Ungefähre Zeilenzahl eines umbrechenden Textes bei `width` Zeichen je Zeile. */
const wrapLines = (parts, width) => parts.reduce((s, t) => s + Math.max(1, Math.ceil(t.length / width)), 0);

/**
 * Wandelt einen Wochenbericht in ein Tabellenblatt (Layout der Vorlage, erweitert um
 * „Stunden gesamt“ = Arbeitszeit + Pause, „Pause“ und „Stunden netto“ = reine Arbeitszeit).
 * Die Wochenarbeitszeit ist die Summe der Stunden netto aller Tage.
 */
export function weekSheet(rep, sheetName) {
  const cells = [];
  const merges = [];
  const rowHeights = { 3: 22, 7: 30 };
  const put = (ref, v, style, f) => cells.push({ ref, v, style, f });

  put('C1', `Name: ${rep.name || '____________________________'}`, STYLE.plain);
  merges.push('C1:I1');
  put('A3', `Ausbildungsnachweis Nr. ${rep.nr ?? '______'}`, STYLE.title);
  merges.push('A3:B3');
  put('C3', `für die Woche vom ${fmtDate(rep.weekStart, { weekday: false })} bis ${fmtDate(rep.weekEnd, { weekday: false })}`, STYLE.plain);
  merges.push('C3:I3');
  put('C5', `Ausbildungsjahr: ${rep.year ? `${rep.year}.` : '______'}   (KW ${rep.kw})`, STYLE.plain);
  merges.push('C5:I5');

  put('A7', '', STYLE.header);
  put('B7', 'Ausgeführte Arbeiten, Unterricht, Unterweisungen usw.', STYLE.header);
  put('C7', '', STYLE.header);
  merges.push('B7:C7');
  put('D7', 'Einzel-stunden', STYLE.header);
  put('E7', 'Stunden gesamt', STYLE.header);
  put('F7', 'Pause', STYLE.header);
  put('G7', 'Stunden netto', STYLE.header);
  put('H7', 'Ausbildungsabteilung & Tagesarbeitszeit', STYLE.header);
  put('I7', '', STYLE.header);
  merges.push('H7:I7');

  let r = 8;
  const lastRows = [];
  for (const day of rep.days) {
    const rows = dayBlockRows(day);
    const first = r;
    const last = r + rows.length - 1;
    rows.forEach((line, i) => {
      const row = r + i;
      put(`A${row}`, i === 0 ? day.label : '', STYLE.dayLabel);
      put(`B${row}`, line.text, line.info ? STYLE.info : STYLE.text);
      put(`C${row}`, '', STYLE.text);
      merges.push(`B${row}:C${row}`);
      put(`D${row}`, line.minutes != null ? hours(line.minutes) : '', STYLE.hours);
      put(`E${row}`, '', STYLE.hours);
      put(`F${row}`, '', STYLE.hours);
      put(`G${row}`, '', STYLE.hours);
      put(`H${row}`, line.side[0] || '', line.sideInfo ? STYLE.info : STYLE.text);
      put(`I${row}`, '', STYLE.text);
      merges.push(`H${row}:I${row}`);
      // Rechte Spalte ist immer einzeilig; nur sehr lange Tätigkeiten brechen um (höchstens 4 Zeilen)
      const needed = line.text ? wrapLines([line.text], TEXT_WIDTH) : 1;
      if (needed > 1) rowHeights[row] = 12.75 * Math.min(4, needed);
    });
    merges.push(`A${first}:A${last}`);
    // Tageswerte in der untersten Zeile des Tagesblocks (wie „Gesamtstunden“ in der Vorlage)
    if (day.worked) {
      put(`E${last}`, hours(day.grossMin), STYLE.dayHours);
      put(`F${last}`, hours(day.breakMin), STYLE.dayHours);
    }
    put(`G${last}`, hours(day.netMin), STYLE.totalHours);
    lastRows.push(last);
    r = last + 1;
  }
  const sum = (col) => `SUM(${lastRows.map((x) => `${col}${x}`).join(',')})`;
  put(`B${r}`, 'Summe der Woche', STYLE.weekLabel);
  put(`C${r}`, '', STYLE.weekLabel);
  put(`D${r}`, '', STYLE.weekLabel);
  merges.push(`B${r}:D${r}`);
  put(`E${r}`, hours(rep.totalGrossMin), STYLE.dayHours, sum('E'));
  put(`F${r}`, hours(rep.totalBreakMin), STYLE.dayHours, sum('F'));
  put(`G${r}`, hours(rep.totalMin), STYLE.totalHours, sum('G'));
  rowHeights[r] = 18;
  r += 1;
  put(`B${r}`, 'Wochenarbeitszeit (Summe Stunden netto)', STYLE.weekLabel);
  for (const c of ['C', 'D', 'E', 'F']) put(`${c}${r}`, '', STYLE.weekLabel);
  merges.push(`B${r}:F${r}`);
  put(`G${r}`, hours(rep.totalMin), STYLE.totalHours, sum('G'));
  rowHeights[r] = 20;

  put(`A${r + 2}`, 'Für die Richtigkeit', STYLE.italic);
  put(`A${r + 5}`, '________    _______________________________', STYLE.plain);
  put(`E${r + 5}`, '________    ________________________', STYLE.plain);
  put(`A${r + 6}`, 'Datum               Unterschrift des Auszubildenden', STYLE.small);
  put(`E${r + 6}`, 'Datum               Unterschrift des Ausbilders', STYLE.small);

  return { name: sheetName, cols: [5, 36, 4, 7, 7.5, 7, 7.5, 3, 21], rowHeights, cells, merges };
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

