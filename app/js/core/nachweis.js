// Ausbildungsnachweis: Wochenblätter im Layout der Vorlage „Ausbildungsnachweise_m_Deckblatt“.
//
// Je Tag: links der Wochentag (senkrecht), daneben eine gleich schmale Spalte mit der gebuchten
// Tagesarbeitszeit und Pause (senkrecht, kleine Schrift), dann die Tätigkeiten mit Einzelstunden und
// in der letzten Spalte die Ausbildungsabteilung (= Kategorie). Laufende Tage zählen erst nach Feierabend.
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
// Zeichen je Zeile in „Ausgeführte Arbeiten“ (C:D)
const TEXT_WIDTH = 40;

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

/** Gebuchte Tagesarbeitszeit für die schmale senkrechte Spalte: [„08:45–17:15“, …, „Pause 0:30“]. */
function workTimes(day, d, booked) {
  if (!d.sessions.length) return null;
  const ranges = booked.items
    .filter((it) => it.rec.kind === 'work' && it.start != null)
    .sort((a, b) => a.start - b.start)
    .map((it) => `${fmtTimeRel(it.start, day)}–${it.end != null ? fmtTimeRel(it.end, day) : '…'}`);
  let pause = `Pause ${fmtDuration(booked.bookedBreakMin)}`;
  if (d.status === 'incomplete' || d.status === 'conflict') pause += ' (!)';
  return [...ranges, pause];
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
 * Ausbildungsabteilung. Mindestens `minRows` Zeilen. Die Tagesarbeitszeit steht separat (day.times).
 * @returns [{ text, info, minutes, dept }]
 */
export function dayBlockRows(day) {
  const n = Math.max(day.minRows, day.lines.length, 1);
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    const line = day.lines[i];
    rows.push({ text: line ? line.text : '', info: !!line?.info, minutes: line?.minutes ?? null, dept: line?.dept || '' });
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

  // Spalten: A Tag · B Tagesarbeitszeit (senkrecht) · C:D Tätigkeiten · E Einzelstunden · F Stunden gesamt ·
  // G Pause · H Stunden netto · I:J Ausbildungsabteilung
  put('D1', `Name: ${rep.name || '____________________________'}`, STYLE.plain);
  merges.push('D1:J1');
  put('A3', `Ausbildungsnachweis Nr. ${rep.nr ?? '______'}`, STYLE.title);
  merges.push('A3:C3');
  put('D3', `für die Woche vom ${fmtDate(rep.weekStart, { weekday: false })} bis ${fmtDate(rep.weekEnd, { weekday: false })}`, STYLE.plain);
  merges.push('D3:J3');
  put('D5', `Ausbildungsjahr: ${rep.year ? `${rep.year}.` : '______'}   (KW ${rep.kw})`, STYLE.plain);
  merges.push('D5:J5');

  put('A7', '', STYLE.header);
  put('B7', '', STYLE.header);
  put('C7', 'Ausgeführte Arbeiten, Unterricht, Unterweisungen usw.', STYLE.header);
  put('D7', '', STYLE.header);
  merges.push('C7:D7');
  put('E7', 'Einzel-stunden', STYLE.header);
  put('F7', 'Stunden gesamt', STYLE.header);
  put('G7', 'Pause', STYLE.header);
  put('H7', 'Stunden netto', STYLE.header);
  put('I7', 'Ausbildungsabteilung', STYLE.header);
  put('J7', '', STYLE.header);
  merges.push('I7:J7');

  let r = 8;
  const lastRows = [];
  for (const day of rep.days) {
    const rows = dayBlockRows(day);
    const first = r;
    const last = r + rows.length - 1;
    // Tagesarbeitszeit füllt die schmale Spalte (9 pt); nur kurze Blöcke bzw. mehr als zwei Zeilen kleiner
    const timesStyle = rows.length < 5 || (day.times?.length || 0) > 2 ? STYLE.dayTimesSmall : STYLE.dayTimes;
    rows.forEach((line, i) => {
      const row = r + i;
      put(`A${row}`, i === 0 ? day.label : '', STYLE.dayLabel);
      put(`B${row}`, i === 0 && day.times ? day.times.join('\n') : '', timesStyle);
      put(`C${row}`, line.text, line.info ? STYLE.info : STYLE.text);
      put(`D${row}`, '', STYLE.text);
      merges.push(`C${row}:D${row}`);
      put(`E${row}`, line.minutes != null ? hours(line.minutes) : '', STYLE.hours);
      put(`F${row}`, '', STYLE.hours);
      put(`G${row}`, '', STYLE.hours);
      put(`H${row}`, '', STYLE.hours);
      put(`I${row}`, line.dept, STYLE.text);
      put(`J${row}`, '', STYLE.text);
      merges.push(`I${row}:J${row}`);
      // Nur sehr lange Tätigkeiten brechen um (höchstens 4 Zeilen); sonst alle Zeilen gleich hoch
      const needed = line.text ? wrapLines([line.text], TEXT_WIDTH) : 1;
      if (needed > 1) rowHeights[row] = 12.75 * Math.min(4, needed);
    });
    merges.push(`A${first}:A${last}`, `B${first}:B${last}`);
    // Tageswerte in der untersten Zeile des Tagesblocks (wie „Gesamtstunden“ in der Vorlage)
    if (day.worked) {
      put(`F${last}`, hours(day.grossMin), STYLE.dayHours);
      put(`G${last}`, hours(day.breakMin), STYLE.dayHours);
    }
    put(`H${last}`, hours(day.netMin), STYLE.totalHours);
    lastRows.push(last);
    r = last + 1;
  }
  const sum = (col) => `SUM(${lastRows.map((x) => `${col}${x}`).join(',')})`;
  put(`C${r}`, 'Summe der Woche', STYLE.weekLabel);
  put(`D${r}`, '', STYLE.weekLabel);
  put(`E${r}`, '', STYLE.weekLabel);
  merges.push(`C${r}:E${r}`);
  put(`F${r}`, hours(rep.totalGrossMin), STYLE.dayHours, sum('F'));
  put(`G${r}`, hours(rep.totalBreakMin), STYLE.dayHours, sum('G'));
  put(`H${r}`, hours(rep.totalMin), STYLE.totalHours, sum('H'));
  rowHeights[r] = 18;
  r += 1;
  put(`C${r}`, 'Wochenarbeitszeit (Summe Stunden netto)', STYLE.weekLabel);
  for (const c of ['D', 'E', 'F', 'G']) put(`${c}${r}`, '', STYLE.weekLabel);
  merges.push(`C${r}:G${r}`);
  put(`H${r}`, hours(rep.totalMin), STYLE.totalHours, sum('H'));
  rowHeights[r] = 20;

  put(`A${r + 2}`, 'Für die Richtigkeit', STYLE.italic);
  put(`A${r + 5}`, '________    _______________________________', STYLE.plain);
  put(`F${r + 5}`, '________    ________________________', STYLE.plain);
  put(`A${r + 6}`, 'Datum               Unterschrift des Auszubildenden', STYLE.small);
  put(`F${r + 6}`, 'Datum               Unterschrift des Ausbilders', STYLE.small);

  return { name: sheetName, cols: [5, 5, 35, 3, 7, 7.5, 7, 7.5, 3, 18], rowHeights, cells, merges };
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

