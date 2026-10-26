// Tätigkeitsprotokoll eines Tages.

import { h, confirmDialog } from './dom.js';
import { dayRow, activityCheck, computeAccount } from '../core/calc.js';
import { fmtDuration, fmtHoursDecimal, fmtDate, addDays, todayKey, isValidDayKey } from '../core/time.js';
import { editActivityDialog, diceDialog, undoToast } from './editors.js';

export async function renderActivities(app, params) {
  const day = isValidDayKey(params[0]) ? params[0] : todayKey();
  const data = await app.load();
  const acts = data.activities.filter((a) => a.day === day).sort((a, b) => a.createdAt - b.createdAt);
  const categories = [...new Set(data.activities.map((a) => a.category).filter(Boolean))].sort();
  const info = data.dayInfos.find((x) => x.day === day) || null;
  const row = dayRow(day, data.intervals.filter((i) => i.day === day), info, data.settings, Date.now());
  const chk = activityCheck(row, data.activities);
  const sum = chk.sum;
  const suggest = chk.gap > 0 ? chk.gap : null;

  // Tage (letzte 12 Wochen), an denen die Tätigkeiten noch nicht zur Netto-Arbeitszeit passen –
  // zum späteren Ergänzen; jede Zeile rechnet aus den gespeicherten Daten neu.
  const today = todayKey();
  const acc = computeAccount({ ...data, today, now: Date.now() });
  const from = addDays(today, -84);
  const openDays = acc.rows
    .filter((r) => r.day >= from && r.day !== day && r.bookedNetMin != null && r.bookedNetMin > 0)
    .map((r) => ({ day: r.day, chk: activityCheck(r, data.activities) }))
    .filter((x) => x.chk.gap !== 0)
    .sort((a, b) => b.day.localeCompare(a.day));

  // Sehr kurze Einträge (1–9 min) stammen meist aus einer früheren Eingabe wie „1“ (gemeint: 1 Stunde)
  const fixUnit = async (a) => {
    try {
      const res = await app.repo.saveActivity({ ...a, minutes: a.minutes * 60 });
      undoToast(app, `„${a.title}“: ${fmtDuration(a.minutes)} → ${fmtDuration(a.minutes * 60)} Std. geändert.`, res.changes);
    } catch (e) { app.error(e); }
  };

  const remove = async (a) => {
    if (!(await confirmDialog({ title: 'Tätigkeit löschen?', message: `„${a.title}“ (${fmtDuration(a.minutes)}) wird gelöscht.`, confirmText: 'Löschen', danger: true }))) return;
    try {
      const res = await app.repo.deleteActivity(a.id);
      undoToast(app, 'Tätigkeit gelöscht.', res.changes);
    } catch (e) { app.error(e); }
  };

  // Die Tätigkeiten sollen genau der festgelegten (gebuchten) Netto-Arbeitszeit entsprechen.
  let status = null;
  if (chk.target > 0 || sum > 0) {
    const label = chk.running ? `Netto-Arbeitszeit bisher (Tag läuft): ${fmtDuration(chk.target)}` : `Festgelegte Netto-Arbeitszeit: ${fmtDuration(chk.target)}`;
    let text;
    let state;
    if (chk.gap === 0) { text = '✓ Tätigkeiten entsprechen genau der Netto-Arbeitszeit.'; state = 'ok'; }
    else if (chk.gap > 0) { text = `Noch ${fmtDuration(chk.gap)} Tätigkeiten zuordnen.`; state = 'open'; }
    else { text = `Die Tätigkeiten sind ${fmtDuration(-chk.gap)} länger als die Netto-Arbeitszeit – bitte kürzen.`; state = 'over'; }
    const bar = h('div', { class: 'progress-bar' });
    // Breite per CSSOM (Inline-Stilattribute sind durch die Content-Security-Policy gesperrt)
    bar.style.width = `${chk.target > 0 ? Math.min(100, Math.round((sum / chk.target) * 100)) : 100}%`;
    status = h('div', { class: `card act-progress act-${state}`, 'data-testid': 'activity-check' },
      h('div', { class: 'act-progress-head' }, h('span', null, label), h('b', null, `${fmtDuration(sum)} / ${fmtDuration(chk.target)}`)),
      h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': chk.target, 'aria-valuenow': sum }, bar),
      h('div', { class: 'act-progress-text' }, text));
  }

  return h('section', { class: 'view view-activities' },
    h('div', { class: 'nav-row' },
      h('a', { class: 'btn btn-small', href: `#/taetigkeiten/${addDays(day, -1)}`, 'aria-label': 'Vortag' }, '‹'),
      h('h1', { class: 'nav-title' }, fmtDate(day)),
      h('a', { class: 'btn btn-small', href: `#/taetigkeiten/${addDays(day, 1)}`, 'aria-label': 'Folgetag' }, '›')),
    h('label', { class: 'day-jump' }, 'Anderen Tag wählen: ',
      h('input', {
        type: 'date', class: 'input input-short', value: day, max: today, 'data-testid': 'activity-day',
        onchange: (ev) => { if (isValidDayKey(ev.target.value)) app.navigate(`#/taetigkeiten/${ev.target.value}`); },
      })),
    status,
    h('div', { class: 'act-buttons' },
      h('button', { type: 'button', class: 'btn btn-primary', 'data-testid': 'add-activity', onclick: () => editActivityDialog(app, day, null, categories, suggest, { activities: data.activities, settings: data.settings }) }, '+ Tätigkeit erfassen'),
      chk.gap > 0 ? h('button', {
        type: 'button', class: 'btn btn-dice', 'data-testid': 'dice-day',
        title: 'Tätigkeiten nach deiner Statistik vorschlagen lassen',
        onclick: () => diceDialog(app, day, { activities: data.activities, openMin: chk.gap, settings: data.settings }),
      }, acts.length ? '🎲 Rest würfeln' : '🎲 Tag würfeln') : null),
    acts.length ? h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, `Erfasste Tätigkeiten (${acts.length})`)),
      h('ul', { class: 'act-list' }, acts.map((a) => h('li', { class: 'act-item' },
        h('div', { class: 'act-body' },
          h('div', { class: 'act-title' }, a.title, a.source === 'dice' ? h('span', { class: 'badge badge-soft act-dice', title: 'Gewürfelt – zählt nicht zur Würfel-Statistik. Bearbeiten macht ihn zu einem eigenen Eintrag.' }, '🎲 gewürfelt') : null),
          a.minutes >= 1 && a.minutes <= 9 ? h('div', { class: 'act-unit-warn', 'data-testid': 'unit-warning' },
            `Nur ${a.minutes} min erfasst – gemeint ${a.minutes} Std.? `,
            h('button', { type: 'button', class: 'chip chip-small', onclick: () => fixUnit(a) }, `Auf ${fmtDuration(a.minutes * 60)} Std. ändern`)) : null,
          a.category || a.intensity ? h('div', { class: 'act-meta' },
            a.category ? h('span', { class: 'badge badge-soft' }, a.category) : null,
            a.intensity ? h('span', { class: `badge int-${a.intensity}` }, `Intensität ${a.intensity}`) : null) : null,
          a.description ? h('div', { class: 'act-desc' }, a.description) : null),
        h('div', { class: 'act-side' },
          h('span', { class: 'act-dur' }, fmtDuration(a.minutes)),
          h('span', { class: 'act-dec' }, `${fmtHoursDecimal(a.minutes)} Std.`),
          h('div', { class: 'act-actions' },
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Bearbeiten', onclick: () => editActivityDialog(app, day, a, categories) }, '✎'),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Löschen', onclick: () => remove(a) }, '🗑')))))),
      h('div', { class: 'act-total' },
        h('span', null, 'Summe'),
        h('span', null, h('b', { 'data-testid': 'activity-sum' }, fmtDuration(sum)), h('span', { class: 'muted' }, ` von ${fmtDuration(chk.target)} netto`))))
      : h('p', { class: 'muted' }, 'Für diesen Tag sind noch keine Tätigkeiten dokumentiert.'),
    openDays.length ? h('div', { class: 'card', 'data-testid': 'open-days' },
      h('div', { class: 'card-head' }, h('h2', null, `Noch offene Tage (${openDays.length})`)),
      h('p', { class: 'muted small' }, 'Tage der letzten 12 Wochen, an denen die Tätigkeiten noch nicht der Netto-Arbeitszeit entsprechen. Antippen zum Ergänzen.'),
      h('ul', { class: 'open-days' }, openDays.slice(0, 20).map(({ day: d, chk: c }) => h('li', null,
        h('a', { href: `#/taetigkeiten/${d}` },
          h('span', null, fmtDate(d, { year: false })),
          h('span', { class: c.gap > 0 ? 'od-open' : 'od-over' }, c.gap > 0 ? `noch ${fmtDuration(c.gap)} offen` : `${fmtDuration(-c.gap)} zu viel`)))))) : null,
    h('a', { class: 'card-link', href: `#/tag/${day}` }, 'Zur Tagesansicht →'));
}
