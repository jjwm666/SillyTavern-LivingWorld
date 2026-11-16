import assert from 'node:assert/strict';
import test from 'node:test';
import { parseModelList } from '../src/integration/api.js';

test('parseModelList reads openai style data array', () => {
  assert.deepEqual(
    parseModelList({ data: [{ id: 'gpt-b' }, { id: 'gpt-a' }, { id: 'gpt-a' }] }),
    ['gpt-a', 'gpt-b'],
  );
});

test('parseModelList reads string arrays and ollama style models', () => {
  assert.deepEqual(parseModelList(['m2', 'm1']), ['m1', 'm2']);
  assert.deepEqual(parseModelList({ models: [{ name: 'llama3' }] }), ['llama3']);
});

test('parseModelList ignores junk and empty rows', () => {
  assert.deepEqual(parseModelList({ data: [null, {}, { id: '  ' }, { id: 'ok' }] }), ['ok']);
  assert.deepEqual(parseModelList({ error: 'nope' }), []);
});
