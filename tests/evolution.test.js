import test from 'node:test';
import assert from 'node:assert/strict';
import { RELATION_DIMENSIONS, SCHEMA_VERSION } from '../src/engine/constants.js';
import { createDemoWorld } from '../src/engine/demo-world.js';
import {
  computeRelationTension, computeRelationValue, describeRelationTension,
  nextFactionTier, relationDimensionsFromValue, settleClans,
} from '../src/engine/factions.js';
import { isNewerThanSupported, migrateCheckpoints, migrateWorld } from '../src/engine/migrations.js';
import { changeRelation, normalizeWorld, refreshFactionDerived } from '../src/engine/state.js';
import { evolveWorld } from '../src/engine/simulation.js';
import { buildWorldContext } from '../src/integration/context.js';
import { selectRollback } from '../src/integration/storage.js';

/** 一个"旧版本"存档：只有 schemaVersion=1 与单值关系，用来验证迁移。 */
function legacyWorld() {
  return {
    schemaVersion: 1,
    worldId: 'world_legacy',
    seed: 'legacy-seed',
    name: '旧世界',
    premise: '一个尚未分维度、尚未分派系的旧存档。',
    tone: '冷硬',
    round: 3,
    regions: [
      { id: 'region_a', name: '旧港', type: '港口', x: 180, y: 220, neighbors: [{ targetId: 'region_b', distance: 1 }] },
      { id: 'region_b', name: '旧城', type: '城市', x: 420, y: 240, neighbors: [{ targetId: 'region_a', distance: 1 }] },
    ],
    factions: [
      {
        id: 'faction_a',
        name: '甲盟',
        description: '旧存档里的甲盟。',
        stability: 72,
        goal: '守住旧港',
        customLegacyField: '必须原样保留',
        resources: { wealth: 61, influence: 54, manpower: 48 },
        relations: { faction_b: { value: -58, label: '世仇', treaty: '', grudge: '旧怨', lastChange: '第2轮' } },
      },
      {
        id: 'faction_b',
        name: '乙会',
        description: '旧存档里的乙会。',
        stability: 64,
        goal: '夺回旧港',
        resources: { wealth: 55, influence: 66, manpower: 70 },
        relations: { faction_a: { value: -58, label: '世仇', treaty: '', grudge: '旧怨', lastChange: '第2轮' } },
      },
    ],
    npcs: [
      { id: 'npc_a', name: '甲首', role: '盟主', factionId: 'faction_a', locationId: 'region_a', core: true },
    ],
    player: { name: '旅人', regionId: 'region_a', wealth: 120 },
  };
}

test('legacy v1 saves migrate to the current schema without losing data', () => {
  const legacy = legacyWorld();
  const { world, fromVersion, toVersion, migrated } = migrateWorld(legacy);
  assert.equal(migrated, true);
  assert.equal(fromVersion, 1);
  assert.equal(toVersion, SCHEMA_VERSION);
  assert.equal(world.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(world.migration.fromVersion, 1);
  assert.equal(world.name, '旧世界');
  assert.equal(world.round, 3);
  assert.equal(world.factions.length, 2);
  const factionA = world.factions.find((faction) => faction.id === 'faction_a');
  assert.equal(factionA.name, '甲盟');
  assert.equal(factionA.customLegacyField, '必须原样保留');
  assert.equal(factionA.resources.wealth, 61);
  assert.ok(Array.isArray(factionA.clans) && factionA.clans.length >= 2);
  assert.ok(factionA.clans.every((clan) => typeof clan.satisfaction === 'number'));
  assert.equal(typeof factionA.authority, 'number');
  assert.ok(factionA.tier);
  const relation = factionA.relations.faction_b;
  assert.equal(relation.value, -58);
  assert.equal(relation.dimensions.hostility, 58);
  assert.ok(relation.tension > 0);
});

test('migration is idempotent and keeps relation values intact', () => {
  const once = migrateWorld(legacyWorld()).world;
  const twice = migrateWorld(once);
  assert.equal(twice.migrated, false);
  assert.equal(twice.world, once);
  assert.equal(JSON.stringify(twice.world), JSON.stringify(once));
  const factionA = twice.world.factions.find((faction) => faction.id === 'faction_a');
  const dimensions = factionA.relations.faction_b.dimensions;
  assert.equal(computeRelationValue(dimensions), -58);
  const up = relationDimensionsFromValue(48);
  assert.equal(computeRelationValue(up), 48);
});

test('checkpoints migrate so rollback keeps working on old saves', () => {
  const legacy = legacyWorld();
  const checkpoints = [
    { messageIndex: 2, turnKey: 'turn-2', before: legacy, state: legacy },
    { messageIndex: 4, turnKey: 'turn-4', before: legacy, state: legacy },
  ];
  const migrated = migrateCheckpoints(checkpoints);
  assert.equal(migrated.length, 2);
  assert.equal(migrated[0].state.schemaVersion, SCHEMA_VERSION);
  assert.ok(migrated[1].before.factions[0].clans.length > 0);
  const rollback = selectRollback(migrated, [{}, {}, {}, {}]);
  assert.ok(rollback);
  assert.equal(rollback.schemaVersion, SCHEMA_VERSION);
  assert.equal(rollback.factions[0].customLegacyField, '必须原样保留');
  assert.ok(isNewerThanSupported({ schemaVersion: SCHEMA_VERSION + 1 }));
  assert.equal(isNewerThanSupported({ schemaVersion: SCHEMA_VERSION }), false);
});

test('contradictory relation dimensions create measurable tension', () => {
  const world = createDemoWorld();
  const [source, target] = world.factions;
  source.relations[target.id] = {
    value: 0,
    label: '中立',
    treaty: '',
    grudge: '',
    lastChange: '',
    dimensions: { trust: 62, interest: 85, culture: 40, fear: 55, hostility: 70 },
  };
  const normalized = normalizeWorld(world);
  const relation = normalized.factions.find((faction) => faction.id === source.id).relations[target.id];
  assert.ok(relation.tension >= 30, `tension=${relation.tension}`);
  assert.notEqual(relation.value, 0);
  const description = describeRelationTension(relation.dimensions);
  assert.equal(typeof description, 'string');
  assert.ok(description.length > 0);
  const mirrored = normalized.factions.find((faction) => faction.id === target.id).relations[source.id];
  assert.equal(mirrored.value, relation.value);
  assert.ok(computeRelationTension(relation.dimensions) >= 30);
});

test('dimension deltas move relations symmetrically and recompute the value', () => {
  const world = createDemoWorld();
  const [source, target] = world.factions;
  const before = source.relations[target.id]?.value ?? 0;
  changeRelation(world.factions, source.id, target.id, 0, '暗中共谋', { interest: 10, hostility: 6 });
  const forward = source.relations[target.id];
  const backward = target.relations[source.id];
  assert.equal(forward.value, backward.value);
  assert.equal(forward.dimensions.interest, backward.dimensions.interest);
  assert.equal(forward.dimensions.hostility, backward.dimensions.hostility);
  assert.equal(computeRelationValue(forward.dimensions), forward.value);
  assert.notEqual(forward.value, before);
  assert.ok(RELATION_DIMENSIONS.every((dimension) => typeof forward.dimensions[dimension.key] === 'number'));
});

test('clan demands reward and punish leader actions', () => {
  const world = createDemoWorld();
  const faction = world.factions[0];
  faction.clans = [
    { id: 'clan_profit', name: '通商派', demand: 'profit', strength: 50, satisfaction: 50, note: '' },
    { id: 'clan_security', name: '守成派', demand: 'security', strength: 40, satisfaction: 50, note: '' },
  ];
  const authority = faction.authority;
  const satisfied = settleClans(faction, 'trade', { success: true });
  assert.equal(satisfied.satisfied.length, 1);
  assert.ok(faction.clans[0].satisfaction > 50);
  assert.ok(faction.authority > authority);
  const afterTrade = faction.clans[0].satisfaction;
  const conflicted = settleClans(faction, 'pressure', { success: true });
  assert.equal(conflicted.conflicted.length, 1);
  assert.ok(faction.clans[0].satisfaction < afterTrade);
  assert.ok(faction.clans[0].note.length > 0);
});

test('stability is derived from clans and leader authority', () => {
  const world = createDemoWorld();
  const faction = world.factions[0];
  faction.authority = 70;
  faction.clans = [
    { id: 'c1', name: '主战派', demand: 'expansion', strength: 60, satisfaction: 80 },
    { id: 'c2', name: '主和派', demand: 'security', strength: 45, satisfaction: 78 },
  ];
  refreshFactionDerived(faction);
  const happyStability = faction.stability;
  faction.clans[1].satisfaction = 20;
  refreshFactionDerived(faction);
  assert.ok(faction.stability < happyStability, `${faction.stability} < ${happyStability}`);
  assert.ok(faction.tension > 0);
  assert.ok(faction.status.length > 0);
  const stable = { ...faction, authority: 20, clans: faction.clans.map((clan) => ({ ...clan, satisfaction: 20 })) };
  refreshFactionDerived(stable);
  assert.ok(stable.stability < faction.stability);
});

test('growing resources promote a faction to a higher tier', () => {
  const world = createDemoWorld();
  const faction = world.factions[0];
  faction.tier = 'regional';
  faction.resources = { wealth: 95, influence: 95, manpower: 95 };
  const upgrade = nextFactionTier(faction);
  assert.ok(upgrade);
  assert.ok(upgrade.rank > 2);
  faction.resources = { wealth: 10, influence: 10, manpower: 10 };
  const downgrade = nextFactionTier(faction);
  assert.ok(downgrade);
  assert.ok(downgrade.rank < 2);
});

test('evolution refreshes derived faction numbers and records clan activity', () => {
  const state = createDemoWorld();
  const result = evolveWorld(state, {}, {});
  assert.ok(result.lastEvolution.clanCount > 0);
  assert.ok(result.lastEvolution.maxFactionTension >= 0);
  for (const faction of result.factions) {
    assert.ok(faction.stability >= 0 && faction.stability <= 100, `stability=${faction.stability}`);
    assert.ok(faction.authority >= 0 && faction.authority <= 100);
    assert.ok(faction.cohesion >= 0 && faction.cohesion <= 100);
    assert.ok(Array.isArray(faction.clans) && faction.clans.length >= 2);
    assert.ok(faction.tier);
  }
});

test('world context exposes clans and relation dimensions to the main model', () => {
  const state = createDemoWorld();
  const context = buildWorldContext(state, {});
  assert.ok(context.includes('内部矛盾') || context.includes('派系'));
  for (const dimension of RELATION_DIMENSIONS) {
    if (context.includes(dimension.label)) {
      assert.ok(true);
      return;
    }
  }
  assert.fail('context does not mention any relation dimension');
});
