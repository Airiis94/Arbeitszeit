// Update-Test mit echten früheren Versionen: Daten mit einer älteren App-Version anlegen, wie am Handy auf
// die aktuelle Version aktualisieren und prüfen, dass die Datenbank Byte für Byte unverändert bleibt und
// alle Ansichten funktionieren. Frühere Versionen kommen aus der Git-Historie (ohne Historie: übersprungen).
// Aufruf: npm run test:e2e

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../../scripts/serve.js';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const NEW_APP = join(REPO, 'app/');
const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();

/** Frühere Stände des App-Ordners: der erste veröffentlichte und die drei letzten vor dem aktuellen. */
function previousVersions() {
  try {
    const head = git('rev-parse', 'HEAD:app');
    const commits = git('log', '--format=%H', '--', 'app').split('\n').filter(Boolean);
    const older = commits.filter((c) => git('rev-parse', `${c}:app`) !== head);
    const picks = [...older.slice(0, 3), older[older.length - 1]];
    return [...new Set(picks)];
  } catch {
    return [];
  }
}

async function extract(commit) {
  const dir = await mkdtemp(join(tmpdir(), `az-${commit.slice(0, 7)}-`));
  execFileSync('sh', ['-c', `git archive --format=tar ${commit} app | tar -x -C "${dir}"`], { cwd: REPO });
  return join(dir, 'app/');
}

const versions = previousVersions();
let browser;
before(async () => {
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); });

const dumpDb = (page) => page.evaluate(() => new Promise((resolve, reject) => {
  const open = indexedDB.open('arbeitszeit');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    const names = [...db.objectStoreNames];
    const tx = db.transaction(names, 'readonly');
    const out = { version: db.version, stores: {} };
    let left = names.length;
    for (const n of names) {
      const rq = tx.objectStore(n).getAll();
      rq.onsuccess = () => { out.stores[n] = rq.result; if (--left === 0) { db.close(); resolve(out); } };
    }
  };
}));

for (const commit of versions.length ? versions : [null]) {
  test(`Update von ${commit ? commit.slice(0, 7) : '(keine Git-Historie)'} auf die aktuelle Version erhält alle Daten`, { skip: !commit && 'keine frühere Version verfügbar' }, async () => {
    const oldApp = await extract(commit);
    let root = oldApp;
    const overrides = new Map();
    const stamp = async (dir, v) => (await readFile(join(dir, 'sw.js'), 'utf8')).replace(/^const VERSION = '.*';/m, `const VERSION = '${v}';`);
    overrides.set('sw.js', await stamp(oldApp, 'v-alt'));
    const server = createServer({ base: '/Arbeitszeit/', overrides, root: () => root }).listen(0);
    await new Promise((r) => server.once('listening', r));
    const base = `http://localhost:${server.address().port}/Arbeitszeit/`;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    try {
      const t = (d, hm) => new Date(`${d}T${hm}:00+02:00`);
      await page.clock.install({ time: t('2026-09-14', '07:00') });
      await page.goto(base);
      await page.waitForSelector('[data-testid=status]');
      await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 }).catch(() => page.reload());
      await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });

      // Daten mit der alten Version anlegen – über deren eigene Funktionen
      const clock = (a) => page.evaluate((x) => window.__app.repo.clock(x), a);
      for (const [d, a, p1, p2, b] of [['2026-09-14', '08:52', '12:01', '12:33', '17:20'], ['2026-09-15', '07:41', '12:05', '12:35', '16:14']]) {
        await page.clock.setSystemTime(t(d, a)); await clock('start');
        await page.clock.setSystemTime(t(d, p1)); await clock('pause');
        await page.clock.setSystemTime(t(d, p2)); await clock('resume');
        await page.clock.setSystemTime(t(d, b)); await clock('end');
      }
      await page.clock.setSystemTime(t('2026-09-16', '08:47')); await clock('start');
      await page.evaluate(async () => {
        const r = window.__app.repo;
        await r.saveActivity({ day: '2026-09-14', title: 'Schaltschrank verdrahten', minutes: 300, category: 'Werkstatt', intensity: 'hoch', description: 'Klemmen „X1“ & <Test>' });
        await r.saveActivity({ day: '2026-09-15', title: 'Löten', minutes: 1, category: null, intensity: null, description: '' });
        const tmp = await r.saveActivity({ day: '2026-09-15', title: 'wird gelöscht', minutes: 30, category: null, intensity: null, description: '' });
        const id = tmp?.record?.id || (await r.loadAll()).activities.find((a) => a.title === 'wird gelöscht').id;
        await r.deleteActivity(id);
        await r.saveCorrection({ day: '2026-09-15', minutes: -30, reason: 'Arzttermin' });
        if (r.saveDayInfo) await r.saveDayInfo('2026-09-17', { dayType: 'krank', note: 'Erkältung' });
        const s = (await r.loadAll()).settings;
        await r.saveSettings({ ...s, accountStart: '2026-09-01', startBalanceMin: 25, report: { name: 'Max Mustermann', trainingStart: '2026-09-01' } });
      });
      const before = await dumpDb(page);
      assert.equal(before.stores.intervals.length, 5, 'Testdaten: 2 Tage mit Pause + laufender Tag');
      assert.equal(before.stores.activities.length, 3, 'Testdaten: 3 Tätigkeiten (eine gelöscht)');

      // Update wie am Handy: neue Version veröffentlicht, „Aktualisieren“ (ältere Versionen: beim nächsten Öffnen)
      root = NEW_APP;
      overrides.set('sw.js', await stamp(NEW_APP, 'v-neu'));
      await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
      const banner = await page.waitForSelector('#update-banner button', { timeout: 10000 }).catch(() => null);
      if (banner) {
        await Promise.all([page.waitForEvent('load', { timeout: 20000 }), banner.click()]);
      } else {
        await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.waiting?.postMessage({ type: 'SKIP_WAITING' })));
        await page.waitForTimeout(1500);
        await page.reload();
      }
      await page.waitForSelector('#topbar-title', { timeout: 20000 }); // nur in der aktuellen Version
      assert.deepEqual(await page.evaluate(() => caches.keys()), ['arbeitszeit-v-neu']);

      // alle Ansichten öffnen – sie dürfen nur lesen
      for (const r of ['heute', 'kalender', 'kalender/woche/2026-09-14', 'tag/2026-09-14', 'taetigkeiten/2026-09-15', 'konto', 'einstellungen', 'druck/woche/2026-09-14', 'hilfe']) {
        await page.goto(`${base}#/${r}`);
        await page.waitForTimeout(250);
        assert.equal(await page.$('text=Fehler beim Anzeigen'), null, `Ansicht ${r}`);
      }
      const after = await dumpDb(page);
      // Sicherungskopien (kv „snapshot:…“) kommen hinzu; alle bisherigen Daten sind unverändert
      const snapshots = after.stores.kv.filter((x) => String(x.key).startsWith('snapshot:'));
      const afterWithoutSnapshots = { ...after, stores: { ...after.stores, kv: after.stores.kv.filter((x) => !String(x.key).startsWith('snapshot:')) } };
      assert.deepEqual(afterWithoutSnapshots, before);
      // Versionen mit Sicherungskopien legen sie beim Tipp auf „Aktualisieren“ an; beim ersten Start der
      // aktuellen Version entsteht in jedem Fall eine Kopie des (unveränderten) Datenstands
      const oldHasSnapshots = (await readFile(join(oldApp, 'js/db/repo.js'), 'utf8')).includes('saveSnapshot');
      if (oldHasSnapshots) assert.ok(snapshots.some((s) => s.value.reason === 'vor Update'), 'Kopie vor dem Update');
      await page.waitForFunction(() => window.__app.repo.listSnapshots().then((l) => l.length > 0), null, { timeout: 5000 });
      const snaps = await page.evaluate(() => window.__app.repo.listSnapshots());
      assert.ok(snaps.length >= 1, 'mindestens eine Sicherungskopie');
      // die Kopie enthält genau die Daten von vorher
      for (const s of snapshots) assert.deepEqual(s.value.data.activities, before.stores.activities);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
      server.close();
    }
  });
}
