import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoWorld } from '../src/engine/demo-world.js';
import { buildBootstrapPrompt, buildDirectorBrief, buildEvolutionPrompt, heuristicProposal } from '../src/engine/director.js';
import { evolveWorld } from '../src/engine/simulation.js';
import { byId, safeJsonParse } from '../src/engine/utils.js';
import { buildWorldContext } from '../src/integration/context.js';

test('same seed and intents reproduce the same dice results', () => {
  const first = createDemoWorld();
  const second = createDemoWorld();
  const proposal = heuristicProposal(first);
  const resultA = evolveWorld(first, proposal);
  const resultB = evolveWorld(second, proposal);
  assert.deepEqual(resultA.dice, resultB.dice);
  assert.equal(resultA.round, 1);
  assert.ok(resultA.dice.length > 30);
});

test('every core NPC receives an autonomous action without one API call per NPC', () => {
  const world = createDemoWorld();
  const result = evolveWorld(world, {});
  for (const npc of result.npcs.filter((item) => item.core)) {
    assert.ok(npc.lastAction, `${npc.name} should act`);
    assert.ok(npc.memories.length > 0);
  }
  assert.equal(result.lastEvolution.coreNpcActions, 12);
  assert.ok(result.background.simulatedPeople > 0);
});

test('travel cannot jump to a non-adjacent region', () => {
  const world = createDemoWorld();
  const npc = byId(world.npcs, 'npc_shen');
  const origin = npc.locationId;
  const result = evolveWorld(world, {
    npcIntents: [{ npcId: npc.id, action: 'travel', regionId: 'region_mire', summary: '直接跳往遥远地区' }],
  });
  assert.equal(byId(result.npcs, npc.id).locationId, origin);
  assert.ok(result.logs.some((log) => log.title.includes('路线限制')));
});

test('event stages advance through recorded local d20 checks', () => {
  const world = createDemoWorld();
  const result = evolveWorld(world, {});
  for (const event of result.events.filter((item) => item.createdRound === 0)) {
    const roll = result.dice.find((item) => item.actorId === event.id && item.action === 'event_progress');
    assert.ok(roll, `${event.name} should have a dice check`);
    assert.ok(event.history.some((entry) => entry.includes('第1轮')));
  }
});

test('rumors only occupy locations reachable through the route graph', () => {
  const world = createDemoWorld();
  const result = evolveWorld(world, {});
  for (const rumor of result.rumors) {
    const visited = new Set([rumor.sourceRegionId]);
    const queue = [rumor.sourceRegionId];
    while (queue.length) {
      const current = byId(result.regions, queue.shift());
      for (const edge of current.neighbors) {
        if (!visited.has(edge.targetId)) {
          visited.add(edge.targetId);
          queue.push(edge.targetId);
        }
      }
    }
    for (const location of rumor.locations) assert.ok(visited.has(location.regionId));
  }
});

test('each NPC brief excludes other people private secrets', () => {
  const world = createDemoWorld();
  world.npcs[0].secrets = ['FIRST_PRIVATE_SECRET'];
  world.npcs[1].secrets = ['SECOND_PRIVATE_SECRET'];
  const brief = buildDirectorBrief(world, 'test');
  const firstBrief = JSON.stringify(brief.npcBriefs[0]);
  assert.ok(firstBrief.includes('FIRST_PRIVATE_SECRET'));
  assert.ok(!firstBrief.includes('SECOND_PRIVATE_SECRET'));
});

test('public context hides private secrets and rumors outside the player region', () => {
  const world = createDemoWorld();
  world.npcs[0].secrets = ['DO_NOT_INJECT_THIS_SECRET'];
  const context = buildWorldContext(world, { maxChars: 12000 });
  assert.ok(!context.includes('DO_NOT_INJECT_THIS_SECRET'));
  assert.ok(context.includes('永远不会迷航'));
  assert.ok(!context.includes('工区可能在本月停止'));
  assert.ok(context.includes('<living_world>'));
});

test('secret injection is explicit and context respects its budget', () => {
  const world = createDemoWorld();
  world.npcs[0].secrets = ['NARRATOR_ONLY_SECRET'];
  const context = buildWorldContext(world, { maxChars: 12000, includeSecrets: true });
  assert.ok(context.includes('NARRATOR_ONLY_SECRET'));
  const limited = buildWorldContext(world, { maxChars: 1000 });
  assert.ok(limited.length <= 1000);
});

test('JSON parser accepts plain objects and fenced model output', () => {
  assert.deepEqual(safeJsonParse('```json\n{"ok":true}\n```'), { ok: true });
  assert.deepEqual(safeJsonParse('prefix {"value":2} suffix'), { value: 2 });
});

test('custom prompt presets reach only their intended backend requests', () => {
  const world = createDemoWorld();
  const evolution = buildEvolutionPrompt(world, 'recent chat', {
    evolutionPrompt: 'EVOLUTION_CUSTOM_DIRECTIVE',
    bootstrapPrompt: 'BOOTSTRAP_ONLY_DIRECTIVE',
    jailbreakPrompt: 'CUSTOM_CREATIVE_DIRECTIVE',
  });
  assert.ok(evolution.includes('EVOLUTION_CUSTOM_DIRECTIVE'));
  assert.ok(evolution.includes('CUSTOM_CREATIVE_DIRECTIVE'));
  assert.ok(!evolution.includes('BOOTSTRAP_ONLY_DIRECTIVE'));

  const bootstrap = buildBootstrapPrompt('character card', {
    bootstrapPrompt: 'BOOTSTRAP_ONLY_DIRECTIVE',
    evolutionPrompt: 'EVOLUTION_ONLY_DIRECTIVE',
    jailbreakPrompt: 'CUSTOM_CREATIVE_DIRECTIVE',
  });
  assert.ok(bootstrap.includes('BOOTSTRAP_ONLY_DIRECTIVE'));
  assert.ok(bootstrap.includes('CUSTOM_CREATIVE_DIRECTIVE'));
  assert.ok(!bootstrap.includes('EVOLUTION_ONLY_DIRECTIVE'));
  assert.ok(!buildWorldContext(world).includes('CUSTOM_CREATIVE_DIRECTIVE'));
});
