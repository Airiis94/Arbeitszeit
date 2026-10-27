// „Tag würfeln“: Tätigkeiten eines Tages aus der eigenen Statistik vorschlagen.
// Grundlage sind nur selbst eingetragene Tätigkeiten (gewürfelte tragen source: 'dice' und zählen nicht):
// Wie oft kommt eine Tätigkeit vor (Anteil der Tage) und wie lange dauert sie üblicherweise. Welche
// Tätigkeiten gewürfelt werden dürfen und welcher Zeitraum zählt, steht in den Einstellungen. Gewürfelt wird nach dieser Wahrscheinlichkeit,
// die Dauern orientieren sich an den bisherigen Eingaben und füllen zusammen genau die offene Zeit.
// Es wird nur ein Vorschlag erzeugt – gespeichert wird erst nach Bestätigung, vorhandene Einträge bleiben.

import { addDays } from './time.js';
import { memoryKey } from './memory.js';

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Selbst eingetragen (nicht gewürfelt) und gültig. */
export const isManual = (a) => !a.deleted && a.source !== 'dice' && a.minutes > 0 && !!String(a.title || '').trim();

/**
 * Statistik der selbst eingetragenen Tätigkeiten – ohne den Tag selbst. weeks = 0: gesamter Zeitraum,
 * sonst die `weeks` Wochen vor dem Tag. `excluded`: Schlüssel, die nicht gewürfelt werden sollen.
 * @returns {{ days, templates: [{ key, title, description, category, intensity, daysWith, share, durations, typical }], itemsPerDay, minutesPerDay }}
 */
export function activityStats(activities, day, { weeks = 0, excluded = [] } = {}) {
  const from = weeks > 0 ? addDays(day, -weeks * 7) : '';
  const until = weeks > 0 ? day : '9999-12-31';
  const live = activities.filter((a) => isManual(a) && a.day !== day && a.day >= from && a.day < until);
  const byDay = new Map();
  for (const a of live) {
    if (!byDay.has(a.day)) byDay.set(a.day, []);
    byDay.get(a.day).push(a);
  }
  const days = byDay.size;
  const byKey = new Map();
  for (const [d, list] of byDay) {
    for (const a of list) {
      const key = memoryKey(a);
      let t = byKey.get(key);
      if (!t) {
        t = { key, title: a.title.trim(), description: a.description || '', category: a.category || null, intensity: a.intensity || null, dayset: new Set(), durations: [], last: '' };
        byKey.set(key, t);
      }
      t.dayset.add(d);
      t.durations.push(a.minutes);
      if (d >= t.last) { // Schreibweise und Angaben des letzten Eintrags
        Object.assign(t, { title: a.title.trim(), description: a.description || '', category: a.category || null, intensity: a.intensity || null, last: d });
      }
    }
  }
  const skip = new Set(excluded);
  const templates = [...byKey.values()].filter((t) => !skip.has(t.key)).map((t) => ({
    key: t.key, title: t.title, description: t.description, category: t.category, intensity: t.intensity,
    daysWith: t.dayset.size, share: days ? t.dayset.size / days : 0, durations: t.durations, typical: median(t.durations),
  })).sort((a, b) => b.daysWith - a.daysWith || a.title.localeCompare(b.title));
  const counts = [...byDay.values()].map((l) => l.length);
  const sums = [...byDay.values()].map((l) => l.reduce((s, a) => s + a.minutes, 0));
  return { days, templates, itemsPerDay: median(counts), minutesPerDay: median(sums) };
}

/**
 * Alle selbst eingetragenen Tätigkeiten als Auswahl für die Würfel-Einstellungen (häufigste zuerst).
 * `label`: Bezeichnung – bei gleicher Bezeichnung mit Beschreibung, damit die Einträge unterscheidbar sind.
 */
export function diceCandidates(activities, excluded = []) {
  const skip = new Set(excluded);
  const list = activityStats(activities, '', { weeks: 0 }).templates;
  const count = new Map();
  for (const t of list) count.set(t.title.toLowerCase(), (count.get(t.title.toLowerCase()) || 0) + 1);
  return list.map((t) => ({
    key: t.key, title: t.title, description: t.description, category: t.category, daysWith: t.daysWith, included: !skip.has(t.key),
    label: count.get(t.title.toLowerCase()) > 1 && t.description ? `${t.title} – ${t.description}` : t.title,
  }));
}

/** Gewichtete Auswahl ohne Zurücklegen. */
function pickWeighted(items, weightOf, rng) {
  const total = items.reduce((s, x) => s + weightOf(x), 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i += 1) {
    r -= weightOf(items[i]);
    if (r < 0) return i;
  }
  return items.length - 1;
}

/**
 * Würfelt Tätigkeiten, die zusammen genau `openMin` Minuten ergeben.
 * @param stats       Ergebnis von activityStats
 * @param openMin     noch zu vergebende Minuten des Tages
 * @param exclude     Schlüssel (memoryKey) von Tätigkeiten, die an dem Tag schon erfasst sind
 * @param step        Raster der Dauern (15 = Viertelstunden; bei kleinem Rest feiner)
 * @param rng         Zufallsquelle () => [0,1) – für Tests austauschbar
 * @returns [{ ...template, minutes }]  (leer, wenn keine Statistik vorhanden ist)
 */
export function rollDay(stats, openMin, { exclude = [], step = 15, rng = Math.random } = {}) {
  if (!(openMin > 0)) return [];
  const pool = stats.templates.filter((t) => !exclude.includes(t.key));
  if (!pool.length) return [];
  const grid = openMin >= step ? step : 1;
  // Anzahl der Tätigkeiten: wie an einem typischen Tag, anteilig zur offenen Zeit, mit etwas Streuung
  const perMinute = stats.minutesPerDay > 0 ? stats.itemsPerDay / stats.minutesPerDay : 1 / 120;
  let k = Math.round(openMin * perMinute + (rng() - 0.5) * 1.5);
  k = Math.max(1, Math.min(k, pool.length, Math.floor(openMin / grid)));

  // Tätigkeiten nach Häufigkeit (Anteil der Tage) ziehen, Dauer aus den bisherigen Eingaben
  const left = [...pool];
  const chosen = [];
  for (let i = 0; i < k; i += 1) {
    const idx = pickWeighted(left, (t) => t.daysWith, rng);
    const t = left.splice(idx, 1)[0];
    const sample = t.durations[Math.floor(rng() * t.durations.length)] || t.typical || 60;
    chosen.push({ t, w: Math.max(grid, sample) });
  }

  // auf die offene Zeit skalieren und auf das Raster runden; Rest an die größte Tätigkeit
  const sumW = chosen.reduce((s, c) => s + c.w, 0);
  const out = chosen.map((c) => ({ ...c.t, minutes: Math.max(grid, Math.round((openMin * c.w) / sumW / grid) * grid) }));
  let diff = openMin - out.reduce((s, x) => s + x.minutes, 0);
  out.sort((a, b) => b.minutes - a.minutes);
  for (let i = 0; diff !== 0 && i < 1000; i += 1) {
    const j = i % out.length;
    if (diff > 0) {
      const add = diff >= grid ? grid : diff;
      out[j].minutes += add;
      diff -= add;
    } else if (out[j].minutes - grid >= grid) {
      out[j].minutes -= grid;
      diff += grid;
    } else if (out.every((x) => x.minutes <= grid)) {
      out.pop(); // zu viele Tätigkeiten für die offene Zeit
      diff = openMin - out.reduce((s, x) => s + x.minutes, 0);
    }
  }
  return out;
}

/**
 * Neu würfeln mit festgehaltenen („gelockten“) Tätigkeiten: Diese bleiben unverändert, nur die übrige
 * Zeit wird neu gewürfelt – ohne die gelockten (und an dem Tag schon erfassten) Tätigkeiten doppelt zu ziehen.
 * @param locked [{ key, minutes, … }]
 */
export function rerollDay(stats, openMin, locked = [], { exclude = [], ...opts } = {}) {
  const rest = openMin - locked.reduce((s, x) => s + x.minutes, 0);
  if (rest <= 0) return locked.map((x) => ({ ...x, locked: true }));
  const lockedKeys = locked.map((x) => x.key);
  let more = rollDay(stats, rest, { ...opts, exclude: [...exclude, ...lockedKeys] });
  if (!more.length) more = rollDay(stats, rest, { ...opts, exclude: lockedKeys }); // alles schon am Tag erfasst
  return [...locked.map((x) => ({ ...x, locked: true })), ...more.map((x) => ({ ...x, locked: false }))];
}
