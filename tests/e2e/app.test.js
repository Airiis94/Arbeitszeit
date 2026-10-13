// End-to-End-Tests im echten Chromium (Playwright) mit echter IndexedDB und Service Worker.
// Voraussetzung: `npm install playwright` (bzw. vorhandene Playwright-Installation) und Chromium.
// Aufruf: npm run test:e2e

import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from '../../scripts/serve.js';

let server;
let base;
let browser;
let context;
let page;

// Montag, 02.03.2026, Europe/Berlin (MEZ = UTC+1)
const t = (day, hhmm) => new Date(`${day}T${hhmm}:00+01:00`);
const DAY = '2026-03-02';

before(async () => {
  server = createServer().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}/`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});

after(async () => {
  await browser?.close();
  server?.close();
});

beforeEach(async () => {
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'de-DE', timezoneId: 'Europe/Berlin', acceptDownloads: true });
  page = await context.newPage();
  page.on('pageerror', (e) => { throw e; });
  await page.clock.install({ time: t(DAY, '07:55') });
  await page.goto(base);
  await page.waitForSelector('[data-testid=status]');
});

afterEach(async () => {
  await context?.close();
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

test('Arbeitstag mit wenigen Klicks erfassen; Zeitkonto mit Viertelstunden-Rest', async () => {
  await workday();
  assert.equal(await text('net'), '8:10');
  assert.equal(await text('breaks'), '0:30');
  assert.equal(await text('diff'), '+0:10');
  // 8:10 netto → 8:00 angerechnet, 0:10 Rest → Saldo 0:00
  assert.equal(await text('balance'), '0:00');
  await page.goto(`${base}#/konto`);
  await page.waitForSelector('[data-testid=account-balance]');
  assert.equal(await text('account-balance'), '0:00');
  assert.match(await text('account-carry'), /0:10/);
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

test('Pause per Schnellwahl nachtragen und wieder löschen', async () => {
  await setTime(t(DAY, '08:00'));
  await click('btn-start');
  await waitStatus('Arbeit läuft');
  await setTime(t(DAY, '14:00'));
  await page.click('.quick .chip:has-text("30")');
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
  assert.ok(await page.isVisible('text=keiner Tätigkeit zugeordnet'));
});

test('Korrektur mit Begründung verändert den Saldo', async () => {
  await workday();
  await page.goto(`${base}#/konto`);
  await click('add-correction');
  await page.fill('dialog input[name=minutes]', '+1:30');
  await page.fill('dialog input[name=reason]', 'Dienstreise');
  await page.click('dialog button[type=submit]');
  await page.waitForFunction(() => document.querySelector('[data-testid=account-balance]')?.textContent === '+1:30');
});

test('Export → Löschen → Import stellt alle Daten wieder her', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'az-'));
  await workday();
  await page.goto(`${base}#/einstellungen`);
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

  await page.goto(`${base}#/einstellungen`);
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

test('Fehlerhafte Importdatei wird abgelehnt, Daten bleiben unverändert', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'az-'));
  await workday();
  const bad = join(dir, 'kaputt.json');
  await writeFile(bad, '{"format":"arbeitszeit-backup","schemaVersion":1,"data":{"intervals":[{"id":1}]');
  await page.goto(`${base}#/einstellungen`);
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
