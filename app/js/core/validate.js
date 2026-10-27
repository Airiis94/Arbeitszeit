// Prüfung manueller Änderungen an Arbeitsphasen und Pausen.

import { computeDay } from './calc.js';
import { isValidDayKey, fmtDateTime } from './time.js';

const issueKey = (i) => `${i.code}|${[...i.ids].sort().join(',')}`;

/** Prüft tagesübergreifend, dass sich keine Arbeitsphasen überschneiden und höchstens eine offen ist. */
export function globalIssues(intervals) {
  const sessions = intervals
    .filter((i) => !i.deleted && i.kind === 'work' && i.start != null)
    .sort((a, b) => a.start - b.start);
  const issues = [];
  const open = sessions.filter((s) => s.end == null);
  if (open.length > 1) {
    issues.push({ code: 'multiple-open', severity: 'error', ids: open.map((s) => s.id),
      message: 'Es darf nur eine laufende (offene) Arbeitsphase geben.' });
  }
  for (let i = 1; i < sessions.length; i += 1) {
    const prev = sessions[i - 1];
    const cur = sessions[i];
    if (prev.day !== cur.day && (prev.end == null || prev.end > cur.start)) {
      issues.push({ code: 'overlap-work-days', severity: 'error', ids: [prev.id, cur.id],
        message: `Überschneidung mit der Arbeitsphase vom ${fmtDateTime(prev.start)}.` });
    }
  }
  return issues;
}

function shapeErrors(rec) {
  const e = [];
  if (!['work', 'break'].includes(rec.kind)) e.push('Unbekannte Art.');
  if (!isValidDayKey(rec.day)) e.push('Ungültiger Tag.');
  if (rec.kind === 'work' && rec.start == null) e.push('Eine Arbeitsphase braucht einen Beginn.');
  if (rec.kind === 'break' && rec.start == null && !(Number.isInteger(rec.durationMin) && rec.durationMin > 0)) {
    e.push('Eine Pause braucht Beginn/Ende oder eine Dauer.');
  }
  if (rec.durationMin != null && (!Number.isInteger(rec.durationMin) || rec.durationMin <= 0 || rec.durationMin > 1440)) {
    e.push('Die Pausendauer muss zwischen 1 und 1440 Minuten liegen.');
  }
  if (rec.start != null && rec.end != null && rec.end < rec.start) e.push('Das Ende liegt vor dem Beginn.');
  return e;
}

/**
 * Prüft eine geplante Änderung (neue/geänderte/gelöschte Datensätze) gegen den Bestand.
 * Abgelehnt wird nur, wenn die Änderung NEUE Fehler erzeugt – vorhandene Fehler (z. B. nach
 * einer Zusammenführung) dürfen schrittweise behoben werden.
 * @returns {string[]} Fehlermeldungen (leer = in Ordnung)
 */
export function validateIntervalChange(allIntervals, changed, now = Date.now()) {
  const errors = [];
  for (const rec of changed) if (!rec.deleted) errors.push(...shapeErrors(rec));
  if (errors.length) return errors;

  const before = allIntervals.filter((i) => !i.deleted);
  const changedIds = new Set(changed.map((c) => c.id));
  const after = [...before.filter((i) => !changedIds.has(i.id)), ...changed.filter((c) => !c.deleted)];

  for (const rec of changed) {
    if (!rec.deleted && rec.start != null && rec.start > now + 60 * 1000 && rec.end == null) {
      errors.push('Eine offene Buchung kann nicht in der Zukunft beginnen.');
    }
  }

  const days = new Set();
  for (const c of changed) days.add(c.day);
  for (const c of changed) {
    const old = before.find((i) => i.id === c.id);
    if (old) days.add(old.day);
  }

  const collect = (list) => {
    const keys = new Map();
    for (const day of days) {
      const d = computeDay(list.filter((i) => i.day === day), { now });
      for (const i of d.issues) if (i.severity === 'error') keys.set(issueKey(i), i.message);
    }
    for (const i of globalIssues(list)) keys.set(issueKey(i), i.message);
    return keys;
  };
  const prev = collect(before);
  const next = collect(after);
  for (const [k, msg] of next) if (!prev.has(k)) errors.push(msg);
  return [...new Set(errors)];
}

/**
 * Pausen, die beim Löschen einer Arbeitsphase mitgelöscht werden müssen: Pausen mit Uhrzeit, die in dieser
 * Arbeitsphase liegen; bleibt am Tag keine Arbeitsphase übrig, alle Pausen des Tages (auch „nur Dauer“).
 * Sonst stünden sie ohne Arbeitsphase da und das Löschen würde abgelehnt.
 */
export function breaksOfWork(intervals, work, now = Date.now()) {
  if (!work || work.kind !== 'work') return [];
  const live = intervals.filter((i) => !i.deleted && i.day === work.day && i.id !== work.id);
  const othersLeft = live.some((i) => i.kind === 'work');
  return live.filter((b) => {
    if (b.kind !== 'break') return false;
    if (!othersLeft) return true;
    if (b.start == null || work.start == null) return false;
    const end = b.end ?? Math.max(b.start, now);
    return b.start >= work.start && (work.end == null || end <= work.end);
  });
}
