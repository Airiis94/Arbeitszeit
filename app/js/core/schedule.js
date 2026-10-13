// Arbeitszeitplan (Soll-Beginn, Soll-Ende, feste Pause je Wochentag) und Verrechnung gegen den Plan.
//
// Grundidee: Zu jedem Zeitpunkt t wird verglichen, wie viel laut Plan bis t gearbeitet sein sollte
// (geplante Arbeitszeit bis t, ohne die feste Planpause) und wie viel tatsächlich gearbeitet wurde.
//   Abweichung(t) = Netto bis t − Plan bis t
// Beispiel: Plan ab 08:45, Ankunft 08:47 → um 08:47 ist die Abweichung −0:02. Wer abends 2 Minuten
// länger bleibt, steht wieder bei ±0. Am Tagesende gilt immer: Abweichung = Netto − Soll.

import { localTimestamp, parseTime, weekdayIndex, MINUTE_MS } from './time.js';
import { DAY_TYPES } from './model.js';

const toMin = (hhmm) => {
  const t = parseTime(hhmm);
  return t ? t.h * 60 + t.min : null;
};

/** Planeintrag eines Wochentags: { start, end, breakStart, breakEnd } (Uhrzeiten "HH:MM"; Pause optional). */
export function validateScheduleEntry(e) {
  if (e == null) return [];
  const errors = [];
  const s = toMin(e.start);
  const en = toMin(e.end);
  if (s == null || en == null) errors.push('Beginn und Ende angeben (HH:MM).');
  else if (en <= s) errors.push('Das Ende muss nach dem Beginn liegen.');
  const hasBreak = e.breakStart || e.breakEnd;
  if (hasBreak) {
    const bs = toMin(e.breakStart);
    const be = toMin(e.breakEnd);
    if (bs == null || be == null) errors.push('Pause: Beginn und Ende angeben oder beide leer lassen.');
    else if (be <= bs) errors.push('Das Pausenende muss nach dem Pausenbeginn liegen.');
    else if (s != null && en != null && (bs < s || be > en)) errors.push('Die Pause muss innerhalb der Arbeitszeit liegen.');
  }
  return errors;
}

/** Geplante Netto-Arbeitszeit eines Planeintrags in Minuten. */
export function plannedMinutes(e) {
  if (!e) return 0;
  const s = toMin(e.start);
  const en = toMin(e.end);
  if (s == null || en == null || en <= s) return 0;
  const bs = toMin(e.breakStart);
  const be = toMin(e.breakEnd);
  const brk = bs != null && be != null && be > bs ? be - bs : 0;
  return en - s - brk;
}

function activeRule(day, settings) {
  const rules = [...(settings.targetRules || [])].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  if (!rules.length) return null;
  let rule = rules[0];
  for (const r of rules) if (r.validFrom <= day) rule = r;
  return rule;
}

/**
 * Plan eines Tages oder null (kein Plan hinterlegt, freier Tag, Abwesenheit oder individuelle Sollzeit).
 * Liefert absolute Zeitpunkte: { start, end, breakStart, breakEnd, plannedMin, entry }.
 */
export function scheduleFor(day, settings, dayInfo = null) {
  if (dayInfo && Number.isInteger(dayInfo.targetOverrideMin)) return null;
  if (dayInfo?.dayType && DAY_TYPES[dayInfo.dayType]?.zeroTarget) return null;
  const rule = activeRule(day, settings);
  const entry = rule?.schedule?.[weekdayIndex(day)];
  if (!entry || validateScheduleEntry(entry).length) return null;
  const hasBreak = !!(entry.breakStart && entry.breakEnd);
  return {
    entry,
    start: localTimestamp(day, entry.start),
    end: localTimestamp(day, entry.end),
    breakStart: hasBreak ? localTimestamp(day, entry.breakStart) : null,
    breakEnd: hasBreak ? localTimestamp(day, entry.breakEnd) : null,
    plannedMin: plannedMinutes(entry),
  };
}

const overlap = (a1, a2, b1, b2) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));

/** Laut Plan bis zum Zeitpunkt t zu leistende Arbeitszeit in Minuten. */
export function plannedUntil(plan, t) {
  if (!plan) return 0;
  const upto = Math.min(t, plan.end);
  if (upto <= plan.start) return 0;
  let ms = upto - plan.start;
  if (plan.breakStart != null) ms -= overlap(plan.start, upto, plan.breakStart, plan.breakEnd);
  return Math.floor(ms / MINUTE_MS);
}

/**
 * Abweichung vom Plan zum Zeitpunkt `now` (Minuten, negativ = im Rückstand).
 * @param netSoFar Netto-Arbeitszeit des Tages bis jetzt (aus computeDay mit now)
 */
export function liveDeviation(plan, netSoFar, now) {
  if (!plan) return null;
  return netSoFar - plannedUntil(plan, now);
}

/**
 * Zerlegt die Abweichung eines Tages in nachvollziehbare Posten.
 * Für abgeschlossene Tage gilt: Summe der Posten = Netto − Soll (exakt).
 * @param d Ergebnis von computeDay
 */
export function deviationBreakdown(plan, d, now = Date.now()) {
  if (!plan || d.firstStart == null) return [];
  const items = [];
  const min = (ms) => Math.round(ms / MINUTE_MS);
  items.push({ key: 'start', label: 'Beginn', planned: plan.start, actual: d.firstStart, minutes: min(plan.start - d.firstStart) });
  const end = d.openSession ? null : d.lastEnd;
  // Lücken zwischen Arbeitsphasen zählen wie Pausen
  const sessions = d.sessions.filter((s) => s.start != null).sort((a, b) => a.start - b.start);
  let gaps = 0;
  for (let i = 1; i < sessions.length; i += 1) {
    const prevEnd = sessions[i - 1].end;
    if (prevEnd != null && sessions[i].start > prevEnd) gaps += min(sessions[i].start - prevEnd);
  }
  const plannedBreak = plan.breakStart != null ? min(plan.breakEnd - plan.breakStart) : 0;
  const actualBreaks = d.breakMin + d.autoBreakMin + gaps;
  if (end != null) {
    items.push({ key: 'end', label: 'Ende', planned: plan.end, actual: end, minutes: min(end - plan.end) });
    items.push({ key: 'break', label: 'Pausen', plannedMin: plannedBreak, actualMin: actualBreaks, minutes: plannedBreak - actualBreaks });
    // Rundungsdifferenz durch minutengenaue Einzeldauern (sollte 0 sein) als Ausgleichsposten
    const sum = items.reduce((s, i) => s + i.minutes, 0);
    const exact = d.netMin - plan.plannedMin;
    if (sum !== exact) items.push({ key: 'other', label: 'Sonstiges', minutes: exact - sum });
  } else {
    // Laufender Tag: Pausenabweichung bis jetzt (feste Planpause bis jetzt vs. tatsächliche Pausen)
    const plannedBreakSoFar = plan.breakStart != null ? min(overlap(plan.start, Math.min(now, plan.end), plan.breakStart, plan.breakEnd)) : 0;
    items.push({ key: 'break', label: 'Pausen bisher', plannedMin: plannedBreakSoFar, actualMin: actualBreaks, minutes: plannedBreakSoFar - actualBreaks });
  }
  return items;
}

/**
 * Uhrzeit, zu der man gehen kann, um auf ±0 zu kommen (heute bzw. inklusive Konto).
 * Annahme: Die restliche Planpause wird noch wie geplant genommen.
 * @param deviation Abweichung bis jetzt (Minuten), @param carryIn zusätzlicher Kontostand (Minuten)
 */
export function evenOutTime(plan, deviation, now, carryIn = 0) {
  if (!plan) return null;
  const remainingPlanned = (plan.plannedMin - plannedUntil(plan, now)) * MINUTE_MS;
  const remainingBreak = plan.breakStart != null ? overlap(Math.max(now, plan.start), plan.end, plan.breakStart, plan.breakEnd) : 0;
  const base = Math.max(now, plan.start);
  return base + remainingPlanned + remainingBreak - (deviation + carryIn) * MINUTE_MS;
}
