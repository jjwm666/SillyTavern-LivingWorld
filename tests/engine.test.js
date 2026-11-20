import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoWorld } from '../src/engine/demo-world.js';
import { buildBootstrapPrompt, buildDirectorBrief, buildEvolutionPrompt, heuristicProposal } from '../src/engine/director.js';
import { evolveWorld } from '../src/engine/simulation.js';
import { byId, safeJsonParse } from '../src/engine/utils.js';
import { normalizeWorld } from '../src/engine/state.js';
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

test('weather increases real travel difficulty and regional prices', () => {
  const clear = createDemoWorld();
  const storm = createDemoWorld();
  for (const world of [clear, storm]) {
    for (const region of world.regions) region.weather.remaining = 8;
  }
  for (const id of ['region_harbor', 'region_capital']) {
    byId(storm.regions, id).weather = { type: '风暴', intensity: 3, remaining: 8 };
    byId(storm.regions, id).priceIndex = 150;
  }
  const proposal = { npcIntents: [{ npcId: 'npc_he', action: 'travel', regionId: 'region_capital', summary: '前往弥央城' }] };
  const clearResult = evolveWorld(clear, proposal);
  const stormResult = evolveWorld(storm, proposal);
  const clearRoll = clearResult.dice.find((roll) => roll.actorId === 'npc_he' && roll.action === 'travel');
  const stormRoll = stormResult.dice.find((roll) => roll.actorId === 'npc_he' && roll.action === 'travel');
  assert.equal(stormRoll.difficulty, clearRoll.difficulty + 6);
  assert.notEqual(byId(stormResult.regions, 'region_harbor').priceIndex, byId(clearResult.regions, 'region_harbor').priceIndex);
});

test('player trade changes wealth, ledger, reputation and faction standing', () => {
  const world = createDemoWorld();
  for (const key of Object.keys(world.player.reputation)) world.player.reputation[key] = 100;
  world.player.reputation.circuit = 0;
  const faction = byId(world.factions, 'faction_compact');
  faction.playerRelation = 100;
  const before = world.player.wealth;
  const result = evolveWorld(world, {
    playerImpactProposal: { action: 'trade', regionId: 'region_harbor', factionId: faction.id, amount: 10, summary: '出售航路物资' },
  }, { diceModifier: 10 });
  assert.equal(result.player.wealth, before + 19);
  assert.equal(result.player.reputation.circuit, 2);
  assert.equal(byId(result.factions, faction.id).playerRelation, 100);
  assert.equal(result.economy.ledger.length, 2);
  assert.equal(result.economy.ledger.at(-1).amount, 20);
  const roll = result.dice.find((item) => item.action === 'player_trade');
  assert.equal(roll.globalModifier, 10);
  assert.equal(roll.baseModifier, 4);
});

test('NPC seek_player creates an active story hook for the next generation', () => {
  const world = createDemoWorld();
  const result = evolveWorld(world, {
    npcIntents: [{ npcId: 'npc_he', action: 'seek_player', goal: '建立新航路', summary: '邀请玩家共同查看海图' }],
  }, { diceModifier: 10 });
  const hook = result.storyHooks.find((item) => item.actorId === 'npc_he');
  assert.ok(hook);
  assert.equal(hook.status, 'active');
  assert.equal(hook.regionId, result.player.regionId);
  assert.ok(buildWorldContext(result).includes('邀请玩家共同查看海图'));
});

test('pinned rumors resist dissipation while ordinary rumors lose local strength', () => {
  const ordinary = createDemoWorld();
  const pinned = createDemoWorld();
  pinned.rumors[0].pinned = true;
  for (const world of [ordinary, pinned]) {
    world.rumors[0].locations = [{ regionId: 'region_harbor', strength: 3, arrivedRound: 0 }];
    world.rumors[0].lastSpreadRound = 0;
  }
  const ordinaryResult = evolveWorld(evolveWorld(ordinary, {}), {});
  const pinnedResult = evolveWorld(evolveWorld(pinned, {}), {});
  assert.ok(ordinaryResult.rumors[0].locations.find((location) => location.regionId === 'region_harbor').strength < 3);
  assert.equal(pinnedResult.rumors[0].locations.find((location) => location.regionId === 'region_harbor').strength, 3);
});

test('resolved events archive after retention unless pinned', () => {
  const world = createDemoWorld();
  world.events[0].status = 'completed';
  world.events[0].resolvedRound = 0;
  world.events[0].retention = 1;
  world.events[1].status = 'completed';
  world.events[1].resolvedRound = 0;
  world.events[1].retention = 1;
  world.events[1].pinned = true;
  const result = evolveWorld(world, {});
  assert.equal(result.events[0].status, 'archived');
  assert.equal(result.events[1].status, 'completed');
});

test('bootstrap prompt requests recursive subregions and player state', () => {
  const prompt = buildBootstrapPrompt('generic card');
  assert.ok(prompt.includes('children 次级区域'));
  assert.ok(prompt.includes('再次级区域'));
  assert.ok(prompt.includes('"weather"'));
  assert.ok(prompt.includes('"wealth"'));
});

test('核心层可以超过百人，推演简报按上限挑选并优先带上玩家同地的人', () => {
  const demo = createDemoWorld();
  const playerRegion = demo.player.regionId;
  const others = demo.regions.filter((region) => region.id !== playerRegion).map((region) => region.id);
  const npcs = Array.from({ length: 220 }, (_, index) => ({
    name: `路人${index}`,
    role: '街坊',
    core: true,
    locationId: others[index % others.length],
  }));
  npcs.push({ name: '印证者', role: '邻居', core: true, locationId: playerRegion });
  const world = normalizeWorld({ ...demo, npcs }, { coreNpcLimit: 400 });
  assert.equal(world.npcs.length, 221);
  assert.equal(world.npcs.filter((npc) => npc.core).length, 221);

  const brief = buildDirectorBrief(world, '', { briefNpcLimit: 40 });
  assert.equal(brief.coreNpcTotal, 221);
  assert.equal(brief.npcBriefs.length, 40);
  assert.ok(brief.npcBriefs.some((entry) => entry.self.name === '印证者'), '玩家同地的人应优先进入简报');
});
