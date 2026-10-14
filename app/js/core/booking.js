// Buchung auf Viertelstunden und Zeitkonto der Differenzminuten.
//
// Gestempelt wird minutengenau; die echten Zeiten bleiben unverändert gespeichert.
// Für die Zeiterfassung wird jede Stempelzeit auf eine volle Viertelstunde (Raster einstellbar)
// gebucht – standardmäßig auf die nächstgelegene, pro Buchung umschaltbar auf die andere.
// Die Differenz zwischen gestempelter und gebuchter Zeit geht ins Zeitkonto:
//
//   Kommen 08:50 → gebucht 08:45: −5  (gebucht wird mehr Arbeit, als geleistet wurde)
//   Gehen  17:49 → gebucht 17:45: +4  (geleistete Minuten, die nicht gebucht sind)
//   Pause  12:03 → gebucht 12:00: +3   ·   Pausenende 12:31 → gebucht 12:30: −1
//
// Es gibt kein Tagessoll: Das Konto enthält ausschließlich diese Differenzminuten,
// den Anfangssaldo und Korrekturen. Invariante je Tag (ohne automatische Pause):
//   gestempelte Arbeitszeit − gebuchte Arbeitszeit = Σ Differenzen.

import { MINUTE_MS } from './time.js';

export const ROUND_DIRS = ['down', 'up'];
export const GRID_OPTIONS = [5, 10, 15, 20, 30, 60];

/** Erfassungsarten: auf Raster buchen (Standard) oder minutengenau (keine Differenzminuten). */
export const TRACKING_MODES = {
  quarter: 'Viertelstunden + Zeitkonto',
  exact: 'Minutengenau',
};

/** Raster in Minuten für die Berechnung: 1 bei minutengenauer Erfassung, sonst das eingestellte Raster. */
export function bookingInterval(settings) {
  if (settings?.trackingMode === 'exact') return 1;
  return settings?.rounding?.interval || 15;
}

const toGrid = (interval) => (interval === 1 || GRID_OPTIONS.includes(interval) ? interval : 15);

/** Die beiden möglichen Viertelstunden um einen Zeitpunkt (lokale Uhrzeit). */
export function gridOptions(ms, interval = 15) {
  const step = toGrid(interval);
  const base = Math.floor(ms / MINUTE_MS) * MINUTE_MS;
  const d = new Date(base);
  const offset = (d.getHours() * 60 + d.getMinutes()) % step;
  const down = base - offset * MINUTE_MS;
  return { down, up: offset === 0 ? down : down + step * MINUTE_MS, offset, step };
}

/**
 * Bucht einen Zeitpunkt auf das Raster.
 * @param override 'down' | 'up' | null (null = nächstgelegene; bei Gleichstand abwärts)
 * @param chosen frei gewählte gebuchte Zeit (Epoch-ms) – hat Vorrang, außer bei minutengenauer Erfassung
 */
export function bookStamp(ms, override = null, interval = 15, chosen = null) {
  const o = gridOptions(ms, interval);
  if (chosen != null && o.step > 1) {
    const dir = chosen < ms ? 'down' : chosen > ms ? 'up' : 'exact';
    return { booked: chosen, dir, alt: null, altDir: null, manual: chosen !== bookStamp(ms, null, interval).booked, chosen: true };
  }
  if (o.offset === 0) return { booked: o.down, dir: 'exact', alt: null, altDir: null, manual: false };
  const nearest = o.offset * 2 <= o.step ? 'down' : 'up';
  const dir = ROUND_DIRS.includes(override) ? override : nearest;
  const altDir = dir === 'down' ? 'up' : 'down';
  return { booked: o[dir], dir, alt: o[altDir], altDir, manual: dir !== nearest };
}

/** Bucht eine Dauer (Pause ohne Uhrzeit) auf das Raster. @param chosen frei gewählte Dauer (Minuten) */
export function bookDuration(min, override = null, interval = 15, chosen = null) {
  const step = toGrid(interval);
  if (chosen != null && step > 1) {
    const dir = chosen < min ? 'down' : chosen > min ? 'up' : 'exact';
    return { booked: chosen, dir, alt: null, altDir: null, manual: chosen !== bookDuration(min, null, interval).booked, chosen: true };
  }
  const offset = min % step;
  const down = min - offset;
  if (offset === 0) return { booked: min, dir: 'exact', alt: null, altDir: null, manual: false };
  const up = down + step;
  const nearest = offset * 2 <= step ? 'down' : 'up';
  const dir = ROUND_DIRS.includes(override) ? override : nearest;
  const altDir = dir === 'down' ? 'up' : 'down';
  return { booked: dir === 'down' ? Math.max(0, down) : up, dir, alt: altDir === 'down' ? Math.max(0, down) : up, altDir, manual: dir !== nearest };
}

const mins = (ms) => Math.round(ms / MINUTE_MS);

/**
 * Bucht ein Intervall. Liefert gebuchte Zeiten und je Stempel die Kontowirkung (Minuten).
 * Vorzeichen: + = gearbeitete, aber nicht gebuchte Minuten (Guthaben), − = gebucht, aber nicht gearbeitet.
 */
export function bookInterval(rec, interval = 15) {
  const isWork = rec.kind === 'work';
  if (rec.start == null) {
    // Pause nur mit Dauer: längere gebuchte Pause = weniger gebuchte Arbeit → Guthaben
    const b = bookDuration(rec.durationMin || 0, rec.startRound, interval, rec.durationBooked ?? null);
    return {
      rec, start: null, end: null, durationMin: b.booked,
      stamps: [{ recId: rec.id, field: 'start', kind: rec.kind, label: 'Pausendauer', isDuration: true,
        actual: rec.durationMin, ...b, effect: b.booked - (rec.durationMin || 0) }],
    };
  }
  const s = bookStamp(rec.start, rec.startRound, interval, rec.startBooked ?? null);
  const stamps = [{ recId: rec.id, field: 'start', kind: rec.kind, label: isWork ? 'Kommen' : 'Pausenbeginn',
    actual: rec.start, ...s, effect: isWork ? mins(s.booked - rec.start) : mins(rec.start - s.booked) }];
  let end = null;
  if (rec.end != null) {
    const e = bookStamp(rec.end, rec.endRound, interval, rec.endBooked ?? null);
    end = Math.max(e.booked, s.booked); // gebuchtes Ende nie vor gebuchtem Beginn
    stamps.push({ recId: rec.id, field: 'end', kind: rec.kind, label: isWork ? 'Gehen' : 'Pausenende',
      actual: rec.end, ...e, booked: end, effect: isWork ? mins(rec.end - end) : mins(end - rec.end) });
  }
  return { rec, start: s.booked, end, durationMin: null, stamps };
}

/**
 * Bucht einen Tag. @returns { items, stamps, effect, bookedWorkMin, bookedBreakMin, bookedNetMin,
 *   firstBooked, lastBooked, open }
 * bookedNetMin ist null, solange eine Arbeitsphase läuft.
 */
export function bookDay(intervals, interval = 15) {
  const items = intervals.filter((i) => !i.deleted).map((i) => bookInterval(i, interval));
  const stamps = items.flatMap((i) => i.stamps)
    .sort((a, b) => (a.isDuration ? Infinity : a.actual) - (b.isDuration ? Infinity : b.actual));
  let work = 0;
  let brk = 0;
  let open = false;
  let firstBooked = null;
  let lastBooked = null;
  for (const it of items) {
    if (it.rec.kind === 'work') {
      if (it.start != null && (firstBooked == null || it.start < firstBooked)) firstBooked = it.start;
      if (it.end == null) { open = true; continue; }
      work += mins(it.end - it.start);
      if (lastBooked == null || it.end > lastBooked) lastBooked = it.end;
    } else if (it.start == null) brk += it.durationMin;
    else if (it.end != null) brk += mins(it.end - it.start);
  }
  return {
    items,
    stamps,
    effect: stamps.reduce((s, x) => s + x.effect, 0),
    bookedWorkMin: work,
    bookedBreakMin: brk,
    bookedNetMin: open ? null : Math.max(0, work - brk),
    firstBooked,
    lastBooked: open ? null : lastBooked,
    open,
  };
}

/**
 * Nächste Gehzeit ab `now`, mit der sich das Konto möglichst ausgleicht.
 * Bei nächstgelegener Buchung gleicht eine Gehzeit höchstens ±(Raster/2) aus.
 * @returns { leave, booked, effect } – Gehen um `leave` wird als `booked` gebucht und bringt `effect`.
 */
export function suggestLeave(now, balance, interval = 15) {
  const step = toGrid(interval);
  const maxGain = Math.floor(step / 2);
  const want = Math.max(-maxGain, Math.min(maxGain, -balance)); // gewünschte Wirkung
  const base = gridOptions(now, step).down;
  for (let k = 0; k < 3; k += 1) {
    const q = base + k * step * MINUTE_MS;
    const leave = q + want * MINUTE_MS; // want > 0: nach der Viertelstunde gehen, < 0: davor
    if (leave >= Math.floor(now / MINUTE_MS) * MINUTE_MS) return { leave, booked: q, effect: want };
  }
  return null;
}

/**
 * Auswahlmöglichkeiten für die gebuchte Zeit eines Stempels: alle Rastermarken im Bereich
 * ±`rangeMin` um die gestempelte Zeit, jeweils mit Kontowirkung. Die nächstgelegene ist markiert.
 * @param st Stempel aus bookInterval (enthält kind, field, actual, isDuration)
 */
export function stampChoices(st, interval = 15, rangeMin = 120) {
  const step = toGrid(interval);
  if (step <= 1) return [];
  const effectOf = (booked) => {
    if (st.isDuration) return booked - st.actual;
    const delta = mins(booked - st.actual);
    // Kommen und Pausenende: später gebucht = Guthaben; Gehen und Pausenbeginn: früher gebucht = Guthaben
    const positiveWhenLater = (st.kind === 'work' && st.field === 'start') || (st.kind === 'break' && st.field === 'end');
    return positiveWhenLater ? delta : -delta;
  };
  const out = [];
  if (st.isDuration) {
    const nearest = bookDuration(st.actual, null, step).booked;
    for (let m = 0; m <= st.actual + rangeMin; m += step) out.push({ booked: m, effect: effectOf(m), nearest: m === nearest });
    return out;
  }
  const nearest = bookStamp(st.actual, null, step).booked;
  const lo = gridOptions(st.actual - rangeMin * MINUTE_MS, step).down;
  for (let t = lo; t <= st.actual + rangeMin * MINUTE_MS; t += step * MINUTE_MS) {
    // Raster nach lokaler Uhrzeit (Sommerzeit): Marke neu bestimmen
    const q = gridOptions(t, step).down;
    if (!out.length || out[out.length - 1].booked !== q) out.push({ booked: q, effect: effectOf(q), nearest: q === nearest });
  }
  return out;
}
