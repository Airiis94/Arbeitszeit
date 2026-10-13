// Zustandsautomat der Stempeluhr. Der Zustand wird ausschließlich aus den gespeicherten
// Intervallen abgeleitet – es gibt keinen separat gespeicherten Status, der abweichen könnte.
//
//   idle ──start──▶ working ──pause──▶ break
//    ▲                │  ▲               │
//    └──────end───────┘  └────resume─────┘
//    ▲                                   │
//    └───────────────end (beendet auch die Pause)

import { floorToMinute, dayKey, timeOfDay, fmtDateTime } from './time.js';
import { newInterval, touch } from './model.js';

export class ClockError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ClockError';
    this.code = code;
  }
}

export const ACTIONS = ['start', 'pause', 'resume', 'end'];

export function deriveState(intervals) {
  const live = intervals.filter((i) => !i.deleted);
  const openSessions = live.filter((i) => i.kind === 'work' && i.start != null && i.end == null);
  const openBreaks = live.filter((i) => i.kind === 'break' && i.start != null && i.end == null);
  const session = openSessions.sort((a, b) => b.start - a.start)[0] || null;
  const brk = session ? openBreaks.find((b) => b.day === session.day) || null : null;
  let mode = 'idle';
  if (session) mode = brk ? 'break' : 'working';
  return {
    mode,
    session,
    brk,
    day: session ? session.day : null,
    inconsistent: openSessions.length > 1 || openBreaks.length > (brk ? 1 : 0),
  };
}

/**
 * Plant eine Stempelaktion. Liefert die zu schreibenden Datensätze (neu oder neue Revision).
 * Wirft ClockError bei unzulässigen Zustandswechseln. Reine Funktion – das Schreiben übernimmt
 * die Datenbankschicht innerhalb derselben Transaktion, in der `intervals` gelesen wurde.
 */
export function planClockAction(intervals, action, now = Date.now()) {
  const stamp = floorToMinute(now);
  const st = deriveState(intervals);
  if (st.inconsistent) {
    throw new ClockError('inconsistent', 'Es gibt mehrere offene Buchungen. Bitte zuerst den Tag im Kalender korrigieren.');
  }
  const puts = [];
  let message = '';

  switch (action) {
    case 'start': {
      if (st.mode !== 'idle') {
        throw new ClockError('already-running',
          `Es läuft bereits eine Arbeitsphase seit ${fmtDateTime(st.session.start)}. Bitte zuerst „Feierabend“ buchen.`);
      }
      const lastEnd = intervals
        .filter((i) => !i.deleted && i.kind === 'work' && i.end != null)
        .reduce((m, i) => Math.max(m, i.end), -Infinity);
      if (lastEnd > stamp) {
        throw new ClockError('overlap',
          `Eine vorhandene Arbeitsphase endet erst ${fmtDateTime(lastEnd)}. Bitte Uhrzeit des Geräts oder die Buchung prüfen.`);
      }
      puts.push(newInterval({ kind: 'work', day: dayKey(stamp), start: stamp, source: 'clock' }, now));
      message = `Arbeitsbeginn ${timeOfDay(stamp)} gebucht.`;
      break;
    }
    case 'pause': {
      if (st.mode === 'idle') throw new ClockError('not-working', 'Pause nicht möglich: Es läuft keine Arbeitsphase.');
      if (st.mode === 'break') throw new ClockError('already-break', `Die Pause läuft bereits seit ${timeOfDay(st.brk.start)}.`);
      if (stamp < st.session.start) throw new ClockError('clock', 'Die Gerätezeit liegt vor dem Arbeitsbeginn.');
      puts.push(newInterval({ kind: 'break', day: st.session.day, start: stamp, source: 'clock' }, now));
      message = `Pause ab ${timeOfDay(stamp)}.`;
      break;
    }
    case 'resume': {
      if (st.mode !== 'break') throw new ClockError('no-break', 'Es läuft keine Pause, die beendet werden könnte.');
      if (stamp < st.brk.start) throw new ClockError('clock', 'Die Gerätezeit liegt vor dem Pausenbeginn.');
      puts.push(touch(st.brk, { end: stamp }, now));
      message = `Pause beendet um ${timeOfDay(stamp)}.`;
      break;
    }
    case 'end': {
      if (st.mode === 'idle') throw new ClockError('not-working', 'Feierabend nicht möglich: Es läuft keine Arbeitsphase.');
      if (stamp < st.session.start) throw new ClockError('clock', 'Die Gerätezeit liegt vor dem Arbeitsbeginn.');
      if (st.mode === 'break') {
        if (stamp < st.brk.start) throw new ClockError('clock', 'Die Gerätezeit liegt vor dem Pausenbeginn.');
        puts.push(touch(st.brk, { end: stamp }, now));
        message = 'Laufende Pause wurde ebenfalls beendet. ';
      }
      puts.push(touch(st.session, { end: stamp }, now));
      message += `Feierabend ${timeOfDay(stamp)} gebucht.`;
      break;
    }
    default:
      throw new ClockError('unknown', `Unbekannte Aktion: ${action}`);
  }
  return { puts, message, stamp };
}
