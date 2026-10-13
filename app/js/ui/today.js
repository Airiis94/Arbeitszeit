// Ansicht „Heute“: Stempeluhr mit den wichtigsten Kennzahlen.

import { h } from './dom.js';
import { computeDay, computeAccount, targetFor } from '../core/calc.js';
import { deriveState } from '../core/state.js';
import { fmtDuration, fmtDate, timeOfDay, todayKey, fmtDateTime, HOUR_MS } from '../core/time.js';
import { stat, signed, entryList, statusBadge, backupState, issueList } from './common.js';
import { quickBreak, editBreakDialog, undoToast } from './editors.js';

const MODE_LABEL = { idle: 'Nicht eingestempelt', working: 'Arbeit läuft', break: 'Pause läuft' };

export async function renderToday(app) {
  const data = await app.load();
  const now = Date.now();
  const today = todayKey(now);
  const { settings } = data;
  const st = deriveState(data.intervals);
  const workDay = st.day || today;
  const dayIntervals = data.intervals.filter((i) => i.day === workDay);
  const d = computeDay(dayIntervals, { now, autoBreak: settings.autoBreak });
  const info = data.dayInfos.find((x) => x.day === workDay) || null;
  const target = targetFor(workDay, settings, info);
  const acc = computeAccount({ ...data, settings, today, now });
  const row = acc.rowsByDay.get(workDay);
  const exactDiff = d.netMin - target;

  // Kennzahlen
  let phaseInfo = '–';
  if (st.mode === 'working') phaseInfo = `seit ${st.session.day === today ? timeOfDay(st.session.start) : fmtDateTime(st.session.start)}`;
  if (st.mode === 'break') phaseInfo = `Pause seit ${timeOfDay(st.brk.start)} (Arbeit seit ${timeOfDay(st.session.start)})`;
  if (st.mode === 'idle' && d.lastEnd) phaseInfo = `Feierabend um ${timeOfDay(d.lastEnd)}`;

  let balanceValue = signed(acc.balance);
  let balanceSub = acc.carry ? `+ ${fmtDuration(acc.carry)} Rest (noch nicht angerechnet)` : 'ohne laufenden Tag';
  if (acc.preview) balanceSub = `inkl. heute vorläufig: ${fmtDuration(acc.preview.balance, { sign: true })}`;
  else if (row?.counted && workDay === today) balanceSub = 'inkl. heute';

  const warnings = [];
  if (st.mode !== 'idle' && now - st.session.start > 12 * HOUR_MS) {
    warnings.push(h('div', { class: 'notice notice-warn' },
      `Die Arbeitsphase läuft seit über 12 Stunden (${fmtDateTime(st.session.start)}). Feierabend vergessen? `,
      h('a', { href: `#/tag/${st.session.day}` }, 'Jetzt korrigieren')));
  }
  if (acc.problems.length) {
    warnings.push(h('div', { class: 'notice notice-warn' },
      `${acc.problems.length} unvollständige/fehlerhafte Tag(e) werden im Zeitkonto nicht gezählt. `,
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

  const pauseSub = d.autoBreakMin ? `inkl. ${fmtDuration(d.autoBreakMin)} automatisch` : `${d.breaks.length} Pause(n)`;
  const creditSub = acc.preview && acc.preview.day === workDay
    ? `angerechnet ${fmtDuration(acc.preview.credited)} → ${fmtDuration(acc.preview.diff, { sign: true })}`
    : row?.counted ? `angerechnet ${fmtDuration(row.credited)} → ${fmtDuration(row.diff, { sign: true })}` : 'exakt (vor Verrechnung)';

  return h('section', { class: 'view view-today' },
    h('div', { class: `status-card status-${st.mode}` },
      h('div', { class: 'status-top' },
        h('div', null,
          h('div', { class: 'status-mode', 'data-testid': 'status' }, MODE_LABEL[st.mode]),
          h('div', { class: 'status-since' }, phaseInfo)),
        h('div', { class: 'status-date' }, fmtDate(workDay), h('br'), statusBadge(d.status, info?.dayType))),
      h('div', { class: 'actions' }, actions),
      quick),
    h('div', { class: 'stats' },
      stat('Arbeitszeit netto', h('span', { class: 'num', 'data-testid': 'net' }, fmtDuration(d.netMin)), `brutto ${fmtDuration(d.grossMin)}`),
      stat('Pausen', h('span', { class: 'num', 'data-testid': 'breaks' }, fmtDuration(d.breakMin + d.autoBreakMin)), pauseSub),
      stat('Soll heute', h('span', { class: 'num' }, fmtDuration(target)), info?.dayType && info.dayType !== 'arbeit' ? info.dayType : null),
      stat('Soll-Ist', h('span', { 'data-testid': 'diff' }, signed(exactDiff)), creditSub),
      stat('Zeitkonto', h('span', { 'data-testid': 'balance' }, balanceValue), balanceSub)),
    warnings,
    issueList(d.issues.filter((i) => i.code !== 'stale-open')),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h2', null, 'Buchungen'),
        h('a', { class: 'btn btn-small', href: `#/tag/${workDay}` }, 'Tag bearbeiten')),
      entryList(workDay, d),
      h('div', { class: 'card-foot' },
        h('a', { href: `#/taetigkeiten/${workDay}` }, 'Tätigkeit erfassen →'))),
  );
}
