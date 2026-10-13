import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = fileURLToPath(new URL('../../app/', import.meta.url));

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else out.push(p);
  }
  return out;
}

test('Service Worker hält alle App-Dateien offline vor', async () => {
  const sw = await readFile(join(APP, 'sw.js'), 'utf8');
  const list = [...sw.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean);
  const files = (await walk(APP)).map((f) => relative(APP, f).split('\\').join('/')).filter((f) => f !== 'sw.js');
  for (const f of files) assert.ok(list.includes(f), `fehlt im Precache: ${f}`);
  for (const f of list) assert.ok(files.includes(f), `Precache verweist auf fehlende Datei: ${f}`);
});

test('Manifest erfüllt die Installationskriterien', async () => {
  const m = JSON.parse(await readFile(join(APP, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.display, 'standalone');
  assert.ok(m.icons.some((i) => i.sizes === '192x192' && i.type === 'image/png'));
  assert.ok(m.icons.some((i) => i.sizes === '512x512' && i.type === 'image/png'));
  assert.ok(m.start_url && m.name && m.short_name);
});
