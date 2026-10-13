// Gemeinsame Testhilfen. Alle Tests laufen in der Zeitzone Europe/Berlin (Sommerzeit-Tests!).
process.env.TZ = 'Europe/Berlin';

import { localTimestamp, addDays } from '../../app/js/core/time.js';
import { newInterval, defaultSettings } from '../../app/js/core/model.js';

const T0 = Date.UTC(2026, 0, 1);

/** Arbeitsphase am Tag `day` von "HH:MM" bis "HH:MM" (Ende vor Beginn → Folgetag). */
export function work(day, from, to) {
  const start = localTimestamp(day, from);
  let end = to == null ? null : localTimestamp(day, to);
  if (end != null && end < start) end = localTimestamp(day, to, 1);
  return newInterval({ kind: 'work', day, start, end }, T0);
}

/** Pause mit Uhrzeiten; `nextDay` für Pausen nach Mitternacht in einer Nachtschicht. */
export function pause(day, from, to, nextDay = false) {
  const off = nextDay ? 1 : 0;
  const start = localTimestamp(day, from, off);
  const end = to == null ? null : localTimestamp(day, to, off);
  return newInterval({ kind: 'break', day, start, end }, T0);
}

export function pauseMin(day, minutes) {
  return newInterval({ kind: 'break', day, durationMin: minutes }, T0);
}

/** Standard-Einstellungen ab `start` (Buchungsraster 15 min), optional überschrieben. */
export function settings(start, overrides = {}) {
  const s = defaultSettings(start);
  return { ...s, ...overrides, rounding: { ...s.rounding, ...(overrides.rounding || {}) } };
}

/** Ein kompletter Arbeitstag mit gewünschter Nettozeit (Beginn 08:00, keine Pause). */
export function dayWithNet(day, netMin) {
  const start = localTimestamp(day, '08:00');
  return newInterval({ kind: 'work', day, start, end: start + netMin * 60000 }, T0);
}

export function at(day, hhmm) {
  return localTimestamp(day, hhmm);
}

export { addDays };

