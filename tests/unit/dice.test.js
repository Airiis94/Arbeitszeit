import './helpers.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { activityStats, rollDay, rerollDay, diceCandidates } from '../../app/js/core/dice.js';
import { memoryKey } from '../../app/js/core/memory.js';
import { addDays } from '../../app/js/core/time.js';

/** Reproduzierbarer Zufall (Mulberry32). */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let n = 0;
const act = (day, title, minutes, extra = {}) => ({ id: `a${++n}`, day, title, minutes, description: '', category: null, intensity: null, createdAt: n, updatedAt: n, ...extra });

// 4 Wochen Montag–Freitag: „Versenden“ jeden Tag, „Patch löten“ an jedem zweiten Tag, „Inventur“ einmal
const START = '2026-09-28';
const history = [];
for (let w = 0; w < 4; w += 1) {
  for (let d = 0; d < 5; d += 1) {
    const day = addDays(START, w * 7 + d);
    const i = w * 5 + d;
    history.push(act(day, 'Versenden', i % 2 ? 120 : 180, { category: 'Versand' }));
    if (i % 2 === 0) history.push(act(day, 'Patch löten', 240, { category: 'Werkstatt' }));
    else history.push(act(day, 'Kommissionieren', 360, { category: 'Lager' }));
    if (i === 7) history.push(act(day, 'Inventur', 60));
  }
}
history.push(act('2026-09-30', 'gelöscht', 90, { deleted: true }));
const DAY = '2026-10-26';

describe('Tätigkeiten würfeln', () => {
  test('Statistik: Häufigkeit (Anteil der Tage) und typische Dauer aus den letzten Wochen', () => {
    const s = activityStats(history, DAY, { weeks: 8 });
    assert.equal(s.days, 20);
    const by = Object.fromEntries(s.templates.map((t) => [t.title, t]));
    assert.equal(by.Versenden.share, 1);
    assert.equal(by['Patch löten'].share, 0.5);
    assert.equal(by.Inventur.daysWith, 1);
    assert.equal(by.Versenden.typical, 150);
    assert.equal(by['Patch löten'].category, 'Werkstatt');
    assert.ok(!by.gelöscht, 'gelöschte Einträge zählen nicht');
    assert.equal(s.itemsPerDay, 2);
    // Zeitraum: ältere Einträge fallen heraus, der Tag selbst zählt nicht mit
    assert.equal(activityStats(history, DAY, { weeks: 1 }).days, 5); // nur die letzte Woche
    assert.equal(activityStats(history, '2026-10-19', { weeks: 1 }).days, 5); // 12.–16.10., nicht der 19. selbst
  });

  test('gewürfelter Tag füllt genau die offene Zeit – bei jedem Wurf', () => {
    const s = activityStats(history, DAY);
    for (let seed = 1; seed <= 300; seed += 1) {
      for (const open of [480, 465, 390, 487, 60, 15, 10, 1]) {
        const r = rollDay(s, open, { rng: seeded(seed) });
        assert.equal(r.reduce((x, a) => x + a.minutes, 0), open, `seed ${seed}, ${open} min`);
        assert.ok(r.every((a) => a.minutes > 0));
        assert.equal(new Set(r.map((a) => a.key)).size, r.length, 'keine Tätigkeit doppelt');
      }
    }
  });

  test('häufige Tätigkeiten kommen häufiger vor, seltene selten; Dauern im Viertelstundenraster', () => {
    const s = activityStats(history, DAY);
    const hits = {};
    let quarter = 0;
    let total = 0;
    for (let seed = 1; seed <= 1000; seed += 1) {
      for (const a of rollDay(s, 480, { rng: seeded(seed) })) {
        hits[a.title] = (hits[a.title] || 0) + 1;
        total += 1;
        if (a.minutes % 15 === 0) quarter += 1;
      }
    }
    assert.ok(hits.Versenden > hits['Patch löten'], JSON.stringify(hits));
    assert.ok(hits['Patch löten'] > (hits.Inventur || 0) * 3, JSON.stringify(hits));
    assert.equal(quarter, total);
    // unterschiedlich strukturierte Tage
    const shapes = new Set();
    for (let seed = 1; seed <= 50; seed += 1) shapes.add(rollDay(s, 480, { rng: seeded(seed) }).map((a) => `${a.title}:${a.minutes}`).join('|'));
    assert.ok(shapes.size > 5, `nur ${shapes.size} verschiedene Tage`);
  });

  test('schon erfasste Tätigkeiten werden ausgeschlossen; nur der Rest wird gewürfelt', () => {
    const s = activityStats(history, DAY);
    const exclude = [memoryKey({ title: 'Versenden', category: 'Versand' })];
    for (let seed = 1; seed <= 100; seed += 1) {
      const r = rollDay(s, 270, { exclude, rng: seeded(seed) });
      assert.ok(!r.some((a) => a.title === 'Versenden'));
      assert.equal(r.reduce((x, a) => x + a.minutes, 0), 270);
    }
  });

  test('nur selbst eingetragene Tätigkeiten zählen – gewürfelte nicht', () => {
    const rolled = [act('2026-10-21', 'Gewürfelt', 480, { source: 'dice' }), act('2026-10-22', 'Versenden', 480, { category: 'Versand', source: 'dice' })];
    const s = activityStats([...history, ...rolled], DAY, { weeks: 8 });
    assert.ok(!s.templates.some((t) => t.title === 'Gewürfelt'));
    assert.equal(s.days, 20); // gewürfelte Tage zählen nicht als Tage
    assert.equal(s.templates.find((t) => t.title === 'Versenden').typical, 150); // 480 aus dem Wurf zählt nicht
  });

  test('Auswahl in den Einstellungen und Zeitraum (gesamt oder letzte Wochen)', () => {
    const versenden = memoryKey({ title: 'Versenden', category: 'Versand' });
    const s = activityStats(history, DAY, { excluded: [versenden] });
    assert.ok(!s.templates.some((t) => t.title === 'Versenden'));
    for (let seed = 1; seed <= 50; seed += 1) assert.ok(!rollDay(s, 480, { rng: seeded(seed) }).some((a) => a.title === 'Versenden'));
    // gesamter Zeitraum (Standard): auch Tage nach dem gewählten Tag zählen, der Tag selbst nicht
    assert.equal(activityStats(history, '2026-10-05').days, 19);
    assert.equal(activityStats(history, '2026-10-05', { weeks: 1 }).days, 5);
    const cand = diceCandidates([...history, act('2026-10-23', 'X', 30, { source: 'dice' })], [versenden]);
    assert.deepEqual(cand.map((c) => [c.title, c.included]), [['Versenden', false], ['Kommissionieren', true], ['Patch löten', true], ['Inventur', true]]);
  });

  test('gelockte Tätigkeiten bleiben beim Neu-Würfeln, der Rest füllt die offene Zeit', () => {
    const s = activityStats(history, DAY);
    for (let seed = 1; seed <= 200; seed += 1) {
      const first = rollDay(s, 480, { rng: seeded(seed) });
      const locked = first.slice(0, 1);
      const next = rerollDay(s, 480, locked, { rng: seeded(seed + 1000) });
      assert.deepEqual(next[0].key, locked[0].key);
      assert.equal(next[0].minutes, locked[0].minutes);
      assert.equal(next[0].locked, true);
      assert.equal(next.reduce((x, a) => x + a.minutes, 0), 480, `seed ${seed}`);
      assert.equal(new Set(next.map((a) => a.key)).size, next.length);
    }
    // alles gelockt: nichts mehr zu würfeln
    const all = rollDay(s, 480, { rng: seeded(7) });
    assert.deepEqual(rerollDay(s, 480, all).map((a) => [a.key, a.minutes]), all.map((a) => [a.key, a.minutes]));
  });

  test('ohne Statistik oder ohne offene Zeit: kein Vorschlag', () => {
    assert.deepEqual(rollDay(activityStats([], DAY), 480), []);
    assert.deepEqual(rollDay(activityStats(history, DAY), 0), []);
  });
});
