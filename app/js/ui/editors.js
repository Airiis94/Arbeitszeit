// Bearbeitungsdialoge für Arbeitsphasen, Pausen, Tagesangaben, Tätigkeiten und Korrekturen.

import { h, field, formDialog, toast } from './dom.js';
import {
  localTimestamp, timeOfDay, dayKey, parseDuration, analyzeDuration, fmtHoursDecimal, fmtDuration, fmtDate, parseTime, todayKey, isValidDayKey,
} from '../core/time.js';
import { newInterval, touch, DAY_TYPES, INTENSITIES } from '../core/model.js';
import { stampChoices } from '../core/booking.js';
import { activityTemplates, filterTemplates, templateMinutes, hideTemplate } from '../core/memory.js';
import { ValidationError } from '../db/repo.js';

const err = (msg) => new ValidationError([msg]);

/** Verständliche Fehlermeldung für eine nicht lesbare oder mehrdeutige Dauer. */
export function durationError(input, example = '30 min, 0,5 Std. oder 1:30') {
  const raw = String(input ?? '').trim();
  if (analyzeDuration(raw).ambiguous) {
    const n = raw.replace(/^[+−-]/, '');
    return err(`„${raw}“ ist nicht eindeutig – bitte „${n} Std.“ oder „${n} min“ eingeben.`);
  }
  return err(`Bitte eine gültige Dauer angeben (z. B. ${example}).`);
}

/**
 * Eingabefeld für Dauern mit Live-Anzeige, wie die Eingabe verstanden wird
 * („= 0:30 Std. · 30 min · 0,50 Std.“). Bei einer einzelnen Ziffer ohne Einheit wird nachgefragt.
 * Wird der Wert per Skript gesetzt, danach `input` auslösen (setDuration).
 */
function durationInput(attrs, { signed = false } = {}) {
  const input = h('input', { type: 'text', class: 'input', inputmode: signed ? 'text' : 'decimal', autocomplete: 'off', ...attrs });
  const preview = h('div', { class: 'dur-preview', 'aria-live': 'polite', 'data-testid': 'duration-preview' });
  const pick = (label, value) => h('button', { type: 'button', class: 'chip chip-small', onclick: () => setDuration(input, value) }, label);
  const update = () => {
    const raw = input.value.trim();
    preview.className = 'dur-preview';
    preview.replaceChildren();
    if (!raw) return;
    const { min, ambiguous } = analyzeDuration(raw);
    if (ambiguous) {
      const sign = /^[+−-]/.test(raw) ? raw[0].replace('−', '-') : '';
      const n = raw.replace(/^[+−-]/, '');
      preview.classList.add('dur-ask');
      preview.append('Gemeint: ', pick(`${n} Std.`, `${sign}${n}:00`), ' oder ', pick(`${n} min`, `${sign}${n} min`), ' ?');
    } else if (min == null) {
      preview.classList.add('dur-bad');
      preview.append('Nicht erkannt – z. B. 30 min, 0,5 Std. oder 1:30');
    } else {
      const abs = Math.abs(min);
      const sg = min < 0 ? '−' : signed && min > 0 ? '+' : '';
      preview.append(`= ${sg}${fmtDuration(abs)} Std. · ${sg}${abs} min · ${sg}${fmtHoursDecimal(abs)} Std.`);
    }
  };
  input.addEventListener('input', update);
  update();
  return { input, preview };
}

/** Wert eines Dauerfeldes setzen und die Anzeige aktualisieren. */
function setDuration(input, value) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Formularfeld „Dauer“ mit Live-Anzeige. */
function durationField(label, attrs, hint, opts) {
  const { input, preview } = durationInput(attrs, opts);
  const f = field(label, input, hint);
  f.appendChild(preview);
  return { field: f, input };
}

function timeInput(name, value, attrs = {}) {
  return h('input', { type: 'time', name, value: value || '', step: 60, required: attrs.required, class: 'input' });
}

function reasonField() {
  return field('Grund der Änderung (optional)', h('input', { name: 'reason', type: 'text', class: 'input', maxlength: 200, placeholder: 'z. B. Feierabend vergessen', 'data-nofocus': true }));
}

/** Uhrzeit einer Pause auf den richtigen Kalendertag legen (Nachtschicht: Pause nach Mitternacht). */
export function resolveBreakTime(day, hhmm, sessions) {
  const t0 = localTimestamp(day, hhmm);
  const t1 = localTimestamp(day, hhmm, 1);
  const inside = (t) => sessions.some((s) => s.start != null && t >= s.start && (s.end == null || t <= s.end));
  if (!inside(t0) && inside(t1)) return t1;
  return t0;
}

/** Undo-Toast nach einer Änderung. */
export function undoToast(app, message, changes) {
  toast(message, {
    type: 'success',
    action: changes?.length ? {
      label: 'Rückgängig',
      run: async () => {
        try {
          await app.repo.undo(changes);
          toast('Rückgängig gemacht.');
        } catch (e) { app.error(e); }
      },
    } : null,
  });
}

// ---------- Arbeitsphase ----------

export function editWorkDialog(app, day, rec = null) {
  const isNew = !rec;
  const endDay = rec?.end ? dayKey(rec.end) : day;
  return formDialog({
    title: isNew ? `Arbeitsphase hinzufügen – ${fmtDate(day)}` : `Arbeitsphase bearbeiten – ${fmtDate(day)}`,
    build: (form) => {
      const start = timeInput('start', rec ? timeOfDay(rec.start) : '', { required: true });
      const end = timeInput('end', rec?.end ? timeOfDay(rec.end) : '');
      const next = h('input', { type: 'checkbox', name: 'nextDay', checked: endDay !== day });
      const autoNext = () => {
        const s = parseTime(start.value);
        const e = parseTime(end.value);
        if (s && e) next.checked = e.h * 60 + e.min < s.h * 60 + s.min;
      };
      start.addEventListener('change', autoNext);
      end.addEventListener('change', autoNext);
      return [
        h('div', { class: 'row-2' }, field('Beginn', start), field('Ende', end, 'leer = läuft noch')),
        h('label', { class: 'check' }, next, ' Ende am Folgetag (über Mitternacht)'),
        reasonField(),
      ];
    },
    onSubmit: async (form) => {
      const f = new FormData(form);
      const s = f.get('start');
      const e = f.get('end');
      if (!parseTime(s)) throw err('Bitte einen Beginn angeben.');
      const start = localTimestamp(day, s);
      const end = e ? localTimestamp(day, e, f.get('nextDay') ? 1 : 0) : null;
      if (end != null && end < start) throw err('Das Ende liegt vor dem Beginn. Für Arbeit über Mitternacht „Ende am Folgetag“ ankreuzen.');
      const now = Date.now();
      const next = isNew ? newInterval({ kind: 'work', day, start, end, source: 'manual' }, now)
        : touch(rec, { start, end, ...resetBooking(rec, { start, end }) }, now);
      const res = await app.repo.saveIntervals([next], { reason: f.get('reason'), now });
      undoToast(app, isNew ? 'Arbeitsphase hinzugefügt.' : 'Arbeitsphase geändert.', res.changes);
    },
  });
}

// ---------- Pause ----------

const PRESETS = [15, 30, 45, 60];

export function editBreakDialog(app, day, rec = null, sessions = []) {
  const isNew = !rec;
  const initialMode = rec ? (rec.start != null ? 'times' : 'duration') : 'duration';
  return formDialog({
    title: isNew ? `Pause eintragen – ${fmtDate(day)}` : `Pause bearbeiten – ${fmtDate(day)}`,
    build: () => {
      const durF = durationField('Dauer', { name: 'duration', value: rec?.durationMin ? fmtDuration(rec.durationMin) : '', placeholder: 'z. B. 30 min, 0:45 oder 1:15' });
      const chips = h('div', { class: 'chips' }, PRESETS.map((m) => h('button', {
        type: 'button', class: 'chip', onclick: () => setDuration(durF.input, `${m} min`),
      }, `${m} min`)));
      const durBox = h('div', null, chips, durF.field);
      const startT = timeInput('start', rec?.start ? timeOfDay(rec.start) : '');
      const endT = timeInput('end', rec?.end ? timeOfDay(rec.end) : '');
      const timesBox = h('div', { class: 'row-2' }, field('Beginn', startT), field('Ende', endT, 'leer = läuft noch'));
      const modeSel = h('div', { class: 'segmented' },
        h('label', null, h('input', { type: 'radio', name: 'mode', value: 'duration', checked: initialMode === 'duration' }), ' Nur Dauer'),
        h('label', null, h('input', { type: 'radio', name: 'mode', value: 'times', checked: initialMode === 'times' }), ' Von – bis'));
      const update = () => {
        const m = modeSel.querySelector('input:checked').value;
        durBox.hidden = m !== 'duration';
        timesBox.hidden = m !== 'times';
      };
      modeSel.addEventListener('change', update);
      update();
      return [modeSel, durBox, timesBox, reasonField()];
    },
    onSubmit: async (form) => {
      const f = new FormData(form);
      const now = Date.now();
      let fields;
      if (f.get('mode') === 'duration') {
        const min = parseDuration(f.get('duration'));
        if (!min || min <= 0) throw durationError(f.get('duration'), '30 min, 0:45 oder 1:15');
        fields = { start: null, end: null, durationMin: min };
      } else {
        const s = f.get('start');
        if (!parseTime(s)) throw err('Bitte einen Pausenbeginn angeben.');
        const start = resolveBreakTime(day, s, sessions);
        let end = null;
        if (f.get('end')) {
          end = resolveBreakTime(day, f.get('end'), sessions);
          if (end < start) end = localTimestamp(dayKey(start), f.get('end'), 1);
        }
        fields = { start, end, durationMin: null };
      }
      const next = isNew ? newInterval({ kind: 'break', day, source: 'manual', ...fields }, now)
        : touch(rec, { ...fields, ...resetBooking(rec, fields) }, now);
      const res = await app.repo.saveIntervals([next], { reason: f.get('reason'), now });
      undoToast(app, isNew ? 'Pause eingetragen.' : 'Pause geändert.', res.changes);
    },
  });
}

/** Pause mit fester Dauer ohne Dialog nachtragen (Schnellwahl). */
export async function quickBreak(app, day, minutes) {
  try {
    const rec = newInterval({ kind: 'break', day, durationMin: minutes, source: 'manual' });
    const res = await app.repo.saveIntervals([rec], { reason: 'Schnellwahl' });
    undoToast(app, `Pause ${minutes} min für ${fmtDate(day, { year: false })} eingetragen.`, res.changes);
  } catch (e) { app.error(e); }
}

export async function deleteIntervalFlow(app, rec) {
  const label = rec.kind === 'work' ? 'Arbeitsphase' : 'Pause';
  const reason = await formDialog({
    title: `${label} löschen?`,
    submitText: 'Löschen',
    danger: true,
    build: () => [
      h('p', null, rec.start != null
        ? `${label} ${timeOfDay(rec.start)}–${rec.end ? timeOfDay(rec.end) : '…'} wird gelöscht.`
        : `${label} (${fmtDuration(rec.durationMin)}) wird gelöscht.`),
      reasonField(),
    ],
    onSubmit: (form) => new FormData(form).get('reason') || '',
  });
  if (reason === null) return;
  try {
    const res = await app.repo.deleteInterval(rec.id, { reason });
    undoToast(app, `${label} gelöscht.`, res.changes);
  } catch (e) { app.error(e); }
}

// ---------- Tagesangaben ----------

export function editDayInfoDialog(app, day, info) {
  return formDialog({
    title: `Tagesangaben – ${fmtDate(day)}`,
    build: () => [
      field('Tagesart', h('select', { name: 'dayType', class: 'input' },
        Object.entries(DAY_TYPES).map(([k, v]) => h('option', { value: k, selected: (info?.dayType || 'arbeit') === k }, v.label))),
      'Erscheint im Kalender und im Ausbildungsnachweis.'),
      field('Notiz', h('textarea', { name: 'note', class: 'input', rows: 2, maxlength: 500 }, info?.note || '')),
    ],
    onSubmit: async (form) => {
      const f = new FormData(form);
      await app.repo.saveDayInfo(day, { dayType: f.get('dayType'), targetOverrideMin: null, note: f.get('note') || '' });
      toast('Tagesangaben gespeichert.', { type: 'success' });
    },
  });
}

/** Gewählte Buchung eines Stempels zurücksetzen, wenn sich die gestempelte Zeit ändert. */
function resetBooking(rec, changes) {
  const out = {};
  if ('start' in changes && changes.start !== rec.start) Object.assign(out, { startBooked: null, startRound: null });
  if ('end' in changes && changes.end !== rec.end) Object.assign(out, { endBooked: null, endRound: null });
  if ('durationMin' in changes && changes.durationMin !== rec.durationMin) Object.assign(out, { durationBooked: null, startRound: null });
  return out;
}

/**
 * Gebuchte Zeit eines Stempels wählen: alle Rastermarken in der Nähe mit ihrer Wirkung auf das
 * Zeitkonto. So lässt sich z. B. 08:52 als 08:45 (−0:07) oder 09:00 (+0:08) buchen, oder beim Gehen
 * Guthaben „aufbuchen“ (früher gehen, aber später buchen).
 * @param balance aktueller Kontostand (Minuten) für die Anzeige „danach“
 */
/** Nach dem Öffnen die aktuell gebuchte Zeit in die Mitte der Auswahl scrollen. */
function scrollToCurrent(grid) {
  window.requestAnimationFrame(() => grid.querySelector('.choice-current')?.scrollIntoView({ block: 'center' }));
  return grid;
}

export function chooseBookingDialog(app, intervals, st, day, interval, balance) {
  const rec = intervals.find((i) => i.id === st.recId);
  if (!rec) return null;
  const choices = stampChoices(st, interval);
  const fmt = (v) => (st.isDuration ? fmtDuration(v) : timeOfDay(v));
  const save = async (choice) => {
    const field = st.isDuration ? 'durationBooked' : st.field === 'start' ? 'startBooked' : 'endBooked';
    const legacy = st.field === 'start' ? 'startRound' : 'endRound';
    // Die nächstgelegene Marke ist der Standard – dann wird keine Wahl gespeichert.
    const value = choice.nearest ? null : choice.booked;
    const res = await app.repo.saveIntervals([touch(rec, { [field]: value, [legacy]: null })], { reason: 'Gebuchte Zeit gewählt' });
    undoToast(app, `${st.label} wird als ${fmt(choice.booked)} gebucht (${fmtDuration(choice.effect, { sign: true })}).`, res.changes);
  };
  return formDialog({
    title: `${st.label}: gebuchte Zeit wählen`,
    submitText: 'Schließen',
    build: (_form, { close }) => [
      h('p', null, `Gestempelt: ${fmt(st.actual)} · aktuell gebucht: ${fmt(st.booked)} (${fmtDuration(st.effect, { sign: true })})`),
      h('p', { class: 'muted small' }, `Zeitkonto jetzt: ${fmtDuration(balance, { sign: true })}. Grün (+) = Minuten kommen aufs Konto (z. B. Freizeit später), rot (−) = Minuten werden vom Konto genommen.`),
      scrollToCurrent(h('div', { class: 'choice-grid', 'data-testid': 'booking-choices' }, choices.map((c) => {
        const after = balance - st.effect + c.effect;
        return h('button', {
          type: 'button',
          class: `choice${c.booked === st.booked ? ' choice-current' : ''}${c.nearest ? ' choice-nearest' : ''}`,
          'data-booked': fmt(c.booked),
          onclick: async () => {
            try { await save(c); close(true); } catch (e) { app.error(e); }
          },
        },
        h('b', null, fmt(c.booked)),
        h('span', { class: `num ${c.effect > 0 ? 'pos' : c.effect < 0 ? 'neg' : ''}` }, fmtDuration(c.effect, { sign: true })),
        h('span', { class: 'choice-after' }, `Konto ${fmtDuration(after, { sign: true })}`),
        c.nearest ? h('span', { class: 'choice-tag' }, 'Standard') : null);
      }))),
    ],
    onSubmit: () => true,
  });
}


// ---------- Tätigkeiten ----------

/**
 * Zwischenspeicher im Tätigkeitsdialog: zuvor erfasste Tätigkeiten zum Übernehmen.
 * Die Liste filtert sich beim Tippen der Bezeichnung; ein Tipp füllt alle Felder aus.
 */
function memoryPicker(app, form, memory, suggestMin) {
  let hidden = memory.settings?.activityMemoryHidden || [];
  let templates = activityTemplates(memory.activities, hidden);
  const list = h('div', { class: 'memory-list', 'data-testid': 'activity-memory' });
  const box = h('div', { class: 'memory' },
    h('div', { class: 'memory-head' }, 'Aus dem Zwischenspeicher übernehmen'), list);
  const apply = (t) => {
    const el = form.elements;
    el.title.value = t.title;
    setDuration(el.duration, fmtDuration(templateMinutes(t, suggestMin)));
    el.intensity.value = t.intensity || '';
    el.category.value = t.category || '';
    el.description.value = t.description || '';
    render();
    el.duration.focus();
    el.duration.select();
  };
  const remove = async (t) => {
    hidden = hideTemplate(hidden, t.key);
    try {
      const settings = (await app.repo.loadAll()).settings;
      await app.repo.saveSettings({ ...settings, activityMemoryHidden: hidden });
      templates = templates.filter((x) => x.key !== t.key);
      render();
      toast(`„${t.title}“ aus dem Zwischenspeicher entfernt.`);
    } catch (e) { app.error(e); }
  };
  function render() {
    const shown = filterTemplates(templates, form.elements.title?.value || '');
    box.hidden = !templates.length;
    list.replaceChildren(...(shown.length ? shown.map((t) => h('div', { class: 'memory-item' },
      h('button', { type: 'button', class: 'memory-pick', 'data-title': t.title, onclick: () => apply(t) },
        h('b', null, t.title),
        h('span', { class: 'memory-meta' }, [fmtDuration(t.minutes), t.category, t.count > 1 ? `${t.count}×` : null].filter(Boolean).join(' · '))),
      h('button', { type: 'button', class: 'icon-btn memory-remove', 'aria-label': `„${t.title}“ aus dem Zwischenspeicher entfernen`, onclick: () => remove(t) }, '✕')))
      : [h('p', { class: 'muted small' }, 'Kein passender Eintrag – wird nach dem Speichern aufgenommen.')]));
  }
  render();
  // Tippen in „Bezeichnung“ filtert die Liste (am Formular, da das Feld erst danach entsteht).
  form.addEventListener('input', (ev) => { if (ev.target.name === 'title') render(); });
  return box;
}

/**
 * Schnellerfassung (Startseite): Tätigkeit und Dauer in einem kleinen Dialog.
 * Ist die Bezeichnung aus dem Zwischenspeicher bekannt, werden Kategorie, Intensität und
 * Beschreibung übernommen und die zuletzt verwendete Dauer vorgeschlagen.
 * @param openMin noch zu vergebende Minuten des Tages (negativ = zu viel vergeben)
 */
export function quickActivityDialog(app, day, title = '', { openMin = 0, templates = [], onSaved } = {}) {
  const findTemplate = (t) => templates.find((x) => x.title.toLowerCase() === String(t || '').trim().toLowerCase()) || null;
  const tpl = findTemplate(title);
  const initial = tpl ? templateMinutes(tpl, openMin) : openMin > 0 ? openMin : null;
  const hint = openMin > 0 ? `Noch zu vergeben: ${fmtDuration(openMin)}`
    : openMin < 0 ? `Bereits ${fmtDuration(-openMin)} mehr vergeben als die Netto-Arbeitszeit.` : 'Die Netto-Arbeitszeit ist bereits vollständig vergeben.';
  return formDialog({
    title: `Tätigkeit hinzufügen – ${fmtDate(day, { year: false })}`,
    submitText: 'Hinzufügen',
    build: () => {
      const durF = durationField('Dauer', { name: 'duration', value: initial ? fmtDuration(initial) : '', placeholder: 'z. B. 30 min, 0,5 Std. oder 1:30', 'data-testid': 'quick-duration' }, hint);
      const set = (m) => () => setDuration(durF.input, fmtDuration(m));
      return [
        field('Tätigkeit', h('input', { name: 'title', type: 'text', class: 'input', required: true, maxlength: 120, value: title, 'data-nofocus': title ? true : null })),
        durF.field,
        h('div', { class: 'chips dur-chips', 'data-testid': 'duration-chips' },
          openMin > 0 ? h('button', { type: 'button', class: 'chip chip-rest', onclick: set(openMin) }, `Rest ${fmtDuration(openMin)}`) : null,
          [15, 30, 45, 60, 90, 120, 180, 240, 300, 360].map((m) => h('button', { type: 'button', class: 'chip', onclick: set(m) }, fmtDuration(m)))),
      ];
    },
    onSubmit: async (form) => {
      const f = new FormData(form);
      const name = String(f.get('title') || '').trim();
      if (!name) throw err('Bitte eine Tätigkeit eingeben.');
      const minutes = parseDuration(f.get('duration'));
      if (!minutes || minutes <= 0) throw durationError(f.get('duration'));
      const known = findTemplate(name);
      const res = await app.repo.saveActivity({
        day,
        title: known ? known.title : name, // Schreibweise aus dem Zwischenspeicher
        description: known?.description || '',
        minutes,
        intensity: known?.intensity || null,
        category: known?.category || null,
      });
      onSaved?.();
      undoToast(app, `„${known ? known.title : name}“ (${fmtDuration(minutes)}) gespeichert.`, res.changes);
    },
  });
}

/** @param memory { activities, settings } für den Zwischenspeicher (nur beim Erfassen) */
export function editActivityDialog(app, day, rec = null, categories = [], suggestMin = null, memory = null) {
  const listId = 'cat-list';
  return formDialog({
    title: rec ? 'Tätigkeit bearbeiten' : `Tätigkeit erfassen – ${fmtDate(day)}`,
    build: (form) => [
      !rec && memory ? memoryPicker(app, form, memory, suggestMin) : null,
      field('Bezeichnung', h('input', { name: 'title', type: 'text', class: 'input', required: true, maxlength: 120, value: rec?.title || '', placeholder: !rec && memory ? 'Tippen zum Suchen' : '' })),
      durationField('Dauer', { name: 'duration', value: rec ? fmtDuration(rec.minutes) : suggestMin ? fmtDuration(suggestMin) : '', placeholder: 'z. B. 30 min, 0,5 Std. oder 1:30' }, suggestMin && !rec ? `Vorschlag: der noch nicht zugeordnete Rest (${fmtDuration(suggestMin)})` : null).field,
      h('div', { class: 'row-2' },
        field('Intensität', h('select', { name: 'intensity', class: 'input' },
          h('option', { value: '' }, '—'),
          INTENSITIES.map((i) => h('option', { value: i, selected: rec?.intensity === i }, i[0].toUpperCase() + i.slice(1))))),
        field('Kategorie', h('input', { name: 'category', type: 'text', class: 'input', list: listId, maxlength: 60, value: rec?.category || '' }))),
      h('datalist', { id: listId }, categories.map((c) => h('option', { value: c }))),
      field('Beschreibung (optional)', h('textarea', { name: 'description', class: 'input', rows: 3, maxlength: 2000 }, rec?.description || '')),
    ],
    onSubmit: async (form) => {
      const f = new FormData(form);
      const minutes = parseDuration(f.get('duration'));
      if (!minutes || minutes <= 0) throw durationError(f.get('duration'));
      const res = await app.repo.saveActivity({
        ...(rec ? { id: rec.id } : {}),
        day,
        title: f.get('title'),
        description: f.get('description') || '',
        minutes,
        intensity: f.get('intensity') || null,
        category: (f.get('category') || '').trim() || null,
      });
      undoToast(app, rec ? 'Tätigkeit geändert.' : 'Tätigkeit gespeichert.', res.changes);
    },
  });
}

// ---------- Korrekturen ----------

export function editCorrectionDialog(app) {
  return formDialog({
    title: 'Zeitkonto korrigieren',
    build: () => [
      h('p', { class: 'muted' }, 'Eine Korrektur verändert den Saldo direkt (ohne Rundung) und wird mit Begründung protokolliert.'),
      h('div', { class: 'row-2' },
        field('Datum', h('input', { name: 'day', type: 'date', class: 'input', value: todayKey(), required: true })),
        durationField('Zeit (+/−)', { name: 'minutes', placeholder: 'z. B. +1:30 oder -45 min', required: true }, null, { signed: true }).field),
      field('Begründung', h('input', { name: 'reason', type: 'text', class: 'input', required: true, maxlength: 300, placeholder: 'z. B. Überstunden ausgezahlt' })),
    ],
    onSubmit: async (form) => {
      const f = new FormData(form);
      const minutes = parseDuration(f.get('minutes'));
      if (!minutes) throw durationError(f.get('minutes'), '+1:30 oder -45 min');
      if (!isValidDayKey(f.get('day'))) throw err('Bitte ein gültiges Datum angeben.');
      await app.repo.saveCorrection({ day: f.get('day'), minutes, reason: f.get('reason') || '' });
      toast('Korrektur gespeichert.', { type: 'success' });
    },
  });
}

