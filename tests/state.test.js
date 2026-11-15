import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoWorld } from '../src/engine/demo-world.js';
import { normalizeWorld } from '../src/engine/state.js';
import { selectBaseline, selectRollback } from '../src/integration/storage.js';

test('normalized map is connected and faction relations are mirrored', () => {
  const world = createDemoWorld();
  const visited = new Set([world.regions[0].id]);
  const queue = [world.regions[0].id];
  while (queue.length) {
    const regionId = queue.shift();
    const region = world.regions.find((item) => item.id === regionId);
    for (const edge of region.neighbors) {
      if (!visited.has(edge.targetId)) {
        visited.add(edge.targetId);
        queue.push(edge.targetId);
      }
    }
  }
  assert.equal(visited.size, world.regions.length);
  const council = world.factions.find((faction) => faction.id === 'faction_council');
  const clans = world.factions.find((faction) => faction.id === 'faction_clans');
  assert.equal(council.relations[clans.id].value, clans.relations[council.id].value);
});

test('normalization repairs invalid IDs and clamps values', () => {
  const world = normalizeWorld({
    name: 'Test', regions: [{ id: 'r', name: 'Region', danger: 999 }],
    factions: [{ id: 'f', name: 'Faction', stability: -20 }],
    npcs: [{ id: 'n', name: 'NPC', locationId: 'missing', factionId: 'missing' }],
  });
  assert.equal(world.npcs[0].locationId, 'r');
  assert.equal(world.npcs[0].factionId, null);
  assert.equal(world.regions[0].danger, 10);
  assert.equal(world.factions[0].stability, 0);
});

test('regenerate baseline is the state before the current AI floor', () => {
  const round0 = { round: 0 };
  const round1 = { round: 1 };
  const round2 = { round: 2 };
  const checkpoints = [
    { messageIndex: 0, before: round0, state: round1 },
    { messageIndex: 2, before: round1, state: round2 },
  ];
  const chat = [{ is_user: false }, { is_user: true }, { is_user: false }];
  assert.equal(selectBaseline(checkpoints, chat).round, 1);
  assert.equal(selectBaseline(checkpoints, []).round, 0);
});

test('new turn baseline uses the latest visible checkpoint', () => {
  const checkpoints = [
    { messageIndex: 0, before: { round: 0 }, state: { round: 1 } },
    { messageIndex: 2, before: { round: 1 }, state: { round: 2 } },
  ];
  const chat = [{ is_user: false }, { is_user: true }, { is_user: false }, { is_user: true }];
  assert.equal(selectBaseline(checkpoints, chat).round, 2);
});

test('deleting the latest AI floor rolls back exactly one evolution', () => {
  const checkpoints = [
    { messageIndex: 0, before: { round: 0 }, state: { round: 1 } },
    { messageIndex: 2, before: { round: 1 }, state: { round: 2 } },
  ];
  assert.equal(selectRollback(checkpoints, [{}, {}]).round, 1);
  assert.equal(selectRollback(checkpoints, []).round, 0);
  assert.equal(selectRollback(checkpoints, [{}, {}, {}]), null);
});
