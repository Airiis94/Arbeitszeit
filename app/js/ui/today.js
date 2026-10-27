// Ansicht „Heute“: Stempeluhr, Tätigkeit erfassen und die Buchungen des Tages – bewusst schlank.

import { h } from './dom.js';
import { computeDay, computeAccount, dayRow, activityCheck } from '../core/calc.js';
import { activityTemplates } from '../core/memory.js';
import { deriveState } from '../core/state.js';
import { bookDay, bookingInterval } from '../core/booking.js';
import { fmtDuration, fmtDate, timeOfDay, todayKey, fmtDateTime, HOUR_MS } from '../core/time.js';
import { entryList, statusBadge, backupState, issueList } from './common.js';
import { quickBreak, editBreakDialog, editWorkDialog, undoToast, chooseBookingDialog, deleteIntervalFlow, quickActivityDialog } from './editors.js';
import { icon } from './icons.js';

const MODE_LABEL = { idle: 'Nicht eingestempelt', working: 'Arbeit läuft', break: 'Pause läuft' };

export async function renderToday(app) {
  const data = await app.load();
  const now = Date.now();
  const today = todayKey(now);
  const { settings } = data;
  const interval = bookingInterval(settings);
  const quarter = interval > 1;
  const st = deriveState(data.intervals);
  const workDay = st.day || today;
  const dayIntervals = data.intervals.filter((i) => i.day === workDay);
  const d = computeDay(dayIntervals, { now, autoBreak: settings.autoBreak });
  const booking = bookDay(dayIntervals, interval);
  const info = data.dayInfos.find((x) => x.day === workDay) || null;
  const acc = computeAccount({ ...data, settings, today, now });
  const row = acc.rowsByDay.get(workDay) || dayRow(workDay, dayIntervals, info, settings, now, interval);

  // Stand des Tages in einer Zeile: nach Feierabend gebucht (Raster), während der Arbeit laufend
  const closed = booking.bookedNetMin != null && d.sessions.length > 0;
  const netMin = closed ? row.bookedNetMin : d.netMin;
  const breakMin = closed ? row.bookedBreakMin : d.breakMin + d.autoBreakMin;
  const netEl = h('b', { class: 'num', 'data-testid': 'net' }, fmtDuration(netMin));
  const breakEl = h('span', { class: 'num', 'data-testid': 'breaks' }, fmtDuration(breakMin));
  const since = st.mode !== 'idle' ? (st.session.day === today ? timeOfDay(st.session.start) : fmtDateTime(st.session.start)) : '';
  let phaseInfo = ['Heute noch nicht eingestempelt'];
  if (st.mode === 'working') phaseInfo = [`seit ${since} · `, netEl, ' h gearbeitet', breakMin ? [' · Pause ', breakEl] : null];
  if (st.mode === 'break') phaseInfo = [`Pause seit ${timeOfDay(st.brk.start)} · `, netEl, ' h gearbeitet · Pausen ', breakEl];
  if (st.mode === 'idle' && d.sessions.length) {
    phaseInfo = [d.lastEnd ? `Feierabend ${timeOfDay(d.lastEnd)} · ` : '', netEl, ` h ${closed && quarter ? 'gebucht' : 'gearbeitet'} · Pause `, breakEl];
  }

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
  const bigBtn = (ico, label, cls, action, testId) => h('button', { type: 'button', class: `btn btn-big ${cls}`, onclick: act(action), 'data-testid': testId }, ico, label);
  let actions;
  if (st.mode === 'idle') {
    actions = [bigBtn(icon('play', { fill: true }), d.sessions.length ? 'Weitere Arbeitsphase beginnen' : 'Arbeitsbeginn', 'btn-start', 'start', 'btn-start')];
  } else if (st.mode === 'working') {
    actions = [bigBtn(icon('pause'), 'Pause', 'btn-pause', 'pause', 'btn-pause'), bigBtn(icon('stop', { fill: true }), 'Feierabend', 'btn-end', 'end', 'btn-end')];
  } else {
    actions = [bigBtn(icon('play', { fill: true }), 'Pause beenden', 'btn-resume', 'resume', 'btn-resume'), bigBtn(icon('stop', { fill: true }), 'Feierabend', 'btn-end', 'end', 'btn-end')];
  }

  const quick = h('details', { class: 'quick quick-fold' },
    h('summary', null, '+ Pause nachtragen'),
    h('div', { class: 'quick-chips' },
      [15, 30, 45, 60].map((m) => h('button', { type: 'button', class: 'chip', 'aria-label': `${m} Minuten Pause nachtragen`, onclick: () => quickBreak(app, workDay, m) }, `${m} min`)),
      h('button', { type: 'button', class: 'chip', onclick: () => editBreakDialog(app, workDay, null, d.sessions) }, 'Uhrzeit …')));

  // Tätigkeiten schnell erfassen: Eingabe · Uhr (Dauer) · noch zu vergebende Zeit
  const chk = activityCheck(row, data.activities);
  const dayActs = data.activities.filter((a) => !a.deleted && a.day === workDay);
  const templates = activityTemplates(data.activities, settings.activityMemoryHidden);
  const actInput = h('input', {
    type: 'text', class: 'input quick-act-input', placeholder: 'Tätigkeit …', maxlength: 120, list: 'quick-act-list',
    'aria-label': 'Tätigkeit', enterkeyhint: 'next', autocomplete: 'off', 'data-testid': 'quick-activity', value: app.quickActivityDraft || '',
  });
  const openQuick = () => quickActivityDialog(app, workDay, actInput.value, {
    openMin: chk.gap, templates, onSaved: () => { app.quickActivityDraft = ''; },
  });
  actInput.addEventListener('input', () => { app.quickActivityDraft = actInput.value; });
  actInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); openQuick(); } });
  let restState = 'open';
  let restLabel = chk.running ? 'offen bisher' : 'offen';
  let restValue = fmtDuration(Math.max(0, chk.gap));
  if (chk.target > 0 && chk.gap === 0) { restState = 'done'; restLabel = 'vergeben'; restValue = '✓'; }
  if (chk.gap < 0) { restState = 'over'; restLabel = 'zu viel'; restValue = fmtDuration(-chk.gap); }
  const quickAct = h('div', { class: 'card quick-act' },
    h('div', { class: 'quick-act-head' },
      h('span', { class: 'metric-label' }, 'Tätigkeit erfassen'),
      h('a', { href: `#/taetigkeiten/${workDay}`, class: 'small' }, dayActs.length ? `${dayActs.length} erfasst · ${fmtDuration(chk.sum)} – alle →` : 'Liste öffnen →')),
    h('div', { class: 'quick-act-row' },
      actInput,
      h('button', { type: 'button', class: 'quick-act-time', 'aria-label': 'Dauer wählen und hinzufügen', title: 'Dauer wählen und hinzufügen', 'data-testid': 'quick-activity-time', onclick: openQuick }, icon('clock', { stroke: '2.2' })),
      h('a', {
        class: `quick-act-rest rest-${restState}`, href: `#/taetigkeiten/${workDay}`, 'data-testid': 'activity-rest',
        title: `Netto-Arbeitszeit ${fmtDuration(chk.target)}, Tätigkeiten ${fmtDuration(chk.sum)}`,
      }, h('span', { class: 'rest-label' }, restLabel), h('b', null, restValue))),
    h('datalist', { id: 'quick-act-list' }, templates.slice(0, 50).map((t) => h('option', { value: t.title }))));

  return h('section', { class: 'view view-today' },
    h('div', { class: `status-card status-${st.mode}` },
      h('div', { class: 'status-top' },
        h('div', null,
          h('div', { class: 'status-mode', 'data-testid': 'status' }, MODE_LABEL[st.mode]),
          h('div', { class: 'status-since' }, phaseInfo)),
        h('div', { class: 'status-date' }, h('span', { class: 'nowrap' }, fmtDate(workDay, { year: false })), d.status !== 'running' && d.status !== 'empty' ? statusBadge(d.status, info?.dayType) : null)),
      h('div', { class: 'actions' }, actions),
      quick),
    quickAct,
    warnings,
    issueList(d.issues.filter((i) => i.code !== 'stale-open')),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h2', null, 'Buchungen'),
        h('a', { class: 'btn btn-small', href: `#/tag/${workDay}` }, 'Tag bearbeiten')),
      entryList(workDay, d, {
        booking,
        hideExact: true,
        onChoose: quarter ? (s) => chooseBookingDialog(app, data.intervals, s, workDay, interval, acc.balance) : null,
        // Arbeitszeit/Pause direkt hier ändern (Beginn, Ende, Dauer)
        onEdit: (rec) => (rec.kind === 'work' ? editWorkDialog(app, workDay, rec) : editBreakDialog(app, workDay, rec, d.sessions)),
        // versehentlich gestempelt → direkt hier löschen (Pausen der Arbeitsphase werden mitgelöscht)
        onDelete: (rec) => deleteIntervalFlow(app, rec),
      }),
    ),
  );
}
