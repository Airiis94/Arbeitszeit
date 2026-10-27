// End-to-End-Tests im echten Chromium (Playwright) mit echter IndexedDB und Service Worker.
// Die App wird wie auf GitHub Pages unter dem Unterpfad /Arbeitszeit/ ausgeliefert.
// Voraussetzung: `npm install playwright` (bzw. vorhandene Playwright-Installation) und Chromium.
// Aufruf: npm run test:e2e

import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from '../../scripts/serve.js';

// Wie auf GitHub Pages: Die App liegt unter dem Unterpfad /Arbeitszeit/.
const BASE_PATH = '/Arbeitszeit/';
const overrides = new Map();
let server;
let base;
let origin;
let externalRequests = [];
let browser;
let context;
let page;

// Montag, 02.03.2026, Europe/Berlin (MEZ = UTC+1)
const t = (day, hhmm) => new Date(`${day}T${hhmm}:00+01:00`);
const DAY = '2026-03-02';

before(async () => {
  server = createServer({ base: BASE_PATH, overrides }).listen(0);
  await new Promise((r) => server.once('listening', r));
  origin = `http://localhost:${server.address().port}`;
  base = `${origin}${BASE_PATH}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});

after(async () => {
  await browser?.close();
  server?.close();
});

beforeEach(async () => {
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'de-DE', timezoneId: 'Europe/Berlin', acceptDownloads: true });
  externalRequests = [];
  // Datenschutz: Die App darf keine Verbindungen zu fremden Servern aufbauen.
  context.on('request', (r) => {
    const u = new URL(r.url());
    if ((u.protocol === 'http:' || u.protocol === 'https:') && u.origin !== origin) externalRequests.push(r.url());
  });
  page = await context.newPage();
  page.on('pageerror', (e) => { throw e; });
  await page.clock.install({ time: t(DAY, '07:55') });
  await page.goto(base);
  await page.waitForSelector('[data-testid=status]');
});

afterEach(async () => {
  await context?.close();
  overrides.clear();
  assert.deepEqual(externalRequests, [], 'Anfragen an fremde Server');
});

async function setTime(date) {
  await page.clock.setSystemTime(date);
}

async function click(testId) {
  await page.click(`[data-testid=${testId}]`);
}

async function text(testId) {
  return (await page.textContent(`[data-testid=${testId}]`)).trim();
}

async function intervals(p = page) {
  return p.evaluate(async () => (await window.__app.repo.loadAll()).intervals);
}

async function waitStatus(label, p = page) {
  await p.waitForFunction((l) => document.querySelector('[data-testid=status]')?.textContent === l, label);
}

async function rerender(p = page) {
  await p.evaluate(() => window.__app.rerender());
  await p.waitForTimeout(100);
}

/** Zeitkonto-Stand wie auf der Zeitkonto-Seite (auf „Heute“ wird er nicht mehr angezeigt). */
async function balance() {
  return page.evaluate(async () => {
    const { computeAccount } = await import('./js/core/calc.js');
    const { todayKey } = await import('./js/core/time.js');
    const { fmtDuration } = await import('./js/core/time.js');
    const data = await window.__app.repo.loadAll();
    const now = Date.now();
    return fmtDuration(computeAccount({ ...data, today: todayKey(now), now }).balance, { sign: true });
  });
}

async function waitBalance(expected) {
  let got;
  for (let k = 0; k < 50; k += 1) {
    got = await balance();
    if (got === expected) return;
    await page.waitForTimeout(50);
  }
  assert.equal(got, expected);
}

/** Einstellungen öffnen, alle Bereiche aufgeklappt. */
async function openSettings() {
  await page.goto(`${base}#/einstellungen`);
  await page.waitForSelector('details.sec');
  await page.evaluate(() => document.querySelectorAll('details.sec').forEach((d) => { d.open = true; }));
}

async function workday() {
  await setTime(t(DAY, '08:00'));
  await click('btn-start');
  await waitStatus('Arbeit läuft');
  await setTime(t(DAY, '12:00'));
  await click('btn-pause');
  await waitStatus('Pause läuft');
  await setTime(t(DAY, '12:30'));
  await click('btn-resume');
  await waitStatus('Arbeit läuft');
  await setTime(t(DAY, '16:40'));
  await click('btn-end');
  await waitStatus('Nicht eingestempelt');
}

test('Arbeitstag mit wenigen Klicks erfassen; gebucht wird auf Viertelstunden', async () => {
  await workday(); // 08:00–16:40, Pause 12:00–12:30
  assert.equal(await text('net'), '8:15'); // gebucht 08:00–16:45 − 0:30
  assert.equal(await text('breaks'), '0:30');
  assert.match(await page.textContent('[data-testid=stamp-end-work]'), /Gehen 16:40 → 16:45 \(−0:05\)/);
  assert.equal(await page.$('[data-testid=balance]'), null, 'kein Zeitkonto mehr auf „Heute“');
  await page.goto(`${base}#/konto`);
  await page.waitForSelector('[data-testid=account-balance]');
  assert.equal(await text('account-balance'), '−0:05');
});

test('Neuladen während laufender Pause stellt den Zustand wieder her', async () => {
  await setTime(t(DAY, '08:00'));
  await click('btn-start');
  await waitStatus('Arbeit läuft');
  await setTime(t(DAY, '12:00'));
  await click('btn-pause');
  await waitStatus('Pause läuft');
  await setTime(t(DAY, '12:20'));
  await page.reload();
  await waitStatus('Pause läuft');
  assert.equal(await text('net'), '4:00');
  assert.equal(await text('breaks'), '0:20');
});

test('Doppelklick und zweiter Tab erzeugen keine doppelte Buchung', async () => {
  await setTime(t(DAY, '08:00'));
  await page.dblclick('[data-testid=btn-start]');
  await waitStatus('Arbeit läuft');
  // Zweiter Tab mit veralteter Anzeige versucht ebenfalls zu stempeln
  const page2 = await context.newPage();
  await page2.goto(base);
  await page2.waitForSelector('[data-testid=status]');
  const res = await page2.evaluate(async () => {
    try { await window.__app.repo.clock('start'); return 'ok'; } catch (e) { return e.code; }
  });
  assert.equal(res, 'already-running');
  const list = await intervals();
  assert.equal(list.filter((i) => i.kind === 'work').length, 1);
  await page2.close();
});

test('Ungültiger Zustandswechsel zeigt verständliche Fehlermeldung', async () => {
  const res = await page.evaluate(async () => {
    try { await window.__app.repo.clock('pause'); return 'ok'; } catch (e) { return e.message; }
  });
  assert.match(res, /Es läuft keine Arbeitsphase/);
});

test('Vergessener Feierabend wird erkannt und nachträglich korrigiert', async () => {
  await setTime(t(DAY, '08:00'));
  await click('btn-start');
  await waitStatus('Arbeit läuft');
  await setTime(t('2026-03-04', '09:00'));
  await rerender();
  assert.ok(await page.isVisible('text=Feierabend vergessen?'));
  await page.goto(`${base}#/tag/${DAY}`);
  await page.waitForSelector('.entries');
  await page.click('.entry-work button[aria-label=Bearbeiten]');
  await page.fill('dialog input[name=end]', '17:00');
  await page.fill('dialog input[name=reason]', 'Feierabend vergessen');
  await page.click('dialog button[type=submit]');
  await page.waitForSelector('dialog', { state: 'detached' });
  await page.waitForSelector('.badge-complete');
  const list = await intervals();
  assert.equal(list[0].end, t(DAY, '17:00').getTime());
  // Änderungsprotokoll enthält die Begründung
  await page.click('summary:has-text("Änderungsprotokoll")');
  assert.ok(await page.isVisible('text=Grund: Feierabend vergessen'));
});

test('Startseite: Arbeitszeit direkt über „Ändern“ korrigieren (eigenes Symbol, nicht die Stempel-Auswahl)', async () => {
  await workday(); // 08:00–16:40, Pause 12:00–12:30
  await page.goto(`${base}#/heute`);
  await page.waitForSelector('[data-testid=edit-work]');
  assert.match(await page.textContent('[data-testid=edit-work]'), /Ändern/);
  assert.ok(await page.$('[data-testid=edit-work] svg'), 'Symbol Uhr mit Stift');
  assert.ok(await page.$('[data-testid=edit-break]'), 'auch Pausen sind änderbar');
  // Löschen auch hier (z. B. versehentlich gestempelt)
  assert.ok(await page.$('.entry-work button[aria-label=Löschen]'));
  await click('edit-work');
  await page.waitForSelector('dialog input[name=end]');
  assert.match(await page.textContent('dialog'), /Arbeitsphase bearbeiten/);
  await page.fill('dialog input[name=end]', '17:00');
  await page.click('dialog button[type=submit]');
  await page.waitForSelector('dialog', { state: 'detached' });
  await page.waitForFunction(() => document.querySelector('[data-testid=booked-range]')?.textContent === '08:00 – 17:00');
  const list = await intervals();
  assert.equal(list.find((i) => i.kind === 'work').end, t(DAY, '17:00').getTime());
});

test('Pause per Schnellwahl nachtragen und wieder löschen', async () => {
  await setTime(t(DAY, '08:00'));
  await click('btn-start');
  await waitStatus('Arbeit läuft');
  await setTime(t(DAY, '14:00'));
  await page.click('.quick-fold summary');
  await page.click('.quick-fold .chip:has-text("30 min")');
  await page.waitForFunction(() => document.querySelector('[data-testid=breaks]')?.textContent === '0:30');
  assert.equal(await text('net'), '5:30');
  await page.goto(`${base}#/tag/${DAY}`);
  await page.click('.entry-break button[aria-label=Löschen]');
  await page.click('dialog button[type=submit]');
  await page.waitForSelector('dialog', { state: 'detached' });
  await page.waitForTimeout(150);
  const list = await intervals();
  assert.equal(list.filter((i) => i.kind === 'break').length, 0);
});

test('Tätigkeiten erfassen, Summe und Hinweis auf Abweichung', async () => {
  await workday();
  await page.goto(`${base}#/taetigkeiten/${DAY}`);
  await click('add-activity');
  await page.fill('dialog input[name=title]', 'Angebot schreiben');
  await page.fill('dialog input[name=duration]', '1,5h');
  await page.selectOption('dialog select[name=intensity]', 'hoch');
  await page.click('dialog button[type=submit]');
  await page.waitForSelector('[data-testid=activity-sum]');
  assert.equal(await text('activity-sum'), '1:30');
  // Gebucht 08:00–16:45 mit 0:30 Pause = 8:15 netto → noch 6:45 offen
  await page.waitForFunction(() => document.querySelector('[data-testid=activity-check]')?.textContent.includes('Noch 6:45 Tätigkeiten zuordnen'));
  // Der nächste Eintrag schlägt den offenen Rest vor
  await click('add-activity');
  assert.equal(await page.inputValue('dialog input[name=duration]'), '6:45');
  await page.fill('dialog input[name=title]', 'Werkstatt');
  await page.click('dialog button[type=submit]');
  await page.waitForFunction(() => document.querySelector('[data-testid=activity-check]')?.textContent.includes('entsprechen genau'));
  assert.equal(await text('activity-sum'), '8:15');
  assert.match(await text('activity-check'), /Festgelegte Netto-Arbeitszeit: 8:15/);
  // Zu viel erfasst → Hinweis zum Kürzen
  await click('add-activity');
  await page.fill('dialog input[name=title]', 'Zu viel');
  await page.fill('dialog input[name=duration]', '15');
  await page.click('dialog button[type=submit]');
  await page.waitForFunction(() => document.querySelector('[data-testid=activity-check]')?.textContent.includes('0:15 länger'));
});

test('Zwischenspeicher: frühere Tätigkeiten an anderen Tagen auswählen statt neu eingeben', async () => {
  await workday(); // gebucht 8:15 netto
  await page.goto(`${base}#/taetigkeiten/${DAY}`);
  await click('add-activity');
  await page.fill('dialog input[name=title]', 'Schaltschrank verdrahten');
  await page.fill('dialog input[name=duration]', '5:15');
  await page.fill('dialog input[name=category]', 'Werkstatt');
  await page.selectOption('dialog select[name=intensity]', 'hoch');
  await page.click('dialog button[type=submit]');
  await page.waitForSelector('dialog', { state: 'detached' });
  await click('add-activity');
  // Zwischenspeicher zeigt die eben erfasste Tätigkeit
  await page.waitForSelector('dialog [data-testid=activity-memory] button[data-title="Schaltschrank verdrahten"]');
  await page.fill('dialog input[name=title]', 'Unterweisung');
  await page.fill('dialog input[name=duration]', '3:00');
  await page.click('dialog button[type=submit]');
  await page.waitForFunction(() => document.querySelector('[data-testid=activity-check]')?.textContent.includes('entsprechen genau'));

  // Folgetag: auswählen statt neu eingeben
  const NEXT = '2026-03-03';
  await page.goto(`${base}#/taetigkeiten/${NEXT}`);
  await click('add-activity');
  const titles = await page.$$eval('dialog [data-testid=activity-memory] .memory-pick', (bs) => bs.map((b) => b.dataset.title));
  assert.deepEqual(titles.sort(), ['Schaltschrank verdrahten', 'Unterweisung']);
  // Tippen filtert die Liste
  await page.fill('dialog input[name=title]', 'schalt');
  await page.waitForFunction(() => document.querySelectorAll('dialog .memory-pick').length === 1);
  await page.click('dialog .memory-pick[data-title="Schaltschrank verdrahten"]');
  assert.equal(await page.inputValue('dialog input[name=title]'), 'Schaltschrank verdrahten');
  assert.equal(await page.inputValue('dialog input[name=duration]'), '5:15');
  assert.equal(await page.inputValue('dialog input[name=category]'), 'Werkstatt');
  assert.equal(await page.inputValue('dialog select[name=intensity]'), 'hoch');
  await page.click('dialog button[type=submit]');
  await page.waitForSelector('[data-testid=activity-sum]');
  assert.equal(await text('activity-sum'), '5:15');
  const saved = await page.evaluate(async () => (await window.__app.repo.loadAll()).activities.filter((a) => a.day === '2026-03-03'));
  assert.deepEqual(saved.map((a) => [a.title, a.minutes, a.category, a.intensity]), [['Schaltschrank verdrahten', 315, 'Werkstatt', 'hoch']]);

  // Eintrag aus dem Zwischenspeicher entfernen – die gespeicherten Tätigkeiten bleiben
  await click('add-activity');
  await page.click('dialog .memory-item:has([data-title="Unterweisung"]) .memory-remove');
  await page.waitForFunction(() => !document.querySelector('dialog .memory-pick[data-title="Unterweisung"]'));
  await page.click('dialog button.btn:not([type=submit])');
  await page.waitForSelector('dialog', { state: 'detached' });
  const all = await page.evaluate(async () => (await window.__app.repo.loadAll()).activities.filter((a) => !a.deleted).length);
  assert.equal(all, 3);
  await page.reload();
  await page.waitForSelector('[data-testid=add-activity]');
  await click('add-activity');
  await page.waitForSelector('dialog .memory-pick');
  assert.equal(await page.$('dialog .memory-pick[data-title="Unterweisung"]'), null);
});

test('Startseite: Tätigkeit mit Dauer per Uhr-Knopf erfassen, offene Zeit wird angezeigt', async () => {
  await workday(); // gebucht 8:15 netto
  await page.goto(`${base}#/heute`);
  await page.waitForSelector('[data-testid=activity-rest]');
  assert.match(await text('activity-rest'), /offen\s*8:15/);
  // Eintippen, Uhr antippen, Dauer per Schnellwahl
  await page.fill('[data-testid=quick-activity]', 'Löten');
  await click('quick-activity-time');
  assert.equal(await page.inputValue('dialog [data-testid=quick-duration]'), '8:15'); // Vorschlag: offener Rest
  await page.click('dialog [data-testid=duration-chips] button:has-text("2:00")');
  await page.click('dialog button[type=submit]');
  await page.waitForFunction(() => /offen\s*6:15/.test(document.querySelector('[data-testid=activity-rest]')?.textContent || ''));
  assert.equal(await page.inputValue('[data-testid=quick-activity]'), ''); // Eingabe geleert
  // Bekannte Tätigkeit (Zwischenspeicher): Kategorie wird übernommen, Enter öffnet den Dialog
  await page.evaluate(async () => {
    await window.__app.repo.saveActivity({ day: '2026-02-27', title: 'Messen', minutes: 90, intensity: 'hoch', category: 'Werkstatt', description: '' });
  });
  await page.fill('[data-testid=quick-activity]', 'messen');
  await page.press('[data-testid=quick-activity]', 'Enter');
  assert.equal(await page.inputValue('dialog [data-testid=quick-duration]'), '1:30');
  await page.click('dialog [data-testid=duration-chips] .chip-rest'); // Rest 6:15
  await page.click('dialog button[type=submit]');
  await page.waitForFunction(() => /vergeben/.test(document.querySelector('[data-testid=activity-rest]')?.textContent || ''));
  const acts = await page.evaluate(async () => (await window.__app.repo.loadAll()).activities.filter((a) => a.day === '2026-03-02'));
  assert.deepEqual(acts.map((a) => [a.title, a.minutes, a.category, a.intensity]).sort(), [['Löten', 120, null, null], ['Messen', 375, 'Werkstatt', 'hoch']]);
  // Ohne Dauer wird nicht gespeichert
  await page.fill('[data-testid=quick-activity]', 'Test');
  await click('quick-activity-time');
  await page.fill('dialog [data-testid=quick-duration]', '');
  await page.click('dialog button[type=submit]');
  await page.waitForSelector('dialog .dialog-error:not([hidden])');
});

test('Tätigkeiten Wochen später ergänzen: 0,5 = 30 min, „1“ wird nachgefragt, Summen stimmen', async () => {
  await workday(); // Mo 02.03.: gebucht 08:00–16:45, Pause 0:30 → 8:15 netto
  // Alter Eintrag aus der früheren Eingabelogik: „1“ wurde als 1 Minute gespeichert
  await page.evaluate(async () => {
    await window.__app.repo.saveActivity({ day: '2026-03-02', title: 'Altlast', minutes: 1, intensity: null, category: null, description: '' });
  });
  // drei Wochen später
  await setTime(t('2026-03-23', '10:00'));
  await page.goto(`${base}#/taetigkeiten/2026-03-23`);
  await page.waitForSelector('[data-testid=open-days]');
  assert.match(await text('open-days'), /02\.03\.\s*noch 8:14 offen/);
  await page.click('[data-testid=open-days] a');
  await page.waitForFunction(() => location.hash === '#/taetigkeiten/2026-03-02');
  await page.waitForSelector('[data-testid=unit-warning]');
  // Reparatur des alten Eintrags: 1 min → 1 Std.
  await page.click('[data-testid=unit-warning] button');
  await page.waitForFunction(() => document.querySelector('[data-testid=activity-check]')?.textContent.includes('Noch 7:15'));
  assert.equal(await page.$('[data-testid=unit-warning]'), null);

  const add = async (title, duration) => {
    await click('add-activity');
    await page.fill('dialog input[name=title]', title);
    await page.fill('dialog input[name=duration]', duration);
  };
  // „1“ ohne Einheit: nicht eindeutig → Nachfrage statt still 1 Minute
  await add('Löten', '1');
  assert.match(await page.textContent('dialog [data-testid=duration-preview]'), /Gemeint: 1 Std\. oder 1 min/);
  await page.click('dialog button[type=submit]');
  await page.waitForSelector('dialog .dialog-error:not([hidden])');
  assert.match(await page.textContent('dialog .dialog-error'), /„1“ ist nicht eindeutig/);
  await page.click('dialog [data-testid=duration-preview] button:has-text("1 Std.")');
  assert.equal(await page.inputValue('dialog input[name=duration]'), '1:00');
  assert.equal(await page.textContent('dialog [data-testid=duration-preview]'), '= 1:00 Std. · 60 min · 1,00 Std.');
  await page.click('dialog button[type=submit]');
  await page.waitForSelector('dialog', { state: 'detached' });
  // 0,5 und 30 min sind dasselbe
  await add('Messen', '0,5');
  assert.equal(await page.textContent('dialog [data-testid=duration-preview]'), '= 0:30 Std. · 30 min · 0,50 Std.');
  await page.click('dialog button[type=submit]');
  await page.waitForSelector('dialog', { state: 'detached' });
  await add('Aufräumen', '30 min');
  await page.click('dialog button[type=submit]');
  await page.waitForSelector('dialog', { state: 'detached' });
  await page.waitForFunction(() => document.querySelector('[data-testid=activity-sum]')?.textContent === '3:00');
  assert.match(await text('activity-check'), /Noch 5:15 Tätigkeiten zuordnen/);
  // Rest per Vorschlag auffüllen → passt genau
  await click('add-activity');
  await page.fill('dialog input[name=title]', 'Werkstatt');
  assert.equal(await page.inputValue('dialog input[name=duration]'), '5:15');
  await page.click('dialog button[type=submit]');
  await page.waitForFunction(() => document.querySelector('[data-testid=activity-check]')?.textContent.includes('entsprechen genau'));
  // Nachweis (Einzelstunden) rechnet mit denselben Minuten
  const lines = await page.evaluate(async () => {
    const { buildWeekReport } = await import('./js/core/nachweis.js');
    const d = await window.__app.repo.loadAll();
    const rep = buildWeekReport({ weekStart: '2026-03-02', ...d, now: Date.now() });
    return { mins: rep.days[0].lines.map((l) => l.minutes), net: rep.days[0].netMin };
  });
  assert.deepEqual(lines.mins.sort((a, b) => a - b), [30, 30, 60, 60, 315]);
  assert.equal(lines.mins.reduce((a, b) => a + b, 0), lines.net);
  // Tag per Datumsauswahl wählen; der ergänzte Tag ist nicht mehr offen
  await page.fill('[data-testid=activity-day]', '2026-03-23');
  await page.waitForFunction(() => location.hash === '#/taetigkeiten/2026-03-23');
  await page.waitForTimeout(150);
  assert.equal(await page.$('[data-testid=open-days]'), null);
});

test('Tag würfeln: Rest der Netto-Arbeitszeit aus der eigenen Statistik füllen, eigene Einträge bleiben', async () => {
  // Statistik: 3 Wochen mit „Versenden“ (täglich) und „Patch löten“ (jeden 2. Tag)
  await page.evaluate(async () => {
    const r = window.__app.repo;
    const { addDays } = await import('./js/core/time.js');
    let i = 0;
    for (let d = '2026-02-09'; d < '2026-03-02'; d = addDays(d, 1)) {
      const wd = new Date(`${d}T12:00:00`).getDay();
      if (wd === 0 || wd === 6) continue;
      await r.saveActivity({ day: d, title: 'Versenden', minutes: 180, intensity: null, category: 'Versand', description: '' });
      await r.saveActivity({ day: d, title: i % 2 ? 'Kommissionieren' : 'Patch löten', minutes: 300, intensity: null, category: 'Werkstatt', description: '' });
      i += 1;
    }
  });
  await workday(); // 02.03.: 8:15 netto
  await page.goto(`${base}#/taetigkeiten/${DAY}`);
  // eigene neue Tätigkeit, der Rest wird gewürfelt
  await click('add-activity');
  await page.fill('dialog input[name=title]', 'Besichtigung Versandlager');
  await page.fill('dialog input[name=duration]', '1:00');
  await page.click('dialog button[type=submit]');
  await page.waitForFunction(() => document.querySelector('[data-testid=activity-check]')?.textContent.includes('Noch 7:15'));
  await click('dice-day');
  await page.waitForSelector('[data-testid=dice-list] li');
  assert.match(await page.textContent('dialog'), /Rest des Tages würfeln/);
  assert.equal(await text('dice-sum'), '7:15');
  const durations = async () => page.$$eval('[data-testid=dice-list] .dice-dur', (els) => els.map((e) => e.textContent));
  const toMin = (x) => { const [hh, mm] = x.split(':').map(Number); return hh * 60 + mm; };
  for (let k = 0; k < 5; k += 1) {
    const ds = await durations();
    assert.equal(ds.map(toMin).reduce((a, b) => a + b, 0), 435, ds.join(' + '));
    await click('dice-reroll');
  }
  await page.click('dialog button[type=submit]');
  await page.waitForSelector('dialog', { state: 'detached' });
  await page.waitForFunction(() => document.querySelector('[data-testid=activity-check]')?.textContent.includes('entsprechen genau'));
  const acts = await page.evaluate(async () => (await window.__app.repo.loadAll()).activities.filter((a) => a.day === '2026-03-02'));
  assert.ok(acts.some((a) => a.title === 'Besichtigung Versandlager' && a.minutes === 60), 'eigener Eintrag bleibt');
  assert.equal(acts.reduce((x, a) => x + a.minutes, 0), 495);
  assert.ok(acts.filter((a) => a.title !== 'Besichtigung Versandlager').every((a) => ['Versenden', 'Patch löten', 'Kommissionieren'].includes(a.title)));
  assert.equal(await page.$('[data-testid=dice-day]'), null); // nichts mehr offen
  // „Rückgängig“ entfernt nur die gewürfelten Einträge
  await page.click('.toast:has-text("übernommen") .toast-action');
  await page.waitForFunction(() => document.querySelector('[data-testid=activity-check]')?.textContent.includes('Noch 7:15'));
  const after = await page.evaluate(async () => (await window.__app.repo.loadAll()).activities.filter((a) => a.day === '2026-03-02').map((a) => a.title));
  assert.deepEqual(after, ['Besichtigung Versandlager']);
});

/** Wartet, bis die gespeicherten Einstellungen die Bedingung erfüllen (waitForFunction kann nicht auf Promises warten). */
async function pollSettings(ok) {
  let s;
  for (let k = 0; k < 50; k += 1) {
    s = await page.evaluate(async () => (await window.__app.repo.loadAll()).settings);
    if (ok(s)) return s;
    await page.waitForTimeout(50);
  }
  throw new Error(`Einstellungen nicht wie erwartet: ${JSON.stringify(s)}`);
}

test('Tag würfeln: festhalten, Auswahl, gewürfelte zählen nicht zur Statistik', async () => {
  await page.evaluate(async () => {
    const r = window.__app.repo;
    const { addDays } = await import('./js/core/time.js');
    let i = 0;
    for (let d = '2026-02-09'; d < '2026-03-02'; d = addDays(d, 1)) {
      const wd = new Date(`${d}T12:00:00`).getDay();
      if (wd === 0 || wd === 6) continue;
      await r.saveActivity({ day: d, title: 'Versenden', minutes: 120, intensity: null, category: 'Versand', description: '' });
      await r.saveActivity({ day: d, title: i % 2 ? 'Kommissionieren' : 'Patch löten', minutes: 240, intensity: null, category: 'Werkstatt', description: '' });
      await r.saveActivity({ day: d, title: 'Prüfen', minutes: 120, intensity: null, category: 'Werkstatt', description: '' });
      // früher gewürfelt – darf nicht in die Statistik
      await r.saveActivity({ day: d, title: 'Nur gewürfelt', minutes: 15, intensity: null, category: null, description: '', source: 'dice' });
      i += 1;
    }
  });
  await workday(); // 02.03.: 8:15 netto
  await page.goto(`${base}#/taetigkeiten/${DAY}`);
  await click('dice-day');
  await page.waitForSelector('[data-testid=dice-list] li');
  const items = async () => page.$$eval('[data-testid=dice-list] li', (els) => els.map((e) => ({
    title: e.querySelector('b').textContent, dur: e.querySelector('.dice-dur').textContent,
    locked: e.querySelector('[data-testid=dice-lock]').getAttribute('aria-pressed') === 'true',
  })));
  const toMin = (x) => { const [hh, mm] = x.split(':').map(Number); return hh * 60 + mm; };
  // Auswahl im Fenster: gewürfelte Tätigkeiten stehen nicht zur Wahl; „Kommissionieren“ ausschließen
  await page.click('[data-testid=dice-picker] summary');
  const chips = await page.$$eval('[data-testid=dice-pick]', (els) => els.map((e) => e.textContent));
  assert.deepEqual(chips.sort(), ['Kommissionieren', 'Patch löten', 'Prüfen', 'Versenden']);
  await page.click('[data-testid=dice-pick]:has-text("Kommissionieren")');
  await pollSettings((s) => (s.diceExcluded || []).length === 1);
  assert.match(await page.textContent('[data-testid=dice-picker] summary'), /3 von 4/);
  // erste Tätigkeit festhalten, mehrfach neu würfeln: bleibt, Summe stimmt, Ausgeschlossenes kommt nicht vor
  await page.click('[data-testid=dice-list] li:first-child [data-testid=dice-lock]');
  const keep = (await items())[0];
  assert.equal(keep.locked, true);
  for (let k = 0; k < 8; k += 1) {
    await click('dice-reroll');
    const list = await items();
    assert.deepEqual(list[0], keep);
    assert.equal(list.map((x) => toMin(x.dur)).reduce((a, b) => a + b, 0), 495);
    assert.ok(list.every((x) => !['Kommissionieren', 'Nur gewürfelt'].includes(x.title)), JSON.stringify(list));
    assert.equal(new Set(list.map((x) => x.title)).size, list.length, 'keine doppelte Tätigkeit');
  }
  await page.click('dialog button[type=submit]');
  await page.waitForSelector('dialog', { state: 'detached' });
  await page.waitForFunction(() => document.querySelector('[data-testid=activity-check]')?.textContent.includes('entsprechen genau'));
  const acts = await page.evaluate(async () => (await window.__app.repo.loadAll()).activities.filter((a) => a.day === '2026-03-02' && !a.deleted));
  assert.ok(acts.length > 0 && acts.every((a) => a.source === 'dice'), 'als gewürfelt markiert');
  assert.equal(await page.locator('.act-dice').count(), acts.length);
  // Bearbeiten macht aus einer gewürfelten eine selbst eingetragene Tätigkeit
  await page.click('[aria-label=Bearbeiten] >> nth=0');
  await page.click('dialog button[type=submit]');
  await page.waitForSelector('dialog', { state: 'detached' });
  await page.waitForFunction((n) => document.querySelectorAll('.act-dice').length === n - 1, acts.length);
  const manual = await page.evaluate(async () => (await window.__app.repo.loadAll()).activities.filter((a) => a.day === '2026-03-02' && !a.deleted && a.source !== 'dice').length);
  assert.equal(manual, 1);
  // Einstellungen zeigen dieselbe Auswahl; dort wieder aufnehmen
  await openSettings();
  await page.waitForSelector('[data-testid=dice-settings]');
  const boxes = await page.$$eval('[data-testid=dice-setting]', (els) => els.map((e) => [e.parentElement.textContent.split(' · ')[0].trim(), e.checked]));
  assert.deepEqual(Object.fromEntries(boxes), { Versenden: true, 'Patch löten': true, Prüfen: true, Kommissionieren: false });
  await page.check('[data-testid=dice-settings] label:has-text("Kommissionieren") input');
  await page.selectOption('[data-testid=dice-weeks-setting]', '4');
  await pollSettings((s) => s.diceExcluded.length === 0 && s.diceWeeks === 4);
  // gleichzeitige Änderungen gehen nicht verloren
  const both = await page.evaluate(async () => {
    const r = window.__app.repo;
    await Promise.all([r.updateSettings({ diceWeeks: 12 }), r.updateSettings({ diceExcluded: ['x'] }), r.updateSettings({ theme: 'dark' })]);
    const s = (await r.loadAll()).settings;
    return [s.diceWeeks, s.diceExcluded, s.theme, s.accountStart];
  });
  assert.deepEqual(both, [12, ['x'], 'dark', '2026-03-02']);
});

test('Urlaub eintragen: zählt als Netto-Arbeitszeit der Woche, Zeitkonto unverändert, Wochenende übersprungen', async () => {
  await workday(); // Mo 02.03.: 8:15 netto, Gehen 16:40 → 16:45 = −0:05
  await page.goto(`${base}#/konto`);
  await page.waitForSelector('[data-testid=account-balance]');
  const balance = await text('account-balance');
  await page.goto(`${base}#/kalender/woche/${DAY}`);
  await click('week-vacation');
  await page.fill('dialog [data-testid=vac-from]', '2026-03-03');
  await page.fill('dialog [data-testid=vac-to]', '2026-03-08'); // Di–So
  await page.fill('dialog input[name=creditStart]', '09:00');
  await page.fill('dialog [data-testid=credit-duration]', '8:00');
  assert.equal(await page.inputValue('dialog input[name=creditEnd]'), '17:00');
  await page.click('dialog button[type=submit]');
  await page.waitForSelector('dialog', { state: 'detached' });
  await page.waitForSelector('[data-testid=credit-sum]');
  assert.match(await text('credit-sum'), /32:00/); // Di–Fr je 8:00
  const infos = await page.evaluate(async () => (await window.__app.repo.loadAll()).dayInfos.map((d) => [d.day, d.dayType, d.creditMin, d.creditStart, d.creditEnd]).sort());
  assert.deepEqual(infos, ['03', '04', '05', '06'].map((d) => [`2026-03-${d}`, 'urlaub', 480, '09:00', '17:00']));
  // Ausbildungsnachweis: Woche 8:15 + 4 × 8:00
  const rep = await page.evaluate(async () => {
    const { buildWeekReport } = await import('./js/core/nachweis.js');
    const d = await window.__app.repo.loadAll();
    const r = buildWeekReport({ weekStart: '2026-03-02', ...d, now: Date.now() });
    return { total: r.totalMin, tue: r.days[1].times };
  });
  assert.equal(rep.total, 495 + 4 * 480);
  assert.deepEqual(rep.tue, ['09:00–17:00', 'Urlaub']);
  // Zeitkonto unverändert, Tagesansicht zeigt die Anrechnung
  await page.goto(`${base}#/konto`);
  await page.waitForSelector('[data-testid=account-balance]');
  assert.equal(await text('account-balance'), balance);
  await page.goto(`${base}#/tag/2026-03-04`);
  await page.waitForSelector('[data-testid=credit-info]');
  assert.match(await text('credit-info'), /8:00 Std\. als Arbeitszeit angerechnet \(09:00–17:00\)/);
  // Urlaubstag braucht keine Tätigkeiten
  await page.goto(`${base}#/taetigkeiten/2026-03-04`);
  await page.waitForSelector('[data-testid=add-activity]');
  assert.equal(await page.$('[data-testid=activity-check]'), null);
});

test('Korrektur mit Begründung verändert den Saldo', async () => {
  await workday();
  await page.goto(`${base}#/konto`);
  await click('add-correction');
  await page.fill('dialog input[name=minutes]', '+1:30');
  await page.fill('dialog input[name=reason]', 'Dienstreise');
  await page.click('dialog button[type=submit]');
  await page.waitForFunction(() => document.querySelector('[data-testid=account-balance]')?.textContent === '+1:25');
});

test('Export → Löschen → Import stellt alle Daten wieder her', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'az-'));
  await workday();
  await openSettings();
  const [download] = await Promise.all([page.waitForEvent('download'), click('export')]);
  const file = join(dir, download.suggestedFilename());
  await download.saveAs(file);
  const backup = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(backup.format, 'arbeitszeit-backup');
  assert.equal(backup.data.intervals.length, 2);
  await page.waitForFunction(() => /aktuell/.test(document.querySelector('[data-testid=backup-state]')?.textContent || ''));

  const before = await intervals();
  await page.evaluate(() => window.__app.repo.wipe());
  assert.equal((await intervals()).length, 0);

  await openSettings();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), click('import')]);
  await chooser.setFiles(file);
  await page.waitForSelector('dialog');
  await page.check('dialog input[value=replace]');
  await page.uncheck('dialog input[name=backupFirst]');
  await page.click('dialog button[type=submit]');
  await page.waitForSelector('dialog', { state: 'detached' });
  const restored = await intervals();
  assert.deepEqual(restored.sort((a, b) => a.start - b.start), before.sort((a, b) => a.start - b.start));
});

test('Sicherungskopie auf dem Gerät: früheren Stand wiederherstellen, aktueller Stand wird vorher gesichert', async () => {
  await workday();
  await page.evaluate(async () => {
    const r = window.__app.repo;
    await r.saveActivity({ day: '2026-03-02', title: 'Löten', minutes: 240, intensity: null, category: 'Werkstatt', description: '' });
    await r.saveSnapshot('Test');
    // danach versehentlich gelöscht
    await r.deleteActivity((await r.loadAll()).activities[0].id);
  });
  assert.equal(await page.evaluate(async () => (await window.__app.repo.loadAll()).activities.length), 0);
  await openSettings();
  await page.waitForSelector('[data-testid=snapshots]');
  assert.match(await text('snapshots'), /Test\s*1 Buchungen|Test.*2 Buchungen/s);
  await page.click('[data-testid=snapshots] li:has-text("Test") [data-testid=snapshot-restore]');
  await page.click('dialog button[type=submit]');
  const titles = () => page.evaluate(async () => (await window.__app.repo.loadAll()).activities.map((a) => a.title));
  for (let i = 0; i < 30 && (await titles()).length === 0; i += 1) await page.waitForTimeout(100);
  const acts = await titles();
  assert.deepEqual(acts, ['Löten']);
  // der Stand vor dem Wiederherstellen ist selbst als Kopie da (rückgängig machbar)
  const snaps = await page.evaluate(() => window.__app.repo.listSnapshots());
  assert.ok(snaps.some((x) => x.reason === 'vor Wiederherstellen' && x.counts.activities === 0));
  // tägliche Kopie beim Start: am nächsten Tag genau eine, auch bei mehrfachem Öffnen
  const dailyCount = async () => (await page.evaluate(() => window.__app.repo.listSnapshots())).filter((x) => x.reason === 'täglich').length;
  assert.equal(await dailyCount(), 0); // heute gibt es schon frische Kopien
  await setTime(t('2026-03-03', '14:00')); // > 20 h nach der letzten Kopie
  await page.goto(`${base}#/heute`);
  await page.reload();
  await page.waitForSelector('[data-testid=status]');
  for (let i = 0; i < 20 && await dailyCount() === 0; i += 1) await page.waitForTimeout(100);
  assert.equal(await dailyCount(), 1);
  await page.reload();
  await page.waitForSelector('[data-testid=status]');
  await page.waitForTimeout(300);
  assert.equal(await dailyCount(), 1);
});

test('Fehlerhafte Importdatei wird abgelehnt, Daten bleiben unverändert', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'az-'));
  await workday();
  const bad = join(dir, 'kaputt.json');
  await writeFile(bad, '{"format":"arbeitszeit-backup","schemaVersion":1,"data":{"intervals":[{"id":1}]');
  await openSettings();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), click('import')]);
  await chooser.setFiles(bad);
  await page.waitForSelector('dialog:has-text("Import nicht möglich")');
  assert.ok(await page.isVisible('text=kein gültiges JSON'));
  await page.click('dialog button[type=submit]');
  assert.equal((await intervals()).length, 2);
});

test('App startet offline aus dem Service-Worker-Cache', async () => {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('[data-testid=status]');
  await setTime(t(DAY, '08:00'));
  await click('btn-start');
  await waitStatus('Arbeit läuft');
  await context.setOffline(false);
});

test('Fehlbuchung per „Rückgängig“ zurücknehmen', async () => {
  await setTime(t(DAY, '08:00'));
  await click('btn-start');
  await waitStatus('Arbeit läuft');
  await setTime(t(DAY, '08:01'));
  await click('btn-end');
  await waitStatus('Nicht eingestempelt');
  await page.click('.toast:last-child .toast-action');
  await waitStatus('Arbeit läuft');
  const work = (await intervals()).find((i) => i.kind === 'work');
  assert.equal(work.end, null);
});

test('Versehentlich gestempelt (Arbeit + laufende Pause): auf der Startseite löschen, Pause wird mitgelöscht', async () => {
  await setTime(t(DAY, '23:54'));
  await click('btn-start');
  await waitStatus('Arbeit läuft');
  await click('btn-pause');
  await waitStatus('Pause läuft');
  await setTime(t(DAY, '23:55'));
  await page.click('.entry-work [aria-label=Löschen]');
  await page.waitForSelector('[data-testid=delete-with-breaks]');
  assert.match(await text('delete-with-breaks'), /Pause 23:54–läuft wird mitgelöscht/);
  await page.click('dialog button[type=submit]');
  await waitStatus('Nicht eingestempelt');
  assert.deepEqual(await intervals(), []);
  assert.equal(await page.$('.toast-error'), null);
  // Rückgängig stellt beides wieder her
  await page.click('.toast:has-text("gelöscht") .toast-action');
  await waitStatus('Pause läuft');
  assert.equal((await intervals()).length, 2);
});

test('Zusammenführen einer Sicherung überschreibt keine neueren lokalen Daten', async () => {
  await workday();
  const backup = await page.evaluate(async () => {
    const { buildBackup } = await import('./js/core/backup-format.js');
    const data = await window.__app.repo.exportData();
    delete data.meta;
    return buildBackup(data);
  });
  // lokal danach geändert: Feierabend korrigiert
  await page.evaluate(async () => {
    const { touch } = await import('./js/core/model.js');
    const { intervals } = await window.__app.repo.loadAll();
    const w = intervals.find((i) => i.kind === 'work');
    await window.__app.repo.saveIntervals([touch(w, { end: w.end + 30 * 60000 })], { reason: 'später gegangen' });
  });
  const stats = await page.evaluate((b) => window.__app.repo.importMerge(b.data), backup);
  assert.equal(stats.intervals.keptLocal, 1);
  const work = (await intervals()).find((i) => i.kind === 'work');
  assert.equal(work.end, t(DAY, '17:10').getTime());
});

// ---------- Veröffentlichung auf GitHub Pages (Unterpfad) und Android ----------

async function waitForServiceWorkerControl() {
  await page.evaluate(() => navigator.serviceWorker.ready);
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
}

test('Manifest, Icons, Start-URL und Service Worker funktionieren im Unterpfad /Arbeitszeit/', async () => {
  await waitForServiceWorkerControl();
  const info = await page.evaluate(async () => {
    const link = document.querySelector('link[rel=manifest]').href;
    const res = await fetch(link);
    const m = await res.json();
    const abs = (u) => new URL(u, link).href;
    const icons = [];
    for (const i of m.icons) {
      const r = await fetch(abs(i.src));
      icons.push({ src: abs(i.src), status: r.status, type: r.headers.get('content-type'), sizes: i.sizes });
    }
    const reg = await navigator.serviceWorker.getRegistration();
    return { link, status: res.status, name: m.name, short: m.short_name, display: m.display,
      start: abs(m.start_url), scope: abs(m.scope), id: abs(m.id), icons, swScope: reg.scope };
  });
  assert.equal(info.status, 200);
  assert.equal(info.link, `${base}manifest.webmanifest`);
  assert.equal(info.short, 'Arbeitszeit');
  assert.equal(info.display, 'standalone');
  assert.equal(info.scope, base);
  assert.equal(info.id, base);
  assert.equal(info.start, `${base}#/heute`);
  assert.equal(info.swScope, base);
  for (const i of info.icons) {
    assert.equal(i.status, 200, i.src);
    assert.ok(i.src.startsWith(base), i.src);
  }
  assert.ok(info.icons.some((i) => i.sizes === '512x512' && i.type === 'image/png'));
  // Chromes eigene Installierbarkeitsprüfung (Grundlage für „App installieren“)
  const cdp = await context.newCDPSession(page);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  assert.deepEqual(installabilityErrors, []);
  const { url: manifestUrl, errors } = await cdp.send('Page.getAppManifest');
  assert.equal(manifestUrl, `${base}manifest.webmanifest`);
  assert.deepEqual(errors, []);
  // Adresse ohne abschließenden Schrägstrich leitet weiter (wie GitHub Pages)
  const p2 = await context.newPage();
  await p2.goto(base.replace(/\/$/, ''));
  assert.equal(p2.url().startsWith(base), true);
  await p2.close();
});

test('App-Update: Hinweis statt ungefragtem Neuladen, Daten bleiben erhalten', async () => {
  await waitForServiceWorkerControl();
  await setTime(t(DAY, '08:00'));
  await click('btn-start');
  await waitStatus('Arbeit läuft');
  await page.evaluate(() => { window.__marker = 'unverändert'; });

  // Neue Version veröffentlichen (wie der Workflow: neue VERSION in sw.js)
  const sw = await readFile(new URL('../../app/sw.js', import.meta.url), 'utf8');
  const updated = sw.replace(/^const VERSION = '.*';/m, "const VERSION = 'v-test-update';");
  assert.notEqual(updated, sw);
  overrides.set('sw.js', updated);
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
  await page.waitForSelector('#update-banner');
  // Laufende Bedienung wurde nicht unterbrochen
  assert.equal(await page.evaluate(() => window.__marker), 'unverändert');
  await waitStatus('Arbeit läuft');

  await Promise.all([page.waitForEvent('load'), page.click('#update-banner button')]);
  await waitStatus('Arbeit läuft');
  const keys = await page.evaluate(() => caches.keys());
  assert.deepEqual(keys, ['arbeitszeit-v-test-update']);
  // Vor dem Update wurde automatisch eine Sicherungskopie der Daten angelegt
  const snaps = await page.evaluate(() => window.__app.repo.listSnapshots());
  assert.ok(snaps.some((x) => x.reason === 'vor Update' && x.counts.intervals === 1), JSON.stringify(snaps));
  const list = await intervals();
  assert.equal(list.length, 1);
  assert.equal(list[0].start, t(DAY, '08:00').getTime());
  // Neue Version funktioniert offline
  await context.setOffline(true);
  await page.reload();
  await waitStatus('Arbeit läuft');
  await context.setOffline(false);
});

test('Daten überstehen Schließen und erneutes Öffnen der App', async () => {
  await workday();
  await page.close();
  page = await context.newPage();
  await page.goto(`${base}#/heute`);
  await page.waitForSelector('[data-testid=status]');
  assert.equal(await text('net'), '8:15');
  assert.equal((await intervals()).length, 2);
});

test('Hilfe & Installation ist über den Kopfbereich erreichbar und mobil lesbar', async () => {
  await page.setViewportSize({ width: 360, height: 740 });
  await click('help-link');
  await page.waitForSelector('h1:has-text("Hilfe & Installation")');
  assert.ok(await page.isVisible(`a.help-url:has-text("${base}")`));
  assert.ok(await page.isVisible('[data-testid=install-state]'));
  for (const s of ['App öffnen', 'App installieren', 'App starten', 'Ersteinrichtung', 'Ohne Internet nutzen', 'Daten sichern', 'Wenn etwas nicht klappt']) {
    assert.ok(await page.isVisible(`.help-step h3:has-text("${s}")`), s);
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  // Auch aus den Einstellungen erreichbar
  await openSettings();
  await page.click('a:has-text("Hilfe & Installationsanleitung")');
  await page.waitForSelector('h1:has-text("Hilfe & Installation")');
});

test('Kopfzeile zeigt die aktuelle Ansicht; Ansichtswechsel schließt offene Dialoge ohne Speichern', async () => {
  for (const [hash, title] of [['heute', 'Heute'], ['kalender', 'Kalender'], [`tag/${DAY}`, 'Tagesansicht'], ['taetigkeiten', 'Tätigkeiten'], ['konto', 'Zeitkonto'], ['einstellungen', 'Einstellungen']]) {
    await page.goto(`${base}#/${hash}`);
    await page.waitForFunction((t) => document.getElementById('topbar-title')?.textContent === t, title);
  }
  await page.goto(`${base}#/taetigkeiten/${DAY}`);
  await click('add-activity');
  await page.fill('dialog input[name=title]', 'nicht speichern');
  await page.goBack(); // z. B. Zurück-Taste am Handy
  await page.waitForSelector('dialog', { state: 'detached' });
  const acts = await page.evaluate(async () => (await window.__app.repo.loadAll()).activities.length);
  assert.equal(acts, 0);
});

test('Kein horizontaler Überlauf auf kleinen Handys (360 px)', async () => {
  await page.setViewportSize({ width: 360, height: 740 });
  await workday();
  await page.evaluate(async () => {
    await window.__app.repo.saveActivity({ day: '2026-03-02', title: 'Sehr lange Tätigkeitsbezeichnung ohne Umbruchmöglichkeit', description: 'x', minutes: 60, intensity: 'mittel', category: 'Kategorie' });
  });
  const routes = ['heute', 'kalender', 'kalender/woche/2026-03-02', 'kalender/monat/2026-03', `tag/${DAY}`, `taetigkeiten/${DAY}`, 'konto/2026-03', 'einstellungen', 'hilfe'];
  for (const r of routes) {
    await page.goto(`${base}#/${r}`);
    await page.waitForTimeout(250);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `${r}: ${overflow}px horizontaler Überlauf`);
  }
  // Navigationsbeschriftungen nicht abgeschnitten
  const cut = await page.evaluate(() => [...document.querySelectorAll('.bottom-nav a span:last-child')]
    .filter((s) => s.scrollWidth > s.clientWidth).map((s) => s.textContent));
  assert.deepEqual(cut, []);
  // Hauptknöpfe vollständig sichtbar
  await page.goto(`${base}#/heute`);
  await page.waitForSelector('[data-testid=btn-start]');
  const box = await page.locator('[data-testid=btn-start]').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 360);
});

// ---------- Verrechnungskonto gegen den Arbeitszeitplan & Ausbildungsnachweis ----------

test('Zeitkonto: 08:50 → 08:45 (−0:05), andere Viertelstunde wählbar (09:00 = +0:10), Gehen 17:49 → 17:45 (+0:04)', async () => {
  await setTime(t(DAY, '08:50'));
  await click('btn-start');
  await waitStatus('Arbeit läuft');
  assert.match(await page.textContent('[data-testid=stamp-start-work]'), /Kommen 08:50 → 08:45 \(−0:05\)/);
  assert.equal(await balance(), '−0:05');
  assert.equal(await page.textContent('[data-testid=booked-range]'), '08:45 – läuft');
  await setTime(t(DAY, '16:10'));
  await rerender();
  // Andere Viertelstunde wählen: 09:00 statt 08:45 → +0:10
  await page.click('[data-testid=stamp-start-work]');
  await page.waitForSelector('[data-testid=booking-choices]');
  const labels = await page.$$eval('[data-testid=booking-choices] button', (bs) => bs.map((b) => b.dataset.booked));
  assert.ok(labels.includes('08:30') && labels.includes('08:45') && labels.includes('09:00') && labels.includes('09:15'), labels.join(','));
  assert.match(await page.textContent('[data-testid=booking-choices] button[data-booked="09:00"]'), /\+0:10.*Konto \+0:10/);
  await page.click('[data-testid=booking-choices] button[data-booked="09:00"]');
  await waitBalance('+0:10');
  const rec = (await intervals())[0];
  assert.equal(rec.startBooked, t(DAY, '09:00').getTime());
  assert.equal(rec.start, t(DAY, '08:50').getTime()); // gestempelte Zeit bleibt unverändert
  assert.equal(await page.textContent('[data-testid=booked-range]'), '09:00 – läuft');
  // Zurück auf die nächstgelegene (Standard) → keine Wahl gespeichert
  await page.click('[data-testid=stamp-start-work]');
  await page.click('[data-testid=booking-choices] button[data-booked="08:45"]');
  await waitBalance('−0:05');
  assert.equal((await intervals())[0].startBooked, null);
  // Gehen 17:49 → 17:45: +0:04 → Konto −0:01
  await setTime(t(DAY, '17:49'));
  await click('btn-end');
  await waitStatus('Nicht eingestempelt');
  assert.equal(await balance(), '−0:01');
  assert.equal(await page.textContent('[data-testid=booked-range]'), '08:45 – 17:45');
  // 8 Stunden sind kein Muss: kurzer Tag, kein Minus
  await page.goto(`${base}#/tag/${DAY}`);
  await page.waitForSelector('[data-testid=deviation]');
  const rows = await page.$$eval('[data-testid=deviation] tr', (trs) => trs.map((tr) => tr.textContent));
  assert.ok(rows.some((r) => r.includes('Kommen 08:50 → 08:45') && r.includes('−0:05')), rows.join(' | '));
  assert.ok(rows.some((r) => r.includes('Gehen 17:49 → 17:45') && r.includes('+0:04')), rows.join(' | '));
});

test('Feierabend früher, aber spätere Viertelstunde buchen (Konto nutzen); Erfassungsart minutengenau', async () => {
  // Startsaldo +0:30 aus früheren Tagen
  await page.evaluate(async () => {
    const s = (await window.__app.repo.loadAll()).settings;
    await window.__app.repo.saveSettings({ ...s, startBalanceMin: 30 });
  });
  await setTime(t(DAY, '08:45'));
  await click('btn-start');
  await waitStatus('Arbeit läuft');
  await setTime(t(DAY, '17:20'));
  await click('btn-end');
  await waitStatus('Nicht eingestempelt');
  assert.equal(await balance(), '+0:35'); // Gehen 17:20 → 17:15 = +0:05
  // Bis 17:45 buchen: −0:25 statt +0:05 → Konto +0:30 − 0:25 = +0:05
  await page.click('[data-testid=stamp-end-work]');
  assert.match(await page.textContent('[data-testid=booking-choices] button[data-booked="17:45"]'), /−0:25.*Konto \+0:05/);
  await page.click('[data-testid=booking-choices] button[data-booked="17:45"]');
  await waitBalance('+0:05');
  assert.equal(await page.textContent('[data-testid=booked-range]'), '08:45 – 17:45');
  assert.equal(await text('net'), '9:00'); // gebucht 08:45–17:45, keine Pause gestempelt
  // Erfassungsart minutengenau: gebucht = gestempelt, kein Differenzkonto
  await openSettings();
  await page.selectOption('[data-testid=tracking-mode]', 'exact');
  await page.click('form:has([data-testid=tracking-mode]) button[type=submit]');
  await page.click('dialog button[type=submit]');
  await page.waitForSelector('dialog', { state: 'detached' });
  await page.goto(`${base}#/heute`);
  await page.waitForSelector('[data-testid=booked-range]');
  assert.equal(await balance(), '+0:30');
  assert.equal(await page.textContent('[data-testid=booked-range]'), '08:45 – 17:20');
  assert.equal(await page.$('[data-testid=stamp-end-work]'), null);
  // Die gewählte Buchung bleibt gespeichert und gilt wieder nach dem Zurückschalten
  assert.equal((await intervals())[0].endBooked, t(DAY, '17:45').getTime());
  await openSettings();
  await page.selectOption('[data-testid=tracking-mode]', 'quarter');
  await page.click('form:has([data-testid=tracking-mode]) button[type=submit]');
  await page.click('dialog button[type=submit]');
  await page.waitForSelector('dialog', { state: 'detached' });
  await page.goto(`${base}#/heute`);
  await waitBalance('+0:05');
  await page.waitForSelector('[data-testid=stamp-end-work]');
});

test('Zeitkonto läuft über Wochen und Monate weiter: Übertrag sichtbar in Zeitkonto und Kalender', async () => {
  await page.evaluate(async () => {
    const { newInterval } = await import('./js/core/model.js');
    const { localTimestamp } = await import('./js/core/time.js');
    const r = window.__app.repo;
    const s = (await r.loadAll()).settings;
    await r.saveSettings({ ...s, accountStart: '2026-02-01', startBalanceMin: 30 });
    // Fr 27.02.: Kommen 08:50 → 08:45 = −0:05
    await r.saveIntervals([newInterval({ kind: 'work', day: '2026-02-27', start: localTimestamp('2026-02-27', '08:50'), end: localTimestamp('2026-02-27', '17:00'), source: 'clock' })]);
  });
  await workday(); // Mo 02.03.: Gehen 16:40 → 16:45 = −0:05
  const rowText = (id) => page.$eval(`[data-testid=${id}]`, (el) => el.innerText.replace(/\s+/g, ' ').trim());
  // Zeitkonto Februar: Übertrag aus Januar (= Anfangssaldo), Stand Ende Februar
  await page.goto(`${base}#/konto/2026-02`);
  await page.waitForSelector('[data-testid=ledger-carry]');
  assert.equal(await rowText('ledger-carry'), 'Übertrag aus Januar +0:30');
  assert.equal(await rowText('ledger-end'), 'Stand Ende Februar +0:25');
  // März beginnt mit dem Stand von Ende Februar
  await page.goto(`${base}#/konto/2026-03`);
  await page.waitForFunction(() => document.querySelector('[data-testid=ledger-carry]')?.textContent.includes('Februar'));
  assert.equal(await rowText('ledger-carry'), 'Übertrag aus Februar +0:25');
  assert.equal(await rowText('ledger-end'), 'Stand heute +0:20');
  assert.equal(await text('account-balance'), '+0:20');
  // Kalender: Woche 23.02.–01.03. (über den Monatswechsel) und die Folgewoche
  await page.goto(`${base}#/kalender/woche/2026-02-23`);
  await page.waitForSelector('[data-testid=carry-in]');
  assert.equal(await rowText('carry-in'), 'Übertrag aus der Vorwoche +0:30');
  assert.equal(await rowText('period-end'), 'Zeitkonto am Ende +0:25');
  await page.goto(`${base}#/kalender/woche/2026-03-02`);
  await page.waitForFunction(() => document.querySelector('[data-testid=carry-in]')?.textContent.includes('+0:25'));
  assert.equal(await rowText('period-end'), 'Zeitkonto am Ende +0:20');
  // Monatsansicht März
  await page.goto(`${base}#/kalender/monat/2026-03`);
  await page.waitForFunction(() => document.querySelector('[data-testid=carry-in]')?.textContent.includes('Vormonat'));
  assert.equal(await rowText('carry-in'), 'Übertrag aus dem Vormonat +0:25');
  assert.equal(await rowText('period-end'), 'Zeitkonto am Ende +0:20');
});

test('Kurzer Tag erzeugt keine Minusstunden', async () => {
  await setTime(t(DAY, '08:45'));
  await click('btn-start');
  await waitStatus('Arbeit läuft');
  await setTime(t(DAY, '11:00'));
  await click('btn-end');
  await waitStatus('Nicht eingestempelt');
  assert.equal(await balance(), '0:00');
  assert.equal(await text('net'), '2:15');
});

test('Wochentabelle: Druckansicht wie der Nachweis, druckbar als PDF auf einer A4-Seite', async () => {
  await workday();
  await page.evaluate(async () => {
    await window.__app.repo.saveActivity({ day: '2026-03-02', title: 'Löten', minutes: 240, intensity: null, category: 'Werkstatt' });
    await window.__app.repo.saveActivity({ day: '2026-03-02', title: 'Messen', minutes: 255, intensity: null, category: null });
  });
  await page.goto(`${base}#/kalender/woche/${DAY}`);
  await click('week-print');
  await page.waitForSelector('[data-testid=print-sheet]');
  const rows = await page.$$eval('[data-testid=print-sheet] tbody tr', (trs) => trs.map((tr) => [...tr.children].map((c) => c.innerText.trim())));
  // Montag: Tag | Tagesarbeitszeit (senkrecht) | Tätigkeit | … | Abteilung
  assert.deepEqual(rows[0], ['Montag', '08:00–16:45\nPause 0:30', 'Löten', '4,00', '', '', '', 'Werkstatt']);
  assert.deepEqual(rows[1], ['Messen', '4,25', '', '', '', '']);
  const timesWidth = await page.$eval('[data-testid=print-times]', (td) => td.getBoundingClientRect().width);
  const dayWidth = await page.$eval('.ps-day', (th) => th.getBoundingClientRect().width);
  assert.ok(Math.abs(timesWidth - dayWidth) <= 1, `gleich breit: ${timesWidth} / ${dayWidth}`);
  // unterste Zeile des Tages: Stunden gesamt, Pause, netto
  assert.deepEqual(rows[4].slice(2, 5), ['8,75', '0,50', '8,25']); // gebucht 08:00–16:45, Pause 0:30
  assert.equal(await text('print-week-total'), '8,25');
  // Druck: Kopfzeile, Navigation und Knöpfe werden ausgeblendet, nur das Blatt bleibt
  await page.emulateMedia({ media: 'print' });
  for (const sel of ['.topbar', '.bottom-nav', '[data-testid=print-now]']) {
    assert.equal(await page.isVisible(sel), false, sel);
  }
  assert.ok(await page.isVisible('[data-testid=print-sheet]'));
  const pdf = await page.pdf({ format: 'A4', preferCSSPageSize: true });
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  assert.equal(pages, 1, `PDF-Seiten: ${pages}`);
  await page.emulateMedia({ media: 'screen' });
});

async function readXlsx(download) {
  const dir = await mkdtemp(join(tmpdir(), 'az-'));
  const file = join(dir, download.suggestedFilename());
  await download.saveAs(file);
  return { name: download.suggestedFilename(), bytes: await readFile(file) };
}

test('Ausbildungsnachweis als Excel aus der Wochenansicht und den Einstellungen', async () => {
  await workday();
  await page.evaluate(async () => {
    await window.__app.repo.saveActivity({ day: '2026-03-02', title: 'Löten', minutes: 240, intensity: null, category: 'Werkstatt' });
  });
  await page.goto(`${base}#/kalender/woche/${DAY}`);
  // Wochentabelle: jede Zeile ist eine normale Tabellenzeile (nicht gestapelt)
  await page.waitForSelector('[data-testid=week-row]');
  const rowDisplay = await page.$eval('[data-testid=week-row]', (tr) => window.getComputedStyle(tr).display);
  assert.equal(rowDisplay, 'table-row');
  const [dl] = await Promise.all([page.waitForEvent('download'), click('week-report')]);
  const { name, bytes } = await readXlsx(dl);
  assert.equal(name, 'Ausbildungsnachweis_KW10-2026.xlsx');
  assert.equal(bytes.subarray(0, 2).toString(), 'PK');
  const text = bytes.toString('utf8');
  assert.match(text, /<sheet name="KW10"/);
  // Tagesarbeitszeit senkrecht neben dem Wochentag; letzte Spalte nur Ausbildungsabteilung
  assert.match(text, /<c r="B8" s="14" t="inlineStr"><is><t xml:space="preserve">08:00–16:45\nPause 0:30<\/t>/);
  assert.match(text, />Werkstatt<\/t>/);
  assert.match(text, />Ausbildungsabteilung<\/t>/);
  assert.match(text, /Stunden gesamt/);
  assert.match(text, /Stunden netto/);
  assert.match(text, /Wochenarbeitszeit \(Summe Stunden netto\)/);
  assert.match(text, /Löten/);
  assert.match(text, /Werkstatt/);

  await openSettings();
  await page.fill('[data-testid=report-from]', '2026-02-23');
  await page.fill('[data-testid=report-to]', '2026-03-08');
  const [dl2] = await Promise.all([page.waitForEvent('download'), click('export-report')]);
  const r2 = await readXlsx(dl2);
  assert.equal(r2.name, 'Ausbildungsnachweis_KW09-bis-KW10-2026.xlsx');
  assert.match(r2.bytes.toString('utf8'), /<sheet name="KW09"[^>]*\/><sheet name="KW10"/);
});

test('Sicherung teilen: als .txt (Chrome lehnt JSON ab), Ausweichen auf Download, .txt wieder importierbar', async () => {
  // Teilen-Menü wie Chrome auf Android: nur bestimmte Dateitypen, JSON → „Permission denied“
  await page.addInitScript(() => {
    navigator.canShare = () => true;
    navigator.share = async ({ files }) => {
      const f = files[0];
      if (!/\.(txt|csv|pdf)$/.test(f.name) || window.__rejectShare) throw new DOMException('Permission denied', 'NotAllowedError');
      window.__shared = { name: f.name, type: f.type, text: await f.text() };
    };
  });
  await page.reload();
  await workday();
  await openSettings();
  await page.click('button:has-text("Sicherung teilen")');
  await page.waitForFunction(() => !!window.__shared);
  const shared = await page.evaluate(() => window.__shared);
  assert.equal(shared.name, 'Arbeitszeit-Sicherung_02.03.2026_16-40.txt');
  assert.equal(shared.type, 'text/plain');
  // Lesbarer Text mit Datum und Zeiten, kein Code am Anfang
  assert.match(shared.text, /^ARBEITSZEIT – Sicherung vom Mo, 02\.03\.2026 16:40/);
  assert.match(shared.text, /Mo, 02\.03\.2026\r\n  Arbeit: 08:00–16:45 \(gestempelt 08:00–16:40\)/);
  assert.match(shared.text, /Pause:  12:00–12:30/);
  assert.match(shared.text, /Arbeitszeit 8:15 · Pausen 0:30 · Differenz −0:05 · Zeitkonto −0:05/);
  assert.match(shared.text, /DATEN FÜR DEN IMPORT/);
  await page.waitForFunction(() => /aktuell/.test(document.querySelector('[data-testid=backup-state]')?.textContent || ''));

  // Lehnt der Browser trotzdem ab, wird stattdessen heruntergeladen
  await page.evaluate(() => { window.__rejectShare = true; });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Sicherung teilen")')]);
  assert.match(dl.suggestedFilename(), /\.json$/);
  await page.waitForSelector('text=Teilen wurde vom Browser abgelehnt'); // Hinweis folgt nach dem Download

  // Geteilte .txt-Datei lässt sich wieder importieren
  const dir = await mkdtemp(join(tmpdir(), 'az-'));
  const file = join(dir, shared.name);
  await writeFile(file, shared.text);
  await page.evaluate(() => window.__app.repo.wipe());
  await openSettings();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), click('import')]);
  await chooser.setFiles(file);
  await page.waitForSelector('dialog');
  await page.uncheck('dialog input[name=backupFirst]');
  await page.click('dialog button[type=submit]');
  await page.waitForSelector('dialog', { state: 'detached' });
  assert.equal((await intervals()).length, 2);
});
