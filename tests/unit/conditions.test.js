// Estados de conservação.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONDITIONS, CONDITION_IDS, conditionOf, conditionBadge } from '../../frontend/js/features/conditions.js';

test('sete estados, do melhor ao pior', () => {
  assert.deepEqual(CONDITION_IDS, ['M', 'NM', 'SP', 'MP', 'HP', 'D', 'HD']);
  assert.ok(CONDITIONS.every((c) => c.label && c.hint));
});

test('estado desconhecido cai em Near Mint', () => {
  assert.equal(conditionOf('XX').id, 'NM');
  assert.equal(conditionOf('HD').label, 'Hard Damaged');
});

test('selo mostra a sigla e explica o estado na dica', () => {
  const s = String(conditionBadge('MP'));
  assert.match(s, />MP</);
  assert.match(s, /Moderately Played/);
  assert.match(s, /cond-badge--played/);
  assert.match(String(conditionBadge('D')), /cond-badge--damaged/);
});
