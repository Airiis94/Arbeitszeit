// Ansicht „Heute“: Stempeluhr, gebuchte Viertelstunden und Zeitkonto der Differenzminuten.

import { h } from './dom.js';
import { computeDay, computeAccount, dayRow, activityCheck } from '../core/calc.js';
import { activityTemplates } from '../core/memory.js';
import { deriveState } from '../core/state.js';
import { bookDay, suggestLeave, bookingInterval } from '../core/booking.js';
import { fmtDuration, fmtDate, timeOfDay, todayKey, fmtDateTime, HOUR_MS } from '../core/time.js';
import { signed, entryList, statusBadge, backupState, issueList } from './common.js';
import { quickBreak, editBreakDialog, undoToast, chooseBookingDialog, quickActivityDialog } from './editors.js';
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

  let phaseInfo = d.sessions.length ? '–' : 'Heute noch nicht eingestempelt';
  if (st.mode === 'working') phaseInfo = `seit ${st.session.day === today ? timeOfDay(st.session.start) : fmtDateTime(st.session.start)} · ${fmtDuration(d.netMin)} h gearbeitet`;
  if (st.mode === 'break') phaseInfo = `Pause seit ${timeOfDay(st.brk.start)} · Arbeit seit ${timeOfDay(st.session.start)}`;
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
  const bigBtn = (ico, label, cls, action, testId) => h('button', { type: 'button', class: `btn btn-big ${cls}`, onclick: act(action), 'data-testid': testId }, ico, label);
  let actions;
  if (st.mode === 'idle') {
    actions = [bigBtn(icon('play', { fill: true }), d.sessions.length ? 'Weitere Arbeitsphase beginnen' : 'Arbeitsbeginn', 'btn-start', 'start', 'btn-start')];
  } else if (st.mode === 'working') {
    actions = [bigBtn(icon('pause'), 'Pause', 'btn-pause', 'pause', 'btn-pause'), bigBtn(icon('stop', { fill: true }), 'Feierabend', 'btn-end', 'end', 'btn-end')];
  } else {
    actions = [bigBtn(icon('play', { fill: true }), 'Pause beenden', 'btn-resume', 'resume', 'btn-resume'), bigBtn(icon('stop', { fill: true }), 'Feierabend', 'btn-end', 'end', 'btn-end')];
  }

  const quick = h('div', { class: 'quick' },
    h('span', { class: 'quick-label' }, 'Pause nachtragen (Minuten):'),
    [15, 30, 45, 60].map((m) => h('button', { type: 'button', class: 'chip', onclick: () => quickBreak(app, workDay, m) }, `${m}`)),
    h('button', { type: 'button', class: 'chip', onclick: () => editBreakDialog(app, workDay, null, d.sessions) }, '…'));

  // Kennzahlen des Tages: nach Feierabend gebucht (Raster), während der Arbeit laufend
  const metric = (label, value, sub, cls = '') => h('div', { class: `metric ${cls}` },
    h('div', { class: 'metric-label' }, label), h('div', { class: 'metric-value' }, value), sub ? h('div', { class: 'metric-sub' }, sub) : null);
  const closed = booking.bookedNetMin != null && d.sessions.length;
  const workMetric = closed
    ? metric('Arbeitszeit', h('span', { class: 'num', 'data-testid': 'net' }, fmtDuration(row.bookedNetMin)), quarter ? `gestempelt ${fmtDuration(d.netMin)}` : null)
    : metric('Arbeitszeit', h('span', { class: 'num', 'data-testid': 'net' }, fmtDuration(d.netMin)),
      booking.firstBooked != null ? (quarter ? `gebucht ab ${timeOfDay(booking.firstBooked)}` : `ab ${timeOfDay(booking.firstBooked)}`) : 'noch nicht begonnen');
  const breakMetric = closed
    ? metric('Pause', h('span', { class: 'num', 'data-testid': 'breaks' }, fmtDuration(row.bookedBreakMin)), quarter ? `gestempelt ${fmtDuration(d.breakMin + d.autoBreakMin)}` : null)
    : metric('Pause', h('span', { class: 'num', 'data-testid': 'breaks' }, fmtDuration(d.breakMin + d.autoBreakMin)),
      d.openBreak ? `läuft seit ${timeOfDay(d.openBreak.start)}` : d.breaks.length ? `${d.breaks.length} Pause${d.breaks.length === 1 ? '' : 'n'}` : 'keine');
  const diffCount = booking.stamps.filter((x) => x.effect !== 0).length;
  const diffMetric = quarter ? metric('Differenz', h('span', { 'data-testid': 'diff' }, signed(booking.effect)),
    diffCount ? `aus ${diffCount} Stempel${diffCount === 1 ? '' : 'n'}` : 'keine') : null;

  // Vorschlag zum Ausgleich beim Gehen (nur während der Arbeit)
  let leaveMetric = null;
  if (quarter && st.mode !== 'idle') {
    const sug = suggestLeave(now, acc.balance, interval);
    if (sug) {
      const rest = acc.balance + sug.effect;
      const text = sug.effect === 0
        ? 'zur vollen Viertelstunde gehen – Konto bleibt ±0'
        : `gebucht ${timeOfDay(sug.booked)} (${fmtDuration(sug.effect, { sign: true })}), danach ${rest !== 0 ? `Konto ${fmtDuration(rest, { sign: true })}` : 'Konto ±0'}`;
      leaveMetric = metric('Ausgleichen: gehen um', h('span', { class: 'num', 'data-testid': 'leave' }, timeOfDay(sug.leave)), text);
    }
  }

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

  const todayCard = h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, `Heute · ${fmtDate(workDay, { year: false })}`),
      quarter ? h('span', { class: 'muted small' }, closed ? 'gebucht' : 'bisher') : null),
    h('div', { class: 'metrics' }, workMetric, breakMetric, diffMetric));

  const accountCard = h('div', { class: 'card' },
    h('div', { class: 'account-row' },
      h('div', { class: 'metric' },
        h('div', { class: 'metric-label' }, 'Zeitkonto'),
        h('div', { class: 'metric-value big' }, h('span', { 'data-testid': 'balance' }, signed(acc.balance))),
        h('div', { class: 'metric-sub' }, quarter ? 'Differenzminuten, inkl. heute' : 'minutengenau: nur Anfangssaldo und Korrekturen')),
      leaveMetric),
    h('a', { class: 'card-link', href: '#/konto' }, 'Zeitkonto im Detail →'));

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
    todayCard,
    accountCard,
    h('div', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h2', null, 'Buchungen'),
        h('a', { class: 'btn btn-small', href: `#/tag/${workDay}` }, 'Tag bearbeiten')),
      entryList(workDay, d, { booking, onChoose: quarter ? (s) => chooseBookingDialog(app, data.intervals, s, workDay, interval, acc.balance) : null }),
      quarter && booking.stamps.length
        ? h('p', { class: 'muted small' }, '✎ Zeit antippen, um die gebuchte Zeit zu wählen (z. B. 08:45 oder 09:00) – die Differenz wird mit dem Zeitkonto verrechnet.') : null,
      h('a', { class: 'card-link', href: `#/taetigkeiten/${workDay}` }, 'Tätigkeiten erfassen →')),
  );
}
