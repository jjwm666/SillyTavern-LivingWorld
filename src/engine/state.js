import {
  FESTIVAL_ORIGINS, RELATION_DIMENSION_KEYS, RUMOR_SCOPE_IDS, RUMOR_SCOPES,
  RUMOR_TYPES, RUMOR_TYPE_SCOPE, SCHEMA_VERSION,
} from './constants.js';
import {
  computeFactionCohesion, computeFactionStability, computeFactionTension,
  computeRelationTension, computeRelationValue, normalizeClans, normalizeRelationDimensions,
  normalizeTier, tierMeta,
} from './factions.js';
import { migrateWorld } from './migrations.js';
import {
  asArray, average, byId, deepClone, hashString, integer,
  relationLabel, stableId, text, unique,
} from './utils.js';

function normalizeGoal(goal, index) {
  if (typeof goal === 'string') goal = { description: goal };
  return {
    id: text(goal?.id, 80) || `goal_${index}`,
    description: text(goal?.description || goal?.name, 240, '维持现状'),
    priority: integer(goal?.priority, 5, 1, 10),
    progress: integer(goal?.progress, 0, 0, 100),
  };
}

function normalizeRelationship(value = {}) {
  return {
    trust: integer(value.trust, 0, -100, 100),
    affection: integer(value.affection, 0, -100, 100),
    fear: integer(value.fear, 0, 0, 100),
    debt: integer(value.debt, 0, -100, 100),
  };
}

function normalizeNpc(npc, index, regionIds, factionIds, coreLimit) {
  const name = text(npc?.name, 80, `人物 ${index + 1}`);
  const id = text(npc?.id, 100) || stableId('npc', name, index);
  const locationId = regionIds.includes(npc?.locationId) ? npc.locationId : regionIds[index % regionIds.length];
  const factionId = factionIds.includes(npc?.factionId) ? npc.factionId : null;
  const relationships = {};
  for (const [key, value] of Object.entries(npc?.relationships || {})) {
    relationships[text(key, 100)] = normalizeRelationship(value);
  }
  return {
    id,
    name,
    role: text(npc?.role, 120, '自由行动者'),
    description: text(npc?.description, 500),
    locationId,
    homeRegionId: regionIds.includes(npc?.homeRegionId) ? npc.homeRegionId : locationId,
    factionId,
    core: index < coreLimit && npc?.core !== false,
    alive: npc?.alive !== false,
    status: text(npc?.status, 80, '活跃'),
    attributes: {
      influence: integer(npc?.attributes?.influence, 3, 0, 10),
      cunning: integer(npc?.attributes?.cunning, 3, 0, 10),
      force: integer(npc?.attributes?.force, 3, 0, 10),
      empathy: integer(npc?.attributes?.empathy, 3, 0, 10),
      resources: integer(npc?.attributes?.resources, 3, 0, 10),
    },
    personality: {
      ambition: integer(npc?.personality?.ambition, 5, 0, 10),
      empathy: integer(npc?.personality?.empathy, 5, 0, 10),
      caution: integer(npc?.personality?.caution, 5, 0, 10),
      loyalty: integer(npc?.personality?.loyalty, 5, 0, 10),
    },
    needs: {
      safety: integer(npc?.needs?.safety, 6, 0, 10),
      wealth: integer(npc?.needs?.wealth, 5, 0, 10),
      belonging: integer(npc?.needs?.belonging, 5, 0, 10),
    },
    mood: {
      valence: integer(npc?.mood?.valence, 0, -10, 10),
      arousal: integer(npc?.mood?.arousal, 3, 0, 10),
      label: text(npc?.mood?.label, 30, '平静'),
    },
    goals: asArray(npc?.goals).slice(0, 4).map(normalizeGoal).length
      ? asArray(npc?.goals).slice(0, 4).map(normalizeGoal)
      : [normalizeGoal(text(npc?.goal, 200, '改善自身处境'), 0)],
    relationships,
    memories: asArray(npc?.memories).slice(-40).map((memory) => ({
      round: integer(memory?.round, 0, 0),
      content: text(memory?.content || memory, 400),
      emotionalWeight: integer(memory?.emotionalWeight, 0, -10, 10),
    })),
    secrets: asArray(npc?.secrets).slice(0, 8).map((secret) => text(secret, 400)).filter(Boolean),
    knownRumorIds: unique(asArray(npc?.knownRumorIds).map((id) => text(id, 100))),
    schedule: {
      current: text(npc?.schedule?.current, 160, '处理日常事务'),
      next: text(npc?.schedule?.next, 160, '观察局势'),
    },
    /** 日常生活：这一轮他在过什么日子。由 settleDailyLife 写入，注入时作为生活质感使用。 */
    routine: text(npc?.routine, 160, ''),
    plan: npc?.plan ? {
      id: text(npc.plan.id, 100) || `plan_${id}`,
      goal: text(npc.plan.goal, 240, '改善自身处境'),
      actionType: text(npc.plan.actionType, 40, 'pursue_goal'),
      targetId: text(npc.plan.targetId, 100),
      targetRegionId: text(npc.plan.targetRegionId, 100),
      stage: text(npc.plan.stage, 80, '筹备'),
      progress: integer(npc.plan.progress, 0, 0),
      requiredProgress: integer(npc.plan.requiredProgress, 3, 1, 12),
      stalls: integer(npc.plan.stalls, 0, 0, 10),
      createdRound: integer(npc.plan.createdRound, 0, 0),
      lastRound: integer(npc.plan.lastRound, 0, 0),
    } : null,
    lastAction: text(npc?.lastAction, 300),
  };
}

function normalizeFaction(faction, index, regionIds) {
  const name = text(faction?.name, 100, `势力 ${index + 1}`);
  const id = text(faction?.id, 100) || stableId('faction', name, index);
  const tier = normalizeTier(faction?.tier, faction);
  const meta = tierMeta(tier);
  const stability = integer(faction?.stability, meta.authorityBase, 0, 100);
  const authority = integer(faction?.authority, stability, 0, 100);
  const clans = normalizeClans(faction?.clans, { id, name, stability }, tier);
  return {
    id,
    name,
    description: text(faction?.description, 500),
    leaderNpcId: text(faction?.leaderNpcId, 100),
    homeRegionId: regionIds.includes(faction?.homeRegionId) ? faction.homeRegionId : regionIds[index % regionIds.length],
    tier,
    overlordId: text(faction?.overlordId, 100),
    resources: {
      wealth: integer(faction?.resources?.wealth, 50, 0, 100),
      influence: integer(faction?.resources?.influence, 50, 0, 100),
      manpower: integer(faction?.resources?.manpower, 50, 0, 100),
    },
    authority,
    stability,
    status: text(faction?.status, 30, '稳固'),
    goal: text(faction?.goal, 240, '维持影响力'),
    relations: faction?.relations && typeof faction.relations === 'object' && !Array.isArray(faction.relations)
      ? Object.fromEntries(Object.entries(faction.relations).filter(([, relation]) => relation && typeof relation === 'object'))
      : {},
    playerRelation: integer(faction?.playerRelation, 0, -100, 100),
    color: text(faction?.color, 20) || ['#6d8dff', '#e2aa5a', '#53bda9', '#c982e8', '#e47777', '#70b7df'][index % 6],
    clans,
    cohesion: computeFactionCohesion(clans),
    tension: computeFactionTension({ clans }),
  };
}

function normalizeRegion(region, index, depth = 0) {
  const name = text(region?.name, 100, `区域 ${index + 1}`);
  const result = {
    id: text(region?.id, 100) || stableId('region', name, index),
    name,
    type: text(region?.type, 40, '领域'),
    description: text(region?.description, 500),
    x: integer(region?.x, 100 + (index % 4) * 240, 30, 970),
    y: integer(region?.y, 100 + Math.floor(index / 4) * 190, 30, 530),
    controlFactionId: text(region?.controlFactionId, 100),
    resources: asArray(region?.resources).slice(0, 5).map((item) => text(item, 80)).filter(Boolean),
    danger: integer(region?.danger, 3, 0, 10),
    prosperity: integer(region?.prosperity, 55, 0, 100),
    unrest: integer(region?.unrest, 15, 0, 100),
    population: integer(region?.population, 800, 0, 10000000),
    priceIndex: integer(region?.priceIndex, 100, 30, 400),
    weather: {
      type: text(region?.weather?.type, 30, ['晴朗', '多云', '微风', '薄雾'][index % 4]),
      intensity: integer(region?.weather?.intensity, index % 4 === 3 ? 1 : 0, 0, 3),
      remaining: integer(region?.weather?.remaining, 2 + index % 3, 1, 8),
    },
    neighbors: asArray(region?.neighbors).map((edge) => ({
      targetId: text(edge?.targetId || edge?.id || edge, 100),
      distance: integer(edge?.distance, 1, 1, 20),
      terrain: text(edge?.terrain, 40, '道路'),
    })).filter((edge) => edge.targetId),
    children: [],
  };
  if (depth < 3) {
    result.children = asArray(region?.children || region?.subregions).slice(0, 24).map((child, childIndex) => normalizeRegion(child, childIndex, depth + 1));
    if (result.children.length) connectRegions(result.children);
  }
  return result;
}

function connectRegions(regions) {
  const ids = regions.map((region) => region.id);
  const addEdge = (source, target, distance = 1) => {
    if (!source || !target || source.id === target.id) return;
    if (!source.neighbors.some((edge) => edge.targetId === target.id)) {
      source.neighbors.push({ targetId: target.id, distance, terrain: '道路' });
    }
    if (!target.neighbors.some((edge) => edge.targetId === source.id)) {
      target.neighbors.push({ targetId: source.id, distance, terrain: '道路' });
    }
  };
  for (const region of regions) {
    region.neighbors = region.neighbors.filter((edge) => ids.includes(edge.targetId) && edge.targetId !== region.id);
  }
  for (let index = 0; index < regions.length; index += 1) {
    const region = regions[index];
    if (regions.length > 1) addEdge(region, regions[(index + 1) % regions.length], 1 + (index % 3));
    if (!region.neighbors.length && regions.length > 1) {
      const nearest = regions.filter((item) => item.id !== region.id).sort((a, b) => {
        const distanceA = Math.hypot(a.x - region.x, a.y - region.y);
        const distanceB = Math.hypot(b.x - region.x, b.y - region.y);
        return distanceA - distanceB;
      })[0];
      addEdge(region, nearest, 2);
    }
  }
}

function normalizeFactionRelation(existing, mirrored) {
  const dimensionsSource = existing?.dimensions || mirrored?.dimensions || null;
  const storedValue = integer(existing?.value ?? mirrored?.value, 0, -100, 100);
  const dimensions = normalizeRelationDimensions(dimensionsSource, storedValue);
  const value = dimensionsSource ? computeRelationValue(dimensions) : storedValue;
  return {
    value,
    dimensions,
    tension: computeRelationTension(dimensions),
    label: relationLabel(value),
    treaty: text(existing?.treaty || mirrored?.treaty, 100),
    grudge: text(existing?.grudge || mirrored?.grudge, 240),
    lastChange: text(existing?.lastChange || mirrored?.lastChange, 240),
  };
}

function normalizeRelations(factions) {
  const raw = new Map(factions.map((faction) => [faction.id, faction.relations || {}]));
  for (const faction of factions) {
    const source = raw.get(faction.id) || {};
    const next = {};
    for (const other of factions) {
      if (other.id === faction.id) continue;
      next[other.id] = normalizeFactionRelation(source[other.id], (raw.get(other.id) || {})[faction.id]);
    }
    faction.relations = next;
  }
  // 第二遍保证双向完全一致（畸形存档里偶发的镜像缺失也在这里修正）
  for (const faction of factions) {
    for (const other of factions) {
      if (faction.id === other.id) continue;
      const relation = faction.relations[other.id];
      const mirror = other.relations[faction.id];
      if (!relation || !mirror) continue;
      if (relation.value !== mirror.value) {
        const value = Math.round((relation.value + mirror.value) / 2);
        for (const item of [relation, mirror]) {
          item.value = value;
          item.label = relationLabel(value);
        }
      }
      mirror.dimensions = deepClone(relation.dimensions);
      mirror.tension = relation.tension;
    }
  }
}

function resolveOverlords(factions) {
  const ids = factions.map((faction) => faction.id);
  const byIdMap = new Map(factions.map((faction) => [faction.id, faction]));
  for (const faction of factions) {
    if (!faction.overlordId || !ids.includes(faction.overlordId) || faction.overlordId === faction.id) {
      faction.overlordId = '';
      continue;
    }
    // 防止互相成为宗主形成环
    const seen = new Set([faction.id]);
    let cursor = byIdMap.get(faction.overlordId);
    while (cursor) {
      if (seen.has(cursor.id)) {
        faction.overlordId = '';
        break;
      }
      seen.add(cursor.id);
      cursor = cursor.overlordId ? byIdMap.get(cursor.overlordId) : null;
    }
  }
}

const KNOWN_KEYS = new Set([
  'schemaVersion', 'migration', 'worldId', 'seed', 'name', 'premise', 'tone', 'round',
  'pendingTurns', 'calendar', 'player', 'worldDigest', 'trends', 'regions', 'factions',
  'npcs', 'events', 'rumors', 'economy', 'storyHooks', 'twists', 'background', 'logs',
  'dice', 'lastEvolution', 'chronicle', 'evolutionCount', 'festivals',
]);

/** 存档允许保留的人物总数上限。核心层数量由设置决定，这里只兜底防止存档失控。 */
export const NPC_HARD_LIMIT = 400;

export function normalizeWorld(input = {}, options = {}) {
  const migrated = migrateWorld(input);
  const source = migrated.world && typeof migrated.world === 'object' ? migrated.world : {};
  const passthrough = {};
  for (const [key, value] of Object.entries(source)) {
    if (!KNOWN_KEYS.has(key)) passthrough[key] = value;
  }
  const coreLimit = integer(options.coreNpcLimit, 24, 1, NPC_HARD_LIMIT);
  const sourceRegions = asArray(source.regions).length ? source.regions : [{ name: '起始之地', type: '领域' }];
  const regions = sourceRegions.slice(0, 60).map((region, index) => normalizeRegion(region, index, 0));
  connectRegions(regions);
  const regionIds = regions.map((region) => region.id);
  const sourceFactions = asArray(source.factions).length ? source.factions : [{ name: '地方议会', goal: '维持秩序' }];
  const factions = sourceFactions.slice(0, 24).map((faction, index) => normalizeFaction(faction, index, regionIds));
  const factionIds = factions.map((faction) => faction.id);
  resolveOverlords(factions);
  for (const region of regions) {
    if (!factionIds.includes(region.controlFactionId)) region.controlFactionId = factions[regionIds.indexOf(region.id) % factions.length]?.id || null;
  }
  normalizeRelations(factions);
  const sourceNpcs = asArray(source.npcs).length ? source.npcs : [{ name: '无名旅人', role: '观察者', core: true }];
  const npcs = sourceNpcs.slice(0, NPC_HARD_LIMIT).map((npc, index) => normalizeNpc(npc, index, regionIds, factionIds, coreLimit));
  const npcIds = npcs.map((npc) => npc.id);
  for (const faction of factions) {
    if (!npcIds.includes(faction.leaderNpcId)) faction.leaderNpcId = npcs.find((npc) => npc.factionId === faction.id)?.id || null;
  }
  const worldName = text(source.name || source.world?.name, 120, '未命名世界');
  const round = integer(source.round, 0, 0);
  return {
    ...passthrough,
    schemaVersion: SCHEMA_VERSION,
    ...(source.migration ? { migration: deepClone(source.migration) } : {}),
    worldId: text(source.worldId, 100) || `world_${hashString(`${worldName}:${options.seed || source.seed || 'origin'}`)}`,
    seed: text(options.seed || source.seed, 120) || hashString(`${worldName}:seed`),
    name: worldName,
    premise: text(source.premise || source.world?.premise, 1600, '一个持续变化的动态世界'),
    tone: text(source.tone || source.world?.tone, 300, '沉浸、因果一致、人物自主'),
    round,
    pendingTurns: integer(source.pendingTurns, 0, 0, 100),
    calendar: {
      year: integer(source.calendar?.year, 1, 1),
      month: integer(source.calendar?.month, 1, 1, 12),
      day: integer(source.calendar?.day, 1, 1, 30),
      turnLabel: text(source.calendar?.turnLabel, 60, '第 1 日'),
    },
    player: {
      name: text(source.player?.name, 100, '{{user}}'),
      regionId: regionIds.includes(source.player?.regionId) ? source.player.regionId : regionIds[0],
      wealth: integer(source.player?.wealth, 100, 0, 1000000000),
      income: integer(source.player?.income, 0, 0, 1000000000),
      expenses: integer(source.player?.expenses, 0, 0, 1000000000),
      reputation: {
        authority: integer(source.player?.reputation?.authority, 0, -100, 100),
        common: integer(source.player?.reputation?.common, 0, -100, 100),
        shadow: integer(source.player?.reputation?.shadow, 0, -100, 100),
        circuit: integer(source.player?.reputation?.circuit, 0, -100, 100),
      },
    },
    worldDigest: text(source.worldDigest, 1200, '世界刚刚苏醒，各方开始依照自己的目标行动。'),
    trends: asArray(source.trends).slice(0, 8).map((trend, index) => ({
      id: text(trend?.id, 100) || `trend_${index}`,
      name: text(trend?.name, 120, `时代潮流 ${index + 1}`),
      description: text(trend?.description, 500),
      intensity: integer(trend?.intensity, 3, 1, 5),
    })),
    regions,
    factions,
    npcs,
    events: asArray(source.events).slice(0, 80).map((event, index) => ({
      id: text(event?.id, 100) || `event_${index}`,
      name: text(event?.name, 160, `未命名事件 ${index + 1}`),
      description: text(event?.description, 600),
      type: event?.type === 'progress' ? 'progress' : 'conflict',
      level: integer(event?.level, 2, 1, 4),
      stage: text(event?.stage, 40, '萌芽'),
      status: ['active', 'completed', 'failed', 'archived'].includes(event?.status) ? event.status : 'active',
      pinned: event?.pinned === true,
      resolvedRound: integer(event?.resolvedRound, ['completed', 'failed'].includes(event?.status) ? round : 0, 0),
      retention: integer(event?.retention, 12, 1, 100),
      progress: integer(event?.progress, 0, -2, 100),
      requiredProgress: integer(event?.requiredProgress, 6, 2, 30),
      stalls: integer(event?.stalls, 0, 0, 10),
      regionId: regionIds.includes(event?.regionId) ? event.regionId : regionIds[0],
      actorIds: asArray(event?.actorIds).filter((id) => npcIds.includes(id)),
      factionIds: asArray(event?.factionIds).filter((id) => factionIds.includes(id)),
      createdRound: integer(event?.createdRound, round, 0),
      lastRound: integer(event?.lastRound, round, 0),
      history: asArray(event?.history).slice(-30).map((entry) => text(entry, 400)),
    })),
    rumors: asArray(source.rumors).slice(0, 100).map((rumor, index) => {
      const type = RUMOR_TYPES.includes(rumor?.type) ? rumor.type : 'rumor';
      const scope = RUMOR_SCOPE_IDS.includes(rumor?.scope) ? rumor.scope : (RUMOR_TYPE_SCOPE[type] || 'street');
      const reach = integer(rumor?.reach, RUMOR_SCOPES[scope].maxLocations, 1, 12);
      return {
        id: text(rumor?.id, 100) || `rumor_${index}`,
        content: text(rumor?.content, 500),
        type,
        scope,
        reach,
        decayCarry: Math.max(0, Math.min(4, Number(rumor?.decayCarry) || 0)),
        truth: text(rumor?.truth, 500),
        sourceRegionId: regionIds.includes(rumor?.sourceRegionId) ? rumor.sourceRegionId : regionIds[0],
        intensity: integer(rumor?.intensity, 2, 1, 4),
        locations: asArray(rumor?.locations).filter((location) => regionIds.includes(location?.regionId)).map((location) => ({
          regionId: location.regionId,
          strength: integer(location.strength, 2, 0, 4),
          arrivedRound: integer(location.arrivedRound, round, 0),
        })),
        createdRound: integer(rumor?.createdRound, round, 0),
        lastSpreadRound: integer(rumor?.lastSpreadRound, round, 0),
        lastScopeChangeRound: integer(rumor?.lastScopeChangeRound, 0, 0),
        active: rumor?.active !== false,
        pinned: rumor?.pinned === true,
        retention: integer(rumor?.retention, 8, 1, 100),
      };
    }),
    economy: {
      climate: text(source.economy?.climate, 30, '平稳'),
      priceIndex: integer(source.economy?.priceIndex, 100, 20, 400),
      lastSignal: text(source.economy?.lastSignal, 500, '市场暂未出现明显异常'),
      ledger: asArray(source.economy?.ledger).slice(-60).map((entry, index) => ({
        id: text(entry?.id, 120) || `ledger_${index}`,
        round: integer(entry?.round, round, 0),
        amount: integer(entry?.amount, 0, -1000000000, 1000000000),
        reason: text(entry?.reason, 240, '日常结算'),
        regionId: text(entry?.regionId, 100),
        balance: integer(entry?.balance, 0, 0, 1000000000),
      })),
    },
    storyHooks: asArray(source.storyHooks).slice(-40).map((hook, index) => ({
      id: text(hook?.id, 120) || `hook_${index}`,
      kind: ['npc', 'opportunity', 'complication'].includes(hook?.kind) ? hook.kind : 'npc',
      actorId: text(hook?.actorId, 100),
      regionId: regionIds.includes(hook?.regionId) ? hook.regionId : regionIds[0],
      title: text(hook?.title, 160, '新的剧情动向'),
      content: text(hook?.content, 600),
      urgency: integer(hook?.urgency, 1, 1, 3),
      status: ['active', 'approaching', 'resolved', 'expired'].includes(hook?.status) ? hook.status : 'active',
      createdRound: integer(hook?.createdRound, round, 0),
      expiresRound: integer(hook?.expiresRound, round + 3, 0),
    })),
    twists: asArray(source.twists).slice(-30).map((twist, index) => ({
      id: text(twist?.id, 120) || `twist_${index}`,
      round: integer(twist?.round, round, 0),
      kind: twist?.kind === 'opportunity' ? 'opportunity' : 'complication',
      actorId: text(twist?.actorId, 100),
      regionId: text(twist?.regionId, 100),
      content: text(twist?.content, 500),
      diceRollId: text(twist?.diceRollId, 120),
    })),
    background: {
      simulatedPeople: integer(source.background?.simulatedPeople, regions.reduce((sum, region) => sum + region.population, 0), 0),
      lastSettlement: text(source.background?.lastSettlement, 700, '背景人群维持日常生活'),
    },
    /** 分级压缩后的编年纪要：tier 1 最细，tier 3 最粗。旧日志被压进这里后从 logs 移除。 */
    chronicle: asArray(source.chronicle).slice(-160).map((entry, index) => ({
      id: text(entry?.id, 120) || `chron_${index}`,
      tier: Math.min(3, integer(entry?.tier, 1, 1, 3)),
      fromRound: integer(entry?.fromRound, round, 0),
      toRound: integer(entry?.toRound, round, 0),
      title: text(entry?.title, 160, `纪要 ${index + 1}`),
      text: text(entry?.text, 1400),
      entries: asArray(entry?.entries).slice(0, 12).map((item) => text(item, 200)).filter(Boolean),
      createdAt: text(entry?.createdAt, 40),
    })),
    evolutionCount: integer(source.evolutionCount, round, 0),
    festivals: asArray(source.festivals).slice(0, 40).map((festival, index) => ({
      id: text(festival?.id, 100) || `fest_${index}`,
      name: text(festival?.name, 60),
      month: integer(festival?.month, 1, 1, 12),
      day: integer(festival?.day, 1, 1, 30),
      description: text(festival?.description, 300),
      origin: FESTIVAL_ORIGINS.includes(festival?.origin) ? festival.origin : 'local',
      active: festival?.active !== false,
    })).filter((festival) => festival.name),
    logs: asArray(source.logs).slice(-400).map((log, index) => ({
      id: text(log?.id, 120) || `log_${index}`,
      round: integer(log?.round, round, 0),
      type: text(log?.type, 40, 'world'),
      title: text(log?.title, 180, '世界变化'),
      detail: text(log?.detail, 700),
      regionId: text(log?.regionId, 100),
      actorId: text(log?.actorId, 100),
      diceRollId: text(log?.diceRollId, 120),
      public: log?.public !== false,
    })),
    dice: asArray(source.dice).slice(-300),
    lastEvolution: source.lastEvolution ? deepClone(source.lastEvolution) : null,
  };
}

export function createWorldFromBootstrap(bootstrap, options = {}) {
  return normalizeWorld({ ...bootstrap, round: 0, logs: [], dice: [], events: bootstrap.events || [], rumors: bootstrap.rumors || [] }, options);
}

export function addLog(state, log) {
  state.logs.push({
    id: `log_${state.round}_${state.logs.length}_${hashString(`${log.title}:${log.detail}`)}`,
    round: state.round,
    type: log.type || 'world',
    title: text(log.title, 180, '世界变化'),
    detail: text(log.detail, 700),
    regionId: log.regionId || null,
    actorId: log.actorId || null,
    diceRollId: log.diceRollId || null,
    public: log.public !== false,
  });
  state.logs = state.logs.slice(-400);
}

export function addMemory(npc, round, content, emotionalWeight = 0) {
  npc.memories.push({ round, content: text(content, 400), emotionalWeight: integer(emotionalWeight, 0, -10, 10) });
  npc.memories = npc.memories.slice(-40);
}

/**
 * 修改两个势力之间的关系。
 * @param {number} delta 综合态度变化量，用于快速表达“关系变好/变差”
 * @param {string} reason 变化原因，会写入 lastChange
 * @param {object} [dimensionDelta] 显式维度增量，例如 { hostility: 12, fear: 6, trust: -4 }
 */
export function changeRelation(factions, sourceId, targetId, delta, reason, dimensionDelta = null) {
  const source = byId(factions, sourceId);
  const target = byId(factions, targetId);
  if (!source || !target || source.id === target.id) return;
  const explicit = dimensionDelta && typeof dimensionDelta === 'object' ? dimensionDelta : null;
  for (const [faction, other] of [[source, target], [target, source]]) {
    const relation = faction.relations[other.id] || {};
    const dimensions = normalizeRelationDimensions(relation.dimensions, integer(relation.value, 0, -100, 100));
    if (explicit) {
      for (const key of RELATION_DIMENSION_KEYS) {
        const step = Number(explicit[key]);
        if (!Number.isFinite(step) || step === 0) continue;
        dimensions[key] = integer(dimensions[key] + step, dimensions[key], 0, 100);
      }
    } else {
      const amount = Number(delta) || 0;
      const before = computeRelationValue(dimensions);
      if (amount > 0) {
        dimensions.trust = integer(dimensions.trust + Math.round(amount * 0.7), 0, 0, 100);
        dimensions.hostility = integer(dimensions.hostility - Math.round(amount * 0.3), 0, 0, 100);
      } else if (amount < 0) {
        const loss = -amount;
        dimensions.trust = integer(dimensions.trust - Math.round(loss * 0.4), 0, 0, 100);
        dimensions.hostility = integer(dimensions.hostility + Math.round(loss * 0.6), 0, 0, 100);
      }
      // 上面是"结构上合理"的分配，可能被 0 下界截断；这里补足残余，保证总变化量等于 delta。
      let residual = integer(before + amount, 0, -100, 100) - computeRelationValue(dimensions);
      if (residual > 0) {
        const cut = Math.min(dimensions.hostility, residual);
        dimensions.hostility -= cut;
        residual -= cut;
        if (residual > 0) dimensions.trust = integer(dimensions.trust + residual, 0, 0, 100);
      } else if (residual < 0) {
        dimensions.hostility = integer(dimensions.hostility - residual, 0, 0, 100);
      }
    }
    const value = computeRelationValue(dimensions);
    const next = {
      ...relation,
      value,
      dimensions,
      tension: computeRelationTension(dimensions),
      label: relationLabel(value),
      lastChange: text(reason, 240) || text(relation.lastChange, 240),
    };
    if (value <= -40 && reason) next.grudge = text(reason, 240);
    if (value >= 40 && next.grudge) next.grudge = '';
    faction.relations[other.id] = next;
  }
}

export function getFactionStatus(faction) {
  const score = average([faction.stability, faction.resources.wealth, faction.resources.influence, faction.resources.manpower]);
  if (score >= 80) return '鼎盛';
  if (score >= 60) return '稳固';
  if (score >= 45) return '倾轧';
  if (score >= 30) return '困顿';
  if (score >= 15) return '衰落';
  return '瓦解';
}

/** 重新计算势力与内部派系的派生数值，模拟每轮结束后调用。 */
export function refreshFactionDerived(faction) {
  faction.cohesion = computeFactionCohesion(faction.clans);
  faction.tension = computeFactionTension(faction);
  faction.stability = computeFactionStability(faction);
  faction.status = getFactionStatus(faction);
  return faction;
}

export function factionTierLabel(faction) {
  return tierMeta(normalizeTier(faction?.tier, faction)).label;
}

export function publicWorldSnapshot(state) {
  const snapshot = deepClone(state);
  for (const npc of snapshot.npcs) {
    delete npc.secrets;
    delete npc.memories;
    if (npc.plan) npc.plan = { goal: npc.plan.goal, stage: npc.plan.stage };
  }
  for (const rumor of snapshot.rumors) delete rumor.truth;
  return snapshot;
}
