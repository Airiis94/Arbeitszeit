// Tagesansicht: Buchungen bearbeiten und Berechnung nachvollziehen.

import { h } from './dom.js';
import { computeDay, computeAccount, targetFor } from '../core/calc.js';
import { getStrategy } from '../core/rounding.js';
import {
  fmtDuration, fmtDate, addDays, todayKey, isValidDayKey, fmtDateTime, timeOfDay,
} from '../core/time.js';
import { DAY_TYPES } from '../core/model.js';
import { scheduleFor, deviationBreakdown } from '../core/schedule.js';
import { signed, entryList, statusBadge, issueList, timeOrDash } from './common.js';
import {
  editWorkDialog, editBreakDialog, deleteIntervalFlow, editDayInfoDialog, quickBreak,
} from './editors.js';

function calcRow(label, value, cls = '') {
  return h('tr', { class: cls }, h('th', { scope: 'row' }, label), h('td', { class: 'num' }, value));
}

/** Text, der die Verrechnung des Tages Schritt für Schritt erklärt. */
export function explainCredit(row, settings) {
  const { mode, interval } = settings.rounding;
  const lines = [];
  if (!row) return lines;
  if (!row.counted) {
    if (row.status === 'running') lines.push('Der Tag läuft noch und wird erst nach dem Feierabend verrechnet.');
    else if (row.status === 'empty') lines.push('Heute ohne Buchung – wird erst nach Tagesende gezählt.');
    else lines.push('Der Tag ist unvollständig oder fehlerhaft und wird deshalb NICHT verrechnet. Bitte korrigieren.');
    return lines;
  }
  const net = row.status === 'empty' ? 0 : row.netMin;
  if (mode === 'carry') {
    const avail = net + row.carryIn;
    lines.push(`Netto ${fmtDuration(net)} + Rest aus Vortagen ${fmtDuration(row.carryIn)} = ${fmtDuration(avail)} verfügbar.`);
    lines.push(`Angerechnet werden volle ${interval}-Minuten-Blöcke: ${fmtDuration(row.credited)}. Neuer Rest: ${fmtDuration(avail - row.credited)}.`);
  } else if (mode === 'exact') {
    lines.push(`Netto ${fmtDuration(net)} wird minutengenau angerechnet.`);
  } else {
    lines.push(`Netto ${fmtDuration(net)} wird auf volle ${interval} Minuten abgerundet: ${fmtDuration(row.credited)}. Verfallen: ${fmtDuration(row.forfeited)}.`);
  }
  lines.push(`Tagesdifferenz: angerechnet ${fmtDuration(row.credited)} − Soll ${fmtDuration(row.target)} = ${fmtDuration(row.diff, { sign: true })}.`);
  if (row.correction) lines.push(`Korrektur an diesem Tag: ${fmtDuration(row.correction, { sign: true })}.`);
  if (row.flushCredit) lines.push(`Monatsabschluss: Rest ${fmtDuration(row.flushCredit)} wird minutengenau gutgeschrieben.`);
  if (row.flushForfeit) lines.push(`Monatsabschluss: Rest ${fmtDuration(row.flushForfeit)} verfällt (Regel in den Einstellungen).`);
  lines.push(`Saldo nach diesem Tag: ${fmtDuration(row.balance, { sign: true })}.`);
  return lines;
}

const AUDIT_ACTIONS = { create: 'angelegt', update: 'geändert', delete: 'gelöscht', undo: 'rückgängig gemacht' };
const AUDIT_ENTITIES = { interval: 'Buchung', intervals: 'Buchung', dayInfo: 'Tagesangaben', activity: 'Tätigkeit', activities: 'Tätigkeit', correction: 'Korrektur' };

function auditText(a) {
  const describe = (r) => {
    if (!r) return '—';
    if (r.kind) {
      const k = r.kind === 'work' ? 'Arbeit' : 'Pause';
      if (r.deleted) return `${k} (gelöscht)`;
      return r.start != null ? `${k} ${timeOfDay(r.start)}–${r.end ? timeOfDay(r.end) : '…'}` : `${k} ${fmtDuration(r.durationMin)}`;
    }
    if (r.title) return `${r.title} (${fmtDuration(r.minutes)})`;
    if (r.dayType) return `${DAY_TYPES[r.dayType]?.label || r.dayType}${Number.isInteger(r.targetOverrideMin) ? `, Soll ${fmtDuration(r.targetOverrideMin)}` : ''}`;
    return '';
  };
  const change = a.action === 'update' || a.action === 'undo' ? `${describe(a.before)} → ${describe(a.after)}` : describe(a.after || a.before);
  return `${fmtDateTime(a.at)} · ${AUDIT_ENTITIES[a.entity] || a.entity} ${AUDIT_ACTIONS[a.action] || a.action}: ${change}${a.reason ? ` · Grund: ${a.reason}` : ''}`;
}

export async function renderDay(app, params) {
  const day = isValidDayKey(params[0]) ? params[0] : todayKey();
  const data = await app.load();
  const now = Date.now();
  const today = todayKey(now);
  const { settings } = data;
  const d = computeDay(data.intervals.filter((i) => i.day === day), { now, autoBreak: settings.autoBreak });
  const info = data.dayInfos.find((x) => x.day === day) || null;
  const target = targetFor(day, settings, info);
  const defaultTarget = targetFor(day, settings, null);
  const acc = computeAccount({ ...data, settings, today, now });
  const row = acc.rowsByDay.get(day);
  const acts = data.activities.filter((a) => a.day === day);
  const actSum = acts.reduce((s, a) => s + a.minutes, 0);
  const audit = await app.repo.auditForDay(day);

  const strategy = getStrategy(settings.rounding.mode);
  const plan = scheduleFor(day, settings, info);
  const devItems = deviationBreakdown(plan, d, now);
  const devTotal = row?.counted ? row.exactDiff : acc.live?.day === day ? acc.live.deviation : null;
  const planCard = plan ? h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, 'Verrechnung gegen den Plan')),
    h('p', { class: 'muted small' }, `Plan: ${plan.entry.start}–${plan.entry.end}${plan.breakStart != null ? `, Pause ${plan.entry.breakStart}–${plan.entry.breakEnd}` : ''} (Soll ${fmtDuration(plan.plannedMin)})`),
    devItems.length ? h('table', { class: 'calc', 'data-testid': 'deviation' }, h('tbody', null,
      devItems.map((x) => {
        let label = x.label;
        if (x.key === 'start' || x.key === 'end') label = `${x.label} ${timeOfDay(x.actual)} statt ${timeOfDay(x.planned)}`;
        else if (x.key !== 'other') label = `${x.label} ${fmtDuration(x.actualMin)} statt ${fmtDuration(x.plannedMin)}`;
        return h('tr', null, h('th', { scope: 'row' }, label), h('td', null, signed(x.minutes)));
      }),
      devTotal != null ? h('tr', { class: 'strong' }, h('th', { scope: 'row' }, row?.counted ? 'Abweichung des Tages' : 'Abweichung bis jetzt'), h('td', null, signed(devTotal))) : null,
      row?.counted ? h('tr', null, h('th', { scope: 'row' }, 'Verrechnungskonto nach dem Tag (minutengenau)'), h('td', null, signed(row.minuteBalance))) : null))
      : h('p', { class: 'muted' }, devTotal != null ? `Noch keine Buchung – Abweichung bis jetzt ${fmtDuration(devTotal, { sign: true })}.` : 'Noch keine Buchung.')) : null;
  const table = h('table', { class: 'calc' }, h('tbody', null,
    calcRow('Beginn', timeOrDash(d.firstStart)),
    calcRow('Ende', d.openSession ? 'läuft' : timeOrDash(d.lastEnd)),
    calcRow('Anwesenheit (brutto)', fmtDuration(d.grossMin)),
    calcRow('− Pausen (erfasst)', fmtDuration(d.breakMin)),
    d.autoBreakMin ? calcRow('− Automatische Pause', fmtDuration(d.autoBreakMin), 'auto') : null,
    calcRow('= Nettoarbeitszeit', fmtDuration(d.netMin), 'strong'),
    calcRow('Sollarbeitszeit', fmtDuration(target)),
    row?.counted && strategy.usesCarry ? calcRow('Rest aus Vortagen', fmtDuration(row.carryIn)) : null,
    row?.counted ? calcRow('Angerechnet', fmtDuration(row.credited), 'strong') : null,
    row?.counted && strategy.usesCarry ? calcRow('Rest danach', fmtDuration(row.carryOut + (row.flushCredit || 0) + (row.flushForfeit || 0))) : null,
    row?.counted && row.forfeited ? calcRow('Verfallen', fmtDuration(row.forfeited), 'neg') : null,
    row?.counted ? h('tr', { class: 'strong' }, h('th', { scope: 'row' }, 'Tagesdifferenz (angerechnet − Soll)'), h('td', null, signed(row.diff))) : null,
    row ? h('tr', null, h('th', { scope: 'row' }, 'Saldo nach dem Tag'), h('td', null, signed(row.balance))) : null,
  ));

  const sessionsEdit = {
    onEdit: (rec) => (rec.kind === 'work' ? editWorkDialog(app, day, rec) : editBreakDialog(app, day, rec, d.sessions)),
    onDelete: (rec) => deleteIntervalFlow(app, rec),
  };

  return h('section', { class: 'view view-day' },
    h('div', { class: 'nav-row' },
      h('a', { class: 'btn btn-small', href: `#/tag/${addDays(day, -1)}`, 'aria-label': 'Vortag' }, '‹'),
      h('h1', { class: 'nav-title' }, fmtDate(day)),
      h('a', { class: 'btn btn-small', href: `#/tag/${addDays(day, 1)}`, 'aria-label': 'Folgetag' }, '›')),
    h('div', { class: 'day-head' },
      statusBadge(d.status, info?.dayType),
      d.status !== 'empty' && info?.dayType && info.dayType !== 'arbeit' ? h('span', { class: 'badge badge-absence' }, DAY_TYPES[info.dayType]?.label) : null,
      day < acc.start ? h('span', { class: 'badge' }, 'vor Kontobeginn – zählt nicht') : null,
      day > today ? h('span', { class: 'badge' }, 'Zukunft') : null),
    issueList(d.issues),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, 'Buchungen')),
      entryList(day, d, sessionsEdit),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn', onclick: () => editWorkDialog(app, day) }, '+ Arbeitsphase'),
        h('button', { type: 'button', class: 'btn', onclick: () => editBreakDialog(app, day, null, d.sessions) }, '+ Pause')),
      h('div', { class: 'quick' },
        h('span', { class: 'quick-label' }, 'Pause (Dauer):'),
        [15, 30, 45, 60].map((m) => h('button', { type: 'button', class: 'chip', onclick: () => quickBreak(app, day, m) }, `${m}`)))),
    planCard,
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, 'Berechnung')),
      table,
      h('ul', { class: 'explain' }, explainCredit(row, settings).map((l) => h('li', null, l)))),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h2', null, 'Tagesangaben'),
        h('button', { type: 'button', class: 'btn btn-small', onclick: () => editDayInfoDialog(app, day, info, defaultTarget) }, 'Bearbeiten')),
      h('p', null, `Tagesart: ${DAY_TYPES[info?.dayType || 'arbeit'].label} · Soll: ${fmtDuration(target)}${Number.isInteger(info?.targetOverrideMin) ? ' (individuell)' : ''}`),
      info?.note ? h('p', { class: 'note' }, info.note) : null),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h2', null, 'Tätigkeiten'),
        h('a', { class: 'btn btn-small', href: `#/taetigkeiten/${day}` }, 'Öffnen')),
      h('p', null, acts.length ? `${acts.length} Tätigkeit(en), zusammen ${fmtDuration(actSum)}.` : 'Keine Tätigkeiten dokumentiert.')),
    h('details', { class: 'card' },
      h('summary', null, `Änderungsprotokoll (${audit.length})`),
      audit.length ? h('ul', { class: 'audit' }, audit.map((a) => h('li', null, auditText(a))))
        : h('p', { class: 'muted' }, 'Keine manuellen Änderungen.')),
  );
}
