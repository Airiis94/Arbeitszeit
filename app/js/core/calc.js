// Berechnungen: Tageswerte aus Zeitstempeln und Zeitkonto-Verlauf.
// Alles wird bei Bedarf aus den gespeicherten Rohdaten abgeleitet – nichts davon wird gespeichert.

import {
  HOUR_MS, minutesBetween, addDays, timeOfDay, fmtDuration,
} from './time.js';
import { bookDay } from './booking.js';

/** Offene Arbeitsphasen, die länger zurückliegen, gelten als „unvollständig“ (Feierabend vergessen). */
export const RUNNING_MAX_MS = 24 * HOUR_MS;
/** Längere Arbeitsphasen werden als Fehler gewertet. */
export const SESSION_MAX_MS = 24 * HOUR_MS;

export const STATUS_LABELS = {
  empty: 'Keine Buchung',
  complete: 'Vollständig',
  running: 'Läuft',
  incomplete: 'Unvollständig',
  conflict: 'Fehlerhaft',
};

const live = (list) => list.filter((r) => !r.deleted);

function issue(code, message, ids = [], severity = 'error') {
  return { code, message, ids, severity };
}

/**
 * Gesetzlich orientierte automatische Pause (nur wenn ausdrücklich aktiviert).
 * Abgezogen wird höchstens so viel, dass die Arbeitszeit nicht unter die jeweilige Schwelle fällt.
 *   z. B. 6:10 Arbeit ohne Pause → 0:10 Abzug (nicht 0:30), 10:00 ohne Pause → 0:45.
 */
export function calcAutoBreak(workMin, recordedBreakMin, rules) {
  let deduction = 0;
  for (const r of rules || []) {
    if (workMin > r.afterMin) {
      const missing = Math.max(0, r.breakMin - recordedBreakMin);
      deduction = Math.max(deduction, Math.min(missing, workMin - r.afterMin));
    }
  }
  return deduction;
}

/**
 * Berechnet einen Arbeitstag aus seinen Intervallen.
 * @param intervals  Intervalle mit day === dieser Tag
 * @param opts.now   aktueller Zeitpunkt (für laufende Phasen)
 * @param opts.autoBreak  Einstellungen der automatischen Pause
 */
export function computeDay(intervals, { now = Date.now(), autoBreak = null } = {}) {
  const items = live(intervals);
  const sessions = items.filter((i) => i.kind === 'work').sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  const breaks = items.filter((i) => i.kind === 'break');
  const timedBreaks = breaks.filter((b) => b.start != null).sort((a, b) => a.start - b.start);
  const durationBreaks = breaks.filter((b) => b.start == null);
  const issues = [];

  let grossMin = 0;
  let openSession = null;
  let firstStart = null;
  let lastEnd = null;
  let prevEnd = null;
  let prevId = null;

  for (const s of sessions) {
    if (s.start == null) {
      issues.push(issue('missing-start', 'Arbeitsphase ohne Beginn.', [s.id]));
      continue;
    }
    if (prevEnd != null && s.start < prevEnd) {
      issues.push(issue('overlap-work', `Arbeitsphasen überschneiden sich (${timeOfDay(s.start)}).`, [prevId, s.id]));
    }
    if (firstStart == null) firstStart = s.start;
    if (s.end == null) {
      if (openSession) issues.push(issue('multiple-open', 'Mehrere offene Arbeitsphasen.', [openSession.id, s.id]));
      openSession = s;
      grossMin += Math.max(0, minutesBetween(s.start, now));
      prevEnd = Infinity;
    } else {
      if (s.end < s.start) {
        issues.push(issue('end-before-start', `Arbeitsende liegt vor dem Beginn (${timeOfDay(s.start)}).`, [s.id]));
        continue;
      }
      if (s.end - s.start > SESSION_MAX_MS) {
        issues.push(issue('too-long', 'Arbeitsphase länger als 24 Stunden.', [s.id]));
      }
      grossMin += minutesBetween(s.start, s.end);
      prevEnd = Math.max(prevEnd ?? 0, s.end);
      if (lastEnd == null || s.end > lastEnd) lastEnd = s.end;
    }
    prevId = s.id;
  }

  // Pausen
  let breakMin = 0;
  let openBreak = null;
  let prevBreakEnd = null;
  let prevBreakId = null;
  for (const b of timedBreaks) {
    let end = b.end;
    if (end == null) {
      if (openBreak) issues.push(issue('multiple-open-break', 'Mehrere offene Pausen.', [openBreak.id, b.id]));
      openBreak = b;
      end = Math.max(b.start, now);
      if (!openSession) issues.push(issue('open-break-no-session', 'Offene Pause ohne laufende Arbeitsphase.', [b.id]));
    } else if (end < b.start) {
      issues.push(issue('break-end-before-start', `Pausenende liegt vor dem Pausenbeginn (${timeOfDay(b.start)}).`, [b.id]));
      continue;
    }
    // Pause muss vollständig in derselben Arbeitsphase liegen.
    const container = sessions.find((s) => s.start != null && b.start >= s.start && (s.end == null || end <= s.end));
    if (!container) {
      issues.push(issue('break-outside', `Pause ${timeOfDay(b.start)} liegt außerhalb einer Arbeitsphase.`, [b.id]));
    }
    if (prevBreakEnd != null && b.start < prevBreakEnd) {
      issues.push(issue('overlap-break', `Pausen überschneiden sich (${timeOfDay(b.start)}).`, [prevBreakId, b.id]));
    }
    prevBreakEnd = Math.max(prevBreakEnd ?? 0, end);
    prevBreakId = b.id;
    breakMin += minutesBetween(b.start, end);
  }
  for (const b of durationBreaks) {
    if (!Number.isInteger(b.durationMin) || b.durationMin <= 0) {
      issues.push(issue('break-duration', 'Pause ohne gültige Dauer.', [b.id]));
      continue;
    }
    breakMin += b.durationMin;
  }

  let workMin = grossMin - breakMin;
  if (workMin < 0) {
    issues.push(issue('breaks-exceed-work',
      `Pausen (${fmtDuration(breakMin)}) sind länger als die Anwesenheit (${fmtDuration(grossMin)}).`,
      breaks.map((b) => b.id)));
    workMin = 0;
  }
  const autoBreakMin = autoBreak?.enabled ? calcAutoBreak(workMin, breakMin, autoBreak.rules) : 0;
  const netMin = workMin - autoBreakMin;

  let status;
  const hasErrors = issues.some((i) => i.severity === 'error');
  if (sessions.length === 0 && breaks.length === 0) status = 'empty';
  else if (hasErrors) status = 'conflict';
  else if (openSession) status = now - openSession.start <= RUNNING_MAX_MS ? 'running' : 'incomplete';
  else status = 'complete';

  if (status === 'incomplete') {
    issues.push(issue('stale-open', `Arbeitsphase seit ${timeOfDay(openSession.start)} nicht beendet – Feierabend vergessen?`, [openSession.id]));
  }

  return {
    status,
    sessions,
    breaks: [...timedBreaks, ...durationBreaks],
    openSession,
    openBreak,
    firstStart,
    lastEnd: openSession ? null : lastEnd,
    grossMin,
    breakMin,
    autoBreakMin,
    netMin,
    issues,
  };
}

export function groupByDay(records) {
  const map = new Map();
  for (const r of records) {
    if (r.deleted) continue;
    if (!map.has(r.day)) map.set(r.day, []);
    map.get(r.day).push(r);
  }
  return map;
}

/**
 * Zeitkonto-Verlauf vom Kontobeginn bis heute (siehe docs/ZEITKONTO.md).
 *
 * Das Konto enthält ausschließlich die Differenzminuten zwischen gestempelten und auf
 * Viertelstunden gebuchten Zeiten, den Anfangssaldo und Korrekturen. Es gibt kein Tagessoll.
 *   Saldo = Anfangssaldo + Σ Differenzen + Σ Korrekturen
 * Stempel eines laufenden Tages zählen sofort (z. B. Kommen 08:50 → 08:45: −5 direkt beim Kommen).
 */
export function computeAccount({ intervals = [], dayInfos = [], corrections = [], settings, today, now = Date.now() }) {
  const byDay = groupByDay(intervals);
  const infoByDay = new Map(dayInfos.filter((d) => !d.deleted).map((d) => [d.day, d]));
  const corrs = corrections.filter((c) => !c.deleted);
  const start = settings.accountStart || today;
  const interval = settings.rounding?.interval || 15;

  let balance = settings.startBalanceMin || 0;
  let effectTotal = 0;
  let correctionsTotal = 0;
  const corrByDay = new Map();
  let correctionsBeforeStart = 0;
  const futureCorrections = [];
  for (const c of corrs) {
    if (c.day > today) { futureCorrections.push(c); continue; }
    if (c.day < start) { correctionsBeforeStart += c.minutes; continue; }
    corrByDay.set(c.day, (corrByDay.get(c.day) || 0) + c.minutes);
  }
  balance += correctionsBeforeStart;
  correctionsTotal += correctionsBeforeStart;

  const rows = [];
  const problems = [];
  if (start <= today) {
    for (let day = start; day <= today; day = addDays(day, 1)) {
      const row = dayRow(day, byDay.get(day) || [], infoByDay.get(day) || null, settings, now, interval);
      row.correction = corrByDay.get(day) || 0;
      effectTotal += row.effect;
      correctionsTotal += row.correction;
      balance += row.effect + row.correction;
      row.balance = balance;
      if (row.status === 'incomplete' || row.status === 'conflict') problems.push({ day, status: row.status, issues: row.issues });
      rows.push(row);
    }
  }

  return {
    start,
    interval,
    rows,
    rowsByDay: new Map(rows.map((r) => [r.day, r])),
    startBalance: settings.startBalanceMin || 0,
    effectTotal,
    correctionsTotal,
    balance,
    problems,
    futureCorrections,
  };
}

/** Kennzahlen eines Tages: gestempelt (minutengenau) und gebucht (Raster) samt Kontowirkung. */
export function dayRow(day, intervals, info, settings, now = Date.now(), interval = settings.rounding?.interval || 15) {
  const d = computeDay(intervals, { now, autoBreak: settings.autoBreak });
  const b = bookDay(intervals, interval);
  const autoBooked = b.bookedNetMin != null && settings.autoBreak?.enabled
    ? calcAutoBreak(b.bookedNetMin, b.bookedBreakMin, settings.autoBreak.rules) : 0;
  return {
    day,
    status: d.status,
    issues: d.issues,
    dayType: info?.dayType || null,
    note: info?.note || '',
    firstStart: d.firstStart,
    lastEnd: d.lastEnd,
    grossMin: d.grossMin,
    breakMin: d.breakMin,
    autoBreakMin: d.autoBreakMin,
    netMin: d.netMin,
    bookedFirst: b.firstBooked,
    bookedLast: b.lastBooked,
    bookedBreakMin: b.bookedBreakMin + autoBooked,
    bookedNetMin: b.bookedNetMin == null ? null : Math.max(0, b.bookedNetMin - autoBooked),
    stamps: b.stamps,
    effect: b.effect,
    correction: 0,
    balance: null,
  };
}

/** Summen über einen Zeitraum (z. B. Woche/Monat). */
export function summarize(rows) {
  const s = { days: 0, workedDays: 0, netMin: 0, bookedNetMin: 0, breakMin: 0, bookedBreakMin: 0, effect: 0, open: 0 };
  for (const r of rows) {
    s.days += 1;
    s.netMin += r.netMin || 0;
    s.bookedNetMin += r.bookedNetMin || 0;
    s.breakMin += (r.breakMin || 0) + (r.autoBreakMin || 0);
    s.bookedBreakMin += r.bookedBreakMin || 0;
    s.effect += (r.effect || 0) + (r.correction || 0);
    if (r.netMin > 0) s.workedDays += 1;
    if (r.status === 'incomplete' || r.status === 'conflict') s.open += 1;
  }
  return s;
}
