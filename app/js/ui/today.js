// Ansicht „Heute“: Stempeluhr, gebuchte Viertelstunden und Zeitkonto der Differenzminuten.

import { h } from './dom.js';
import { computeDay, computeAccount, dayRow } from '../core/calc.js';
import { deriveState } from '../core/state.js';
import { bookDay, suggestLeave } from '../core/booking.js';
import { fmtDuration, fmtDate, timeOfDay, todayKey, fmtDateTime, HOUR_MS } from '../core/time.js';
import { stat, signed, entryList, statusBadge, backupState, issueList, stampText } from './common.js';
import { quickBreak, editBreakDialog, undoToast, toggleStamp } from './editors.js';

const MODE_LABEL = { idle: 'Nicht eingestempelt', working: 'Arbeit läuft', break: 'Pause läuft' };

export async function renderToday(app) {
  const data = await app.load();
  const now = Date.now();
  const today = todayKey(now);
  const { settings } = data;
  const interval = settings.rounding?.interval || 15;
  const st = deriveState(data.intervals);
  const workDay = st.day || today;
  const dayIntervals = data.intervals.filter((i) => i.day === workDay);
  const d = computeDay(dayIntervals, { now, autoBreak: settings.autoBreak });
  const booking = bookDay(dayIntervals, interval);
  const info = data.dayInfos.find((x) => x.day === workDay) || null;
  const acc = computeAccount({ ...data, settings, today, now });
  const row = acc.rowsByDay.get(workDay) || dayRow(workDay, dayIntervals, info, settings, now, interval);

  let phaseInfo = '–';
  if (st.mode === 'working') phaseInfo = `seit ${st.session.day === today ? timeOfDay(st.session.start) : fmtDateTime(st.session.start)}`;
  if (st.mode === 'break') phaseInfo = `Pause seit ${timeOfDay(st.brk.start)} (Arbeit seit ${timeOfDay(st.session.start)})`;
  if (st.mode === 'idle' && d.lastEnd) phaseInfo = `Feierabend um ${timeOfDay(d.lastEnd)}`;

  const warnings = [];
  if (st.mode !== 'idle' && now - st.session.start > 12 * HOUR_MS) {
    warnings.push(h('div', { class: 'notice notice-warn' },
      `Die Arbeitsphase läuft seit über 12 Stunden (${fmtDateTime(st.session.start)}). Feierabend vergessen? `,
      h('a', { href: `#/tag/${st.session.day}` }, 'Jetzt korrigieren')));
  }
  if (acc.problems.length) {
    warnings.push(h('div', { class: 'notice notice-warn' },
      `${acc.problems.length} unvollständige/fehlerhafte Tag(e) – bitte prüfen. `,
      h('a', { href: `#/tag/${acc.problems[0].day}` }, `Ersten öffnen (${fmtDate(acc.problems[0].day, { year: false })})`)));
  }
  if (st.inconsistent) {
    warnings.push(h('div', { class: 'notice notice-error' }, 'Es gibt mehrere offene Buchungen. Bitte im Kalender korrigieren.'));
  }
  const bs = backupState(data.meta, settings, now);
  if (bs.level === 'warn') {
    warnings.push(h('div', { class: 'notice notice-info' }, `${bs.text} `, h('a', { href: '#/einstellungen' }, 'Jetzt sichern')));
  }

  // Aktionen
  const act = (action) => async (ev) => {
    const btn = ev.currentTarget;
    if (app.busy) return;
    app.busy = true;
    btn.disabled = true;
    try {
      const res = await app.repo.clock(action);
      undoToast(app, res.message, res.changes);
      app.afterFirstWrite();
    } catch (e) {
      app.error(e);
    } finally {
      app.busy = false;
      btn.disabled = false;
    }
  };
  const bigBtn = (label, cls, action, testId) => h('button', { type: 'button', class: `btn btn-big ${cls}`, onclick: act(action), 'data-testid': testId }, label);
  let actions;
  if (st.mode === 'idle') {
    actions = [bigBtn(d.sessions.length ? '▶ Weitere Arbeitsphase beginnen' : '▶ Arbeitsbeginn', 'btn-start', 'start', 'btn-start')];
  } else if (st.mode === 'working') {
    actions = [bigBtn('⏸ Pause', 'btn-pause', 'pause', 'btn-pause'), bigBtn('⏹ Feierabend', 'btn-end', 'end', 'btn-end')];
  } else {
    actions = [bigBtn('▶ Pause beenden', 'btn-resume', 'resume', 'btn-resume'), bigBtn('⏹ Feierabend', 'btn-end', 'end', 'btn-end')];
  }

  const quick = h('div', { class: 'quick' },
    h('span', { class: 'quick-label' }, 'Pause nachtragen:'),
    [15, 30, 45, 60].map((m) => h('button', { type: 'button', class: 'chip', onclick: () => quickBreak(app, workDay, m) }, `${m}`)),
    h('button', { type: 'button', class: 'chip', onclick: () => editBreakDialog(app, workDay, null, d.sessions) }, '…'));

  // Arbeitszeit: nach Feierabend die gebuchte (Viertelstunden), während der Arbeit die laufende
  const workTile = booking.bookedNetMin != null && d.sessions.length
    ? stat('Arbeitszeit (gebucht)', h('span', { class: 'num', 'data-testid': 'net' }, fmtDuration(row.bookedNetMin)), `gestempelt ${fmtDuration(d.netMin)}`)
    : stat('Arbeitszeit', h('span', { class: 'num', 'data-testid': 'net' }, fmtDuration(d.netMin)),
      booking.firstBooked != null ? `gebucht ab ${timeOfDay(booking.firstBooked)}` : 'noch nicht eingestempelt');
  const breakTile = booking.bookedNetMin != null && d.sessions.length
    ? stat('Pausen (gebucht)', h('span', { class: 'num', 'data-testid': 'breaks' }, fmtDuration(row.bookedBreakMin)),
      `gestempelt ${fmtDuration(d.breakMin + d.autoBreakMin)}`)
    : stat('Pausen', h('span', { class: 'num', 'data-testid': 'breaks' }, fmtDuration(d.breakMin + d.autoBreakMin)),
      d.openBreak ? `läuft seit ${timeOfDay(d.openBreak.start)}` : `${d.breaks.length} Pause(n)`);

  const stampsInfo = booking.stamps.filter((x) => x.effect !== 0).map((x) => stampText(x, workDay));
  const diffTile = stat('Differenz heute', h('span', { 'data-testid': 'diff' }, signed(booking.effect)),
    stampsInfo.length ? stampsInfo.join(' · ') : 'keine Differenzminuten', { wide: true });

  // Vorschlag zum Ausgleich beim Gehen (nur während der Arbeit)
  let leaveTile = null;
  if (st.mode !== 'idle') {
    const sug = suggestLeave(now, acc.balance, interval);
    if (sug) {
      const rest = acc.balance + sug.effect;
      const text = sug.effect === 0
        ? 'zur vollen Viertelstunde gehen – Konto bleibt ±0'
        : `→ gebucht ${timeOfDay(sug.booked)} (${fmtDuration(sug.effect, { sign: true })})${rest !== 0 ? `, danach Konto ${fmtDuration(rest, { sign: true })}` : ', Konto dann ±0'}`;
      leaveTile = stat('Ausgleichen: gehen um', h('span', { class: 'num', 'data-testid': 'leave' }, timeOfDay(sug.leave)), text, { wide: true });
    }
  }

  const balanceTile = stat('Zeitkonto', h('span', { 'data-testid': 'balance' }, signed(acc.balance)),
    'Differenzminuten zur gebuchten Viertelstunde, inkl. heute', { wide: true });

  return h('section', { class: 'view view-today' },
    h('div', { class: `status-card status-${st.mode}` },
      h('div', { class: 'status-top' },
        h('div', null,
          h('div', { class: 'status-mode', 'data-testid': 'status' }, MODE_LABEL[st.mode]),
          h('div', { class: 'status-since' }, phaseInfo)),
        h('div', { class: 'status-date' }, fmtDate(workDay), h('br'), statusBadge(d.status, info?.dayType))),
      h('div', { class: 'actions' }, actions),
      quick),
    h('div', { class: 'stats' }, workTile, breakTile, diffTile, balanceTile, leaveTile),
    warnings,
    issueList(d.issues.filter((i) => i.code !== 'stale-open')),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h2', null, 'Buchungen'),
        h('a', { class: 'btn btn-small', href: `#/tag/${workDay}` }, 'Tag bearbeiten')),
      entryList(workDay, d, { booking, onToggle: (s) => toggleStamp(app, data.intervals, s) }),
      booking.stamps.some((x) => x.dir !== 'exact')
        ? h('p', { class: 'muted small' }, 'Tipp auf eine Zeit wählt die andere Viertelstunde und verrechnet die Differenz mit dem Zeitkonto.') : null,
      h('div', { class: 'card-foot' },
        h('a', { href: `#/taetigkeiten/${workDay}` }, 'Tätigkeit erfassen →'))),
  );
}
