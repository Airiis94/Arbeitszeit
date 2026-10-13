import { work, pause, at } from './helpers.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateIntervalChange } from '../../app/js/core/validate.js';
import { touch, newInterval } from '../../app/js/core/model.js';

const DAY = '2026-03-02';
const NOW = at('2026-03-10', '12:00');

describe('Validierung manueller Änderungen', () => {
  test('gültige nachträgliche Arbeitsphase', () => {
    const errors = validateIntervalChange([], [work(DAY, '08:00', '16:00')], NOW);
    assert.deepEqual(errors, []);
  });

  test('Überschneidung mit vorhandener Phase am selben Tag wird abgelehnt', () => {
    const existing = [work(DAY, '08:00', '12:00')];
    const errors = validateIntervalChange(existing, [work(DAY, '11:00', '14:00')], NOW);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /überschneiden/);
  });

  test('Überschneidung mit Nachtschicht vom Vortag wird abgelehnt', () => {
    const existing = [work(DAY, '22:00', '06:00')];
    const errors = validateIntervalChange(existing, [work('2026-03-03', '05:00', '13:00')], NOW);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Überschneidung/);
  });

  test('Pause außerhalb der Arbeitsphase wird abgelehnt', () => {
    const existing = [work(DAY, '08:00', '12:00')];
    const errors = validateIntervalChange(existing, [pause(DAY, '13:00', '13:30')], NOW);
    assert.match(errors[0], /außerhalb/);
  });

  test('Verkürzen einer Phase, sodass eine Pause herausfällt, wird abgelehnt', () => {
    const w = work(DAY, '08:00', '16:00');
    const existing = [w, pause(DAY, '15:00', '15:30')];
    const errors = validateIntervalChange(existing, [touch(w, { end: at(DAY, '14:00') })], NOW);
    assert.match(errors[0], /außerhalb/);
  });

  test('Ende vor Beginn wird abgelehnt', () => {
    const rec = newInterval({ kind: 'work', day: DAY, start: at(DAY, '10:00'), end: at(DAY, '09:00') });
    assert.match(validateIntervalChange([], [rec], NOW)[0], /vor dem Beginn/);
  });

  test('zweite offene Arbeitsphase wird abgelehnt', () => {
    const existing = [work('2026-03-10', '08:00', null)];
    const errors = validateIntervalChange(existing, [work(DAY, '08:00', null)], NOW);
    assert.ok(errors.length >= 1);
  });

  test('vorhandene Konflikte dürfen schrittweise behoben werden', () => {
    const a = work(DAY, '08:00', '12:00');
    const b = work(DAY, '11:00', '16:00');
    // Ein Konflikt existiert bereits (z. B. nach Zusammenführung). Die Korrektur muss möglich sein.
    const errors = validateIntervalChange([a, b], [touch(b, { start: at(DAY, '12:00') })], NOW);
    assert.deepEqual(errors, []);
    // Löschen einer der beiden ebenfalls
    assert.deepEqual(validateIntervalChange([a, b], [touch(b, { deleted: true })], NOW), []);
  });

  test('Pause nur mit Dauer muss positiv sein', () => {
    const rec = newInterval({ kind: 'break', day: DAY, durationMin: 0 });
    assert.ok(validateIntervalChange([], [rec], NOW).length > 0);
  });
});
