import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'event-engine.js'), 'utf8');
const engine = vm.runInNewContext(`${source};({EVENT_CONFIG,getEventDefinition,createRoundEvent,selectRoundEvent,getEventRoundDuration,applyEventAnswer,finalizeRoundEvent,getEventProgress})`);

function answer(event, ok, remaining = 30, basePoints = ok ? 1 : 0) {
  return engine.applyEventAnswer(event, { ok, remaining, basePoints });
}

test('конфигурация содержит шесть совместимых одиночных событий', () => {
  assert.equal(engine.EVENT_CONFIG.probability, 0.25);
  assert.equal(engine.EVENT_CONFIG.events.length, 6);
  assert.equal(new Set(engine.EVENT_CONFIG.events.map((event) => event.id)).size, 6);
  const values = [0.24, 0.99];
  const selected = engine.selectRoundEvent(() => values.shift());
  assert.equal(selected.id, 'last_push');
  assert.equal(engine.selectRoundEvent(() => 0.25), null);
});

test('события времени объявляют корректную длительность', () => {
  assert.equal(engine.getEventRoundDuration(60, engine.createRoundEvent('double_shift')), 90);
  assert.equal(engine.getEventRoundDuration(60, engine.createRoundEvent('emergency_blitz')), 30);
  assert.equal(engine.getEventRoundDuration(60, engine.createRoundEvent('last_push')), 60);
});

test('аварийный блиц и последний рывок начисляют очки один раз', () => {
  assert.equal(answer(engine.createRoundEvent('emergency_blitz'), true).points, 2);
  assert.equal(answer(engine.createRoundEvent('last_push'), true, 11).points, 1);
  assert.equal(answer(engine.createRoundEvent('last_push'), true, 10).points, 2);
});

test('проверка знаний начисляет бонус за каждую полную серию', () => {
  let event = engine.createRoundEvent('knowledge_check');
  const points = [];
  for (let index = 0; index < 3; index += 1) {
    const result = answer(event, true);
    event = result.event;
    points.push(result.points);
  }
  assert.deepEqual(points, [1, 1, 3]);
  event = answer(event, false).event;
  assert.equal(event.state.streak, 0);
});

test('без права на ошибку отключает удвоение после первого пропуска', () => {
  let event = engine.createRoundEvent('no_mistake');
  let result = answer(event, true);
  assert.equal(result.points, 2);
  event = answer(result.event, false).event;
  result = answer(event, true);
  assert.equal(result.points, 1);
});

test('премия за безопасность финализируется только один раз', () => {
  let event = engine.createRoundEvent('safety_bonus');
  for (let index = 0; index < 5; index += 1) event = answer(event, true).event;
  const first = engine.finalizeRoundEvent(event);
  assert.equal(first.bonus, 3);
  const second = engine.finalizeRoundEvent(first.event);
  assert.equal(second.bonus, 0);
});
