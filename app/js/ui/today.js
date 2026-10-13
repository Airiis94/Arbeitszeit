// Ansicht „Heute“: Stempeluhr mit den wichtigsten Kennzahlen.

import { h } from './dom.js';
import { computeDay, computeAccount, targetFor } from '../core/calc.js';
import { deriveState } from '../core/state.js';
import { fmtDuration, fmtDate, timeOfDay, todayKey, fmtDateTime, HOUR_MS } from '../core/time.js';
import { stat, signed, entryList, statusBadge, backupState, issueList } from './common.js';
import { scheduleFor, deviationBreakdown, evenOutTime } from '../core/schedule.js';
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
  const plan = scheduleFor(workDay, settings, info);
  const live = acc.live && acc.live.day === workDay ? acc.live : null;
  // Abweichung heute: abgeschlossener Tag → Netto − Soll; sonst live gegen den Plan bis jetzt
  const todayDev = row?.counted ? row.exactDiff : live?.deviation ?? null;
  const minuteTotal = row?.counted || !live ? acc.minuteBalance : live.minuteBalance;

  // Kennzahlen
  let phaseInfo = '–';
  if (st.mode === 'working') phaseInfo = `seit ${st.session.day === today ? timeOfDay(st.session.start) : fmtDateTime(st.session.start)}`;
  if (st.mode === 'break') phaseInfo = `Pause seit ${timeOfDay(st.brk.start)} (Arbeit seit ${timeOfDay(st.session.start)})`;
  if (st.mode === 'idle' && d.lastEnd) phaseInfo = `Feierabend um ${timeOfDay(d.lastEnd)}`;

  const balanceSub = `Zeitkonto (volle ¼ h): ${fmtDuration(acc.balance, { sign: true })} · Rest ${fmtDuration(acc.carry)}`
    + (row?.counted ? '' : ' · heute live einberechnet');

  // „Verrechnung heute“
  let devValue;
  let devSub;
  if (todayDev != null) {
    devValue = signed(todayDev);
    if (row?.counted) devSub = `Tag abgeschlossen · angerechnet ${fmtDuration(row.credited)}`;
    else {
      const parts = deviationBreakdown(plan, d, now).filter((x) => x.minutes !== 0 && x.key !== 'end')
        .map((x) => (x.key === 'start' ? `Beginn ${timeOfDay(x.actual)} statt ${timeOfDay(x.planned)}` : `${x.label} ${fmtDuration(x.actualMin)} statt ${fmtDuration(x.plannedMin)}`));
      devSub = parts.length ? parts.join(' · ') : (d.sessions.length ? 'genau im Plan' : `Plan ab ${timeOfDay(plan.start)}`);
    }
  } else {
    devValue = h('span', { class: 'num' }, fmtDuration(Math.max(0, target - d.netMin)));
    devSub = 'noch zu arbeiten (kein Zeitplan für heute)';
  }

  // „Für ±0 gehen um“
  let evenOut = null;
  if (plan && !row?.counted && todayDev != null) {
    const fmt = (t) => (t <= now ? 'erreicht' : timeOfDay(t));
    const tDay = evenOutTime(plan, todayDev, now);
    const tAll = evenOutTime(plan, todayDev, now, acc.minuteBalance);
    evenOut = stat('Für ±0 gehen um', h('span', { class: 'num', 'data-testid': 'even-out' }, fmt(tDay)),
      acc.minuteBalance ? `mit Ausgleich des Kontos (${fmtDuration(acc.minuteBalance, { sign: true })}): ${fmt(tAll)}` : 'Konto bisher ±0', { wide: true });
  }

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
      stat('Soll heute', h('span', { class: 'num' }, fmtDuration(target)),
        plan ? `${plan.entry.start}–${plan.entry.end}${plan.breakStart != null ? ` · Pause ${plan.entry.breakStart}–${plan.entry.breakEnd}` : ''}`
          : info?.dayType && info.dayType !== 'arbeit' ? info.dayType : 'kein Zeitplan'),
      stat('Verrechnung heute', h('span', { 'data-testid': 'diff' }, devValue), devSub),
      evenOut,
      stat('Verrechnungskonto (minutengenau)', h('span', { 'data-testid': 'balance' }, signed(minuteTotal)), balanceSub, { wide: true })),
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
