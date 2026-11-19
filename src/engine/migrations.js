import { RUMOR_SCOPE_IDS, RUMOR_SCOPES, RUMOR_TYPE_SCOPE, SCHEMA_VERSION } from './constants.js';
import {
  computeRelationTension, computeRelationValue, createDefaultClans,
  normalizeTier, relationDimensionsFromValue,
} from './factions.js';
import { asArray, integer, text } from './utils.js';

/**
 * 存档迁移。
 *
 * 设计约束（对应需求的第四点）：
 * - 幂等：每个迁移步骤都只补缺失结构，跑第二次不会重复生成派系或叠加数值。
 * - 不丢数据：迁移只增不改，原有字段（包括不认识的字段）原样保留。
 * - 不影响回滚：检查点里的 before/state 走同一个迁移函数，新旧存档都能读。
 */

function versionOf(raw) {
  return integer(raw?.schemaVersion, 1, 0, 999);
}

function migrateFactionRelations(faction) {
  const relations = faction?.relations;
  if (!relations || typeof relations !== 'object' || Array.isArray(relations)) return relations;
  const next = {};
  for (const [otherId, relation] of Object.entries(relations)) {
    if (!relation || typeof relation !== 'object') {
      next[otherId] = relation;
      continue;
    }
    if (relation.dimensions) {
      next[otherId] = relation;
      continue;
    }
    const dimensions = relationDimensionsFromValue(relation.value);
    next[otherId] = {
      ...relation,
      value: integer(relation.value, 0, -100, 100),
      dimensions,
      tension: integer(relation.tension, computeRelationTension(dimensions), 0, 100),
    };
  }
  return next;
}

function migrateFactionToV2(faction) {
  if (!faction || typeof faction !== 'object') return faction;
  const next = { ...faction };
  next.relations = migrateFactionRelations(faction);
  if (!next.tier) next.tier = normalizeTier(faction.tier, faction);
  if (!next.overlordId) next.overlordId = text(faction.overlordId, 100);
  if (!Number.isFinite(Number(faction.authority))) {
    next.authority = integer(faction.stability, 55, 0, 100);
  }
  if (!Array.isArray(faction.clans) || !faction.clans.length) {
    next.clans = createDefaultClans({ ...faction, stability: next.authority }, next.tier);
  }
  return next;
}

function migrateClanOrigin(faction) {
  if (!faction || typeof faction !== 'object') return faction;
  if (!Array.isArray(faction.clans)) return faction;
  let touched = false;
  const clans = faction.clans.map((clan) => {
    if (!clan || typeof clan !== 'object') return clan;
    if (clan.origin === 'api' || clan.origin === 'local') {
      return 'createdRound' in clan ? clan : { ...clan, createdRound: 0 };
    }
    touched = true;
    return { ...clan, origin: 'local', createdRound: integer(clan.createdRound, 0, 0) };
  });
  return touched ? { ...faction, clans } : faction;
}

/**
 * v2 → v3：风声分层（scope/reach）、纪要结构、成功推演计数、派系来源。
 * 全部只补缺失字段；已有 scope/reach 的存档不会被改写，因此可以重复执行。
 */
function migrateRumorToV3(rumor, round) {
  if (!rumor || typeof rumor !== 'object') return rumor;
  const type = ['announcement', 'report', 'rumor', 'sentiment'].includes(rumor.type) ? rumor.type : 'rumor';
  const scope = RUMOR_SCOPE_IDS.includes(rumor.scope) ? rumor.scope : (RUMOR_TYPE_SCOPE[type] || 'street');
  const meta = RUMOR_SCOPES[scope];
  return {
    ...rumor,
    type,
    scope,
    reach: integer(rumor.reach, meta.maxLocations, 1, 12),
    decayCarry: Number.isFinite(Number(rumor.decayCarry)) ? Number(rumor.decayCarry) : 0,
    createdRound: integer(rumor.createdRound, round, 0),
  };
}

function migrateToV3(world) {
  const round = integer(world.round, 0, 0);
  const next = { ...world };
  next.factions = asArray(world.factions).map(migrateClanOrigin);
  next.rumors = asArray(world.rumors).map((rumor) => migrateRumorToV3(rumor, round));
  if (!Array.isArray(world.chronicle)) next.chronicle = [];
  if (!Number.isFinite(Number(world.evolutionCount))) next.evolutionCount = round;
  if (!Array.isArray(world.festivals)) next.festivals = [];
  next.npcs = asArray(world.npcs).map((npc) => {
    if (!npc || typeof npc !== 'object' || 'routine' in npc) return npc;
    return { ...npc, routine: text(npc.schedule?.current, 160, '') };
  });
  next.schemaVersion = 3;
  return next;
}

const STEPS = [
  {
    to: 2,
    apply(world) {
      const next = { ...world };
      next.factions = asArray(world.factions).map(migrateFactionToV2);
      next.schemaVersion = 2;
      return next;
    },
  },
  {
    to: 3,
    apply(world) {
      return migrateToV3(world);
    },
  },
];

/**
 * 把任意版本的存档迁移到当前结构。
 * @returns {{ world: object, fromVersion: number, toVersion: number, migrated: boolean }}
 */
export function migrateWorld(raw) {
  if (!raw || typeof raw !== 'object') {
    return { world: raw, fromVersion: SCHEMA_VERSION, toVersion: SCHEMA_VERSION, migrated: false };
  }
  const fromVersion = versionOf(raw);
  let world = raw;
  let migrated = false;
  for (const step of STEPS) {
    if (versionOf(world) >= step.to) continue;
    world = step.apply(world);
    world.schemaVersion = step.to;
    migrated = true;
  }
  if (migrated) {
    world.migration = {
      fromVersion,
      toVersion: SCHEMA_VERSION,
      at: new Date().toISOString(),
    };
  }
  if (versionOf(world) < SCHEMA_VERSION) world.schemaVersion = SCHEMA_VERSION;
  return { world, fromVersion, toVersion: SCHEMA_VERSION, migrated };
}

/** 检查点里的 before/state 也要一起迁移，回滚才能继续工作。 */
export function migrateCheckpoint(checkpoint) {
  if (!checkpoint || typeof checkpoint !== 'object') return checkpoint;
  const next = { ...checkpoint };
  if (next.state) next.state = migrateWorld(next.state).world;
  if (next.before) next.before = migrateWorld(next.before).world;
  return next;
}

export function migrateCheckpoints(checkpoints) {
  return asArray(checkpoints).map(migrateCheckpoint);
}

export function isNewerThanSupported(raw) {
  return versionOf(raw) > SCHEMA_VERSION;
}

export { computeRelationValue };
