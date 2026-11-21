import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoWorld } from '../src/engine/demo-world.js';
import { evolveWorld, resolveFestivals } from '../src/engine/simulation.js';
import { maybeCompress, compressionState, chronicleSummary } from '../src/engine/chronicle.js';
import { mergeProposedClans } from '../src/engine/factions.js';
import { buildFocus, buildWorldContext } from '../src/integration/context.js';
import { byId } from '../src/engine/utils.js';

test('API generated clans are merged, capped per tier and marked as api origin', () => {
  const world = createDemoWorld();
  const faction = world.factions[0];
  const before = faction.clans.length;
  const report = mergeProposedClans(faction, [
    { name: '灰塔书记官', demand: 'reform', strength: 44, satisfaction: 62, note: '要求公开账目' },
    { name: '盐铁把头', demand: 'profit', strength: 58, satisfaction: 38, note: '只要商路通畅' },
  ], 4);
  assert.ok(report.added.length >= 1, 'at least one new clan should be accepted');
  assert.equal(faction.clans.length, before + report.added.length);
  for (const clan of report.added) {
    assert.equal(clan.origin, 'api');
    assert.equal(clan.createdRound, 4);
  }
  // 超过层级上限的提案要被拒绝，而不是无限膨胀
  const stuffed = { id: 'faction_x', tier: 'local', clans: Array.from({ length: 3 }, (_, index) => ({ id: `clan_x_${index}`, name: `旧派${index}`, demand: 'security', strength: 40, satisfaction: 40 })) };
  const capped = mergeProposedClans(stuffed, [{ name: '新派', demand: 'expansion' }], 5);
  assert.ok(capped.rejected.length >= 1);
});

test('aiClans=false keeps engine clans and ignores model proposals', () => {
  const world = createDemoWorld();
  const target = world.factions[1];
  const before = target.clans.length;
  const result = evolveWorld(world, {
    factionClans: [{ factionId: target.id, reason: '测试', clans: [{ name: '外来派系', demand: 'profit' }] }],
  }, { aiClans: false });
  assert.equal(byId(result.factions, target.id).clans.length, before);
  assert.equal(result.lastEvolution.createdClans.length, 0);
});

test('rumor scopes control how far a rumor actually travels', () => {
  const world = createDemoWorld();
  const region = world.regions[0];
  const base = {
    rumorProposals: [{ content: '港口的税吏换了人', sourceRegionId: region.id, intensity: 3 }],
    npcIntents: [],
    factionIntents: [],
  };
  const boost = { rumorLayers: true, diceModifier: 5 };
  const street = evolveWorld(world, { ...base, rumorProposals: [{ ...base.rumorProposals[0], type: 'rumor', scope: 'street' }] }, boost);
  const official = evolveWorld(world, { ...base, rumorProposals: [{ ...base.rumorProposals[0], type: 'announcement', scope: 'official', reach: 9 }] }, boost);
  const streetRumor = street.rumors.find((rumor) => rumor.content.includes('税吏'));
  const officialRumor = official.rumors.find((rumor) => rumor.content.includes('税吏'));
  assert.ok(streetRumor && officialRumor, 'both proposals should be accepted once the dice allow it');
  assert.equal(streetRumor.scope, 'street');
  assert.equal(officialRumor.scope, 'official');
  assert.ok(officialRumor.reach > streetRumor.reach, 'official notices must reach more regions than street talk');
  assert.ok((officialRumor.locations || []).length >= (streetRumor.locations || []).length);
});

test('festivals resolve from defaults, world saves and custom text', () => {
  const world = createDemoWorld();
  world.festivals = [{ name: '世界书里的节', month: 4, day: 9, description: '角色卡世界书带来的节庆', origin: 'worldbook' }];
  const list = resolveFestivals(world, { customFestivals: '灯河夜|7-15|全城放灯\n收成祭|9-21|重复的同名节庆应被合并' });
  const names = list.map((festival) => festival.name);
  assert.ok(names.includes('开河节'), 'default festivals stay available');
  assert.ok(names.includes('世界书里的节'));
  assert.ok(names.includes('灯河夜'));
  assert.equal(list.filter((festival) => festival.name === '收成祭').length, 1, 'duplicate names collapse into one entry');
  assert.equal(byId(list, 'x') || list.find((festival) => festival.name === '开河节').origin, 'local');
});

test('a festival day changes prosperity, unrest and prices', () => {
  const world = createDemoWorld();
  world.calendar.month = 9;
  world.calendar.day = 20; // 收成祭是 9-21，推演推进一天后命中
  const before = world.regions.map((region) => ({ prosperity: region.prosperity, unrest: region.unrest }));
  const result = evolveWorld(world, {}, { festivals: true });
  assert.ok(result.logs.some((log) => log.type === 'festival'), 'festival should leave a public record');
  const gained = result.regions.filter((region, index) => region.prosperity > before[index].prosperity).length;
  assert.ok(gained >= 1, 'festival should lift prosperity somewhere');
});

test('daily life writes routines without spending dice', () => {
  const world = createDemoWorld();
  const result = evolveWorld(world, { npcIntents: [], factionIntents: [] }, { dailyLife: true, dailyActors: 3 });
  const daily = result.logs.filter((log) => log.type === 'daily');
  assert.ok(daily.length >= 1, 'daily beats should be recorded');
  assert.ok(result.npcs.some((npc) => npc.routine && npc.routine.length > 2), 'at least one person should have a routine');
  assert.equal(result.lastEvolution.dailyLife.length, daily.length);
});

test('compression folds old rounds into tier-1 chronicle entries and is idempotent', () => {
  let world = createDemoWorld();
  const options = { compressionEnabled: true, compressEvery: 12, compressKeepRounds: 4, compressTier2Every: 5, compressTier3Every: 5 };
  for (let i = 0; i < 12; i += 1) world = evolveWorld(world, { npcIntents: [], factionIntents: [] }, options);
  assert.equal(world.evolutionCount, 12);
  const tier1 = world.chronicle.filter((entry) => entry.tier === 1);
  assert.ok(tier1.length >= 1, 'twelve successful evolutions should compress one window');
  const covered = tier1[0].toRound;
  assert.ok(covered > 0);
  // 被压缩的轮次不再堆在 logs 里；只保留非公开日志（秘密线索压缩后不能丢）
  assert.ok(world.logs.every((log) => log.round > covered || log.round === 0 || log.public === false));
  const snapshot = JSON.stringify(world.chronicle);
  maybeCompress(world, options);
  assert.equal(JSON.stringify(world.chronicle), snapshot, 'compression must not run twice for the same evolution count');
  const stats = compressionState(world, options);
  assert.equal(stats.evolutionCount, 12);
  assert.ok(stats.liveLogs <= world.logs.length);
  const summary = chronicleSummary(world, { tier1: 3 });
  assert.ok(summary.recent.length >= 1);
});

test('focus injection narrows NPCs to the region the prose is in', () => {
  const world = createDemoWorld();
  const playerRegion = byId(world.regions, world.player.regionId);
  const farNpc = world.npcs.find((npc) => npc.core && npc.locationId !== playerRegion.id);
  const nearNpc = world.npcs.find((npc) => npc.core && npc.locationId === playerRegion.id);
  const conversation = `我们继续往${byId(world.regions, farNpc.locationId)?.name || '别处'}走，顺便打听${farNpc.name}的下落。`;
  const focus = buildFocus(world, { conversation, focusInjection: true });
  assert.equal(focus.active, true);
  assert.ok(focus.npcs.has(farNpc.id), 'a mentioned person must be in focus');
  assert.ok(focus.npcs.has(nearNpc.id), 'people in the player region stay in focus');
  const narrow = buildWorldContext(world, { conversation, focusInjection: true, focusNpcLimit: 4 });
  const wide = buildWorldContext(world, { focusInjection: false });
  assert.ok(narrow.includes(farNpc.name));
  assert.ok(narrow.length <= wide.length, 'focus injection should not be longer than the full dump');
});

test('layered rumors reach the injection with their own credibility hint', () => {
  const world = createDemoWorld();
  world.rumors.push({
    id: 'rumor_official_test',
    content: '评议会宣布冬季减免港税',
    type: 'announcement',
    truth: '真',
    sourceRegionId: world.player.regionId,
    scope: 'official',
    reach: 9,
    intensity: 3,
    locations: [{ regionId: world.player.regionId, strength: 3, arrivedRound: 0 }],
    createdRound: 0,
    lastSpreadRound: 0,
    active: true,
    pinned: false,
    retention: 12,
    decayCarry: 0,
  });
  const context = buildWorldContext(world, { maxChars: 20000 });
  assert.ok(context.includes('官方通告'), 'official notices must be labelled as such');
  assert.ok(context.includes('评议会宣布冬季减免港税'));
});
