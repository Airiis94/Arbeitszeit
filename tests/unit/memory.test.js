import './helpers.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { activityTemplates, filterTemplates, templateMinutes, hideTemplate, memoryKey } from '../../app/js/core/memory.js';
import { normalizeSettings } from '../../app/js/core/model.js';
import { buildBackup, parseBackup } from '../../app/js/core/backup-format.js';
import { settings } from './helpers.js';

let clock = 1000;
const act = (day, title, minutes, extra = {}) => {
  clock += 1000;
  return { id: `a${clock}`, day, title, description: '', minutes, intensity: null, category: null, createdAt: clock, updatedAt: clock, ...extra };
};

describe('Zwischenspeicher der Tätigkeiten', () => {
  const acts = [
    act('2026-03-02', 'Löten', 240, { category: 'Werkstatt' }),
    act('2026-03-02', 'Berufsschule vorbereiten', 60),
    act('2026-03-03', 'löten ', 180, { category: 'werkstatt', intensity: 'hoch' }), // gleiche Vorlage
    act('2026-03-03', 'Messen', 90, { category: 'Werkstatt', description: 'Oszilloskop' }),
    act('2026-03-03', 'Messen', 30, { category: 'Werkstatt' }), // andere Beschreibung = eigene Vorlage
    act('2026-03-04', 'Alt', 30, { deleted: true }),
  ];

  test('gleiche Tätigkeiten werden zusammengefasst, zuletzt verwendete zuerst, mit zuletzt verwendeten Werten', () => {
    const list = activityTemplates(acts);
    assert.deepEqual(list.map((t) => [t.title, t.minutes, t.count]), [
      ['löten', 180, 2], ['Messen', 30, 1], ['Messen', 90, 1], ['Berufsschule vorbereiten', 60, 1]]);
    assert.equal(list[0].intensity, 'hoch');
    assert.equal(list[0].category, 'werkstatt');
    assert.equal(list[2].description, 'Oszilloskop');
    assert.ok(!list.some((t) => t.title === 'Alt'), 'gelöschte Tätigkeiten erscheinen nicht');
  });

  test('ein früherer Tag, später nachgetragen, verdrängt nicht die zuletzt verwendeten Werte', () => {
    const list = activityTemplates([...acts, act('2026-02-20', 'Löten', 45, { category: 'Werkstatt' })]);
    const t = list.find((x) => x.key === memoryKey({ title: 'Löten', category: 'Werkstatt' }));
    assert.equal(t.minutes, 180);
    assert.equal(t.count, 3);
  });

  test('Suche in Bezeichnung, Beschreibung und Kategorie', () => {
    const list = activityTemplates(acts);
    assert.deepEqual(filterTemplates(list, 'mess').map((t) => t.minutes), [30, 90]);
    assert.deepEqual(filterTemplates(list, 'oszi').map((t) => t.title), ['Messen']);
    assert.equal(filterTemplates(list, 'WERKSTATT').length, 3);
    assert.equal(filterTemplates(list, '').length, 4);
    assert.equal(filterTemplates(list, '', 2).length, 2);
  });

  test('Dauer: zuletzt verwendet, höchstens der offene Rest', () => {
    const t = { minutes: 240 };
    assert.equal(templateMinutes(t, 0), 240);
    assert.equal(templateMinutes(t, 300), 240);
    assert.equal(templateMinutes(t, 90), 90);
  });

  test('Entfernen blendet die Vorlage aus, bis sie erneut erfasst wird', () => {
    const list = activityTemplates(acts);
    const hidden = hideTemplate([], list[0].key, clock + 1);
    assert.ok(!activityTemplates(acts, hidden).some((t) => t.key === list[0].key));
    assert.deepEqual(hideTemplate(hidden, list[0].key, clock + 2), [{ key: list[0].key, at: clock + 2 }]);
    clock += 5000;
    const again = [...acts, act('2026-03-05', 'Löten', 60, { category: 'Werkstatt' })];
    assert.ok(activityTemplates(again, hidden).some((t) => t.key === list[0].key));
  });

  test('Einstellungen älterer Versionen: leerer Zwischenspeicher-Vermerk; Sicherung prüft das Feld', async () => {
    assert.deepEqual(normalizeSettings({ accountStart: '2026-03-02' }).activityMemoryHidden, []);
    assert.deepEqual(normalizeSettings({ accountStart: '2026-03-02', activityMemoryHidden: 'x' }).activityMemoryHidden, []);
    const data = { settings: settings('2026-03-02'), intervals: [], dayInfos: [], activities: [], corrections: [], audit: [] };
    data.settings.activityMemoryHidden = [{ key: 'a', at: 5 }];
    const ok = await parseBackup(JSON.stringify(await buildBackup(data)));
    assert.equal(ok.ok, true, ok.errors.join('\n'));
    assert.deepEqual(ok.backup.data.settings.activityMemoryHidden, [{ key: 'a', at: 5 }]);
    data.settings.activityMemoryHidden = [{ key: 1 }];
    const bad = await parseBackup(JSON.stringify(await buildBackup(data)));
    assert.match(bad.errors.join('\n'), /Zwischenspeicher/);
  });
});
