import { FACTION_ACTIONS, NPC_ACTIONS, RELATION_DIMENSIONS } from './constants.js';
import { clanDemandOf, tierMeta } from './factions.js';
import { asArray, byId, deepClone, stageFor, text } from './utils.js';

function publicNpc(npc) {
  return {
    id: npc.id,
    name: npc.name,
    role: npc.role,
    locationId: npc.locationId,
    factionId: npc.factionId,
    status: npc.status,
  };
}

function knownRumorsFor(state, npc) {
  return state.rumors
    .filter((rumor) => rumor.active && npc.knownRumorIds.includes(rumor.id))
    .slice(-4)
    .map((rumor) => ({ id: rumor.id, content: rumor.content, type: rumor.type, scope: rumor.scope, intensity: rumor.intensity }));
}

function npcSecrets(npc) {
  return npc.secrets.slice(0, 2);
}

function relationDigest(faction, factions) {
  const out = {};
  for (const other of factions) {
    if (other.id === faction.id) continue;
    const relation = faction.relations?.[other.id];
    if (!relation) continue;
    out[other.id] = {
      label: relation.label,
      value: relation.value,
      tension: relation.tension,
      dimensions: deepClone(relation.dimensions || {}),
    };
  }
  return out;
}

function clanDigest(faction) {
  return asArray(faction.clans).map((clan) => ({
    name: clan.name,
    demand: clanDemandOf(clan).label,
    strength: clan.strength,
    satisfaction: clan.satisfaction,
    note: clan.note || undefined,
  }));
}

/**
 * 核心层可以很大（上限见 state.js 的 NPC_HARD_LIMIT），但一次推演请求里塞进几百份
 * 人物简报既昂贵也没必要。这里按「正文提到 → 与玩家同地 → 其余轮转」挑一批，
 * 未被挑中的人物本轮仍由本地启发式照常生活，只是不由模型提议。
 */
function selectBriefNpcs(state, coreNpcs, conversation, limit) {
  const safeLimit = Math.max(8, Math.min(240, Number(limit) || 48));
  if (coreNpcs.length <= safeLimit) return coreNpcs;
  const haystack = String(conversation || '');
  const noticed = [];
  const others = [];
  for (const npc of coreNpcs) {
    if ((npc.name && haystack.includes(npc.name)) || npc.locationId === state.player?.regionId) noticed.push(npc);
    else others.push(npc);
  }
  const offset = others.length ? ((Number(state.round) || 0) * 7) % others.length : 0;
  const rotated = others.slice(offset).concat(others.slice(0, offset));
  return noticed.concat(rotated).slice(0, safeLimit);
}

export function buildDirectorBrief(state, conversation = '', options = {}) {
  const regions = state.regions.map((region) => ({
    id: region.id,
    name: region.name,
    type: region.type,
    danger: region.danger,
    prosperity: region.prosperity,
    unrest: region.unrest,
    weather: region.weather,
    controlFactionId: region.controlFactionId,
    neighbors: region.neighbors.map((edge) => edge.targetId),
  }));
  const factions = state.factions.map((faction) => ({
    id: faction.id,
    name: faction.name,
    tier: faction.tier,
    tierLabel: tierMeta(faction.tier).label,
    goal: faction.goal,
    homeRegionId: faction.homeRegionId,
    resources: { ...faction.resources },
    authority: faction.authority,
    stability: faction.stability,
    cohesion: faction.cohesion,
    tension: faction.tension,
    status: faction.status,
    clans: clanDigest(faction),
    relations: relationDigest(faction, state.factions),
  }));
  const activeEvents = state.events
    .filter((event) => event.status === 'active')
    .map((event) => ({
      id: event.id,
      name: event.name,
      type: event.type,
      stage: stageFor(event),
      level: event.level,
      regionId: event.regionId,
      progress: event.progress,
      requiredProgress: event.requiredProgress,
    }));
  const allCoreNpcs = state.npcs.filter((npc) => npc.core && npc.alive);
  const npcBriefs = selectBriefNpcs(state, allCoreNpcs, conversation, options.briefNpcLimit)
    .map((npc) => {
      const region = byId(state.regions, npc.locationId);
      const nearby = state.npcs
        .filter((other) => other.id !== npc.id && other.alive && other.locationId === npc.locationId)
        .map((other) => other.name);
      const visibleEvents = activeEvents
        .filter((event) => event.regionId === npc.locationId)
        .map((event) => `${event.name}（${event.stage}）`);
      return {
        self: {
          ...publicNpc(npc),
          description: npc.description,
          attributes: { ...npc.attributes },
          personality: { ...npc.personality },
          needs: { ...npc.needs },
          mood: { ...npc.mood },
          goals: npc.goals.map((goal) => ({ ...goal })),
          relationships: deepClone(npc.relationships),
          memories: npc.memories.slice(-8).map((memory) => `${memory.round}:${memory.content}`),
          ownSecrets: npcSecrets(npc),
          schedule: { ...npc.schedule },
          routine: npc.routine || undefined,
          currentPlan: npc.plan ? { goal: npc.plan.goal, stage: npc.plan.stage, progress: npc.plan.progress, stalls: npc.plan.stalls } : null,
          factionTier: state.factions.find((faction) => faction.id === npc.factionId)?.tier || null,
        },
        currentRegion: region ? { id: region.id, name: region.name, danger: region.danger, weather: region.weather } : null,
        nearbyPeople: nearby,
        knownRumors: knownRumorsFor(state, npc),
        visibleEvents,
      };
    });
  return {
    instruction: '你是世界推演导演。只输出 JSON，不要解释。所有意图必须从以上人物、势力与地区的当前处境中推导出来，不要凭空引入新地名或新人物。',
    world: {
      name: state.name,
      premise: state.premise,
      tone: state.tone,
      round: state.round,
      trends: state.trends,
      economy: { climate: state.economy.climate, priceIndex: state.economy.priceIndex, lastSignal: state.economy.lastSignal },
      player: { name: state.player.name, regionId: state.player.regionId, reputation: { ...state.player.reputation } },
      activeStoryHooks: state.storyHooks.filter((hook) => ['active', 'approaching'].includes(hook.status)).map((hook) => ({
        id: hook.id,
        kind: hook.kind,
        title: hook.title,
        content: hook.content,
        regionId: hook.regionId,
        urgency: hook.urgency,
      })),
    },
    latestConversation: conversation,
    regions,
    factions,
    activeEvents,
    coreNpcTotal: allCoreNpcs.length,
    npcBriefs,
    allowedNpcActions: NPC_ACTIONS,
    allowedFactionActions: FACTION_ACTIONS,
  };
}

function customDirectives(options, key) {
  const parts = [];
  const override = text(options[key], 4000);
  if (override) parts.push(override);
  const jailbreak = text(options.jailbreakPrompt, 2000);
  if (jailbreak) parts.push(jailbreak);
  return parts.join('\n');
}

const RELATION_DIMENSION_GUIDE = RELATION_DIMENSIONS
  .map((dimension) => `${dimension.key}(${dimension.label})=${dimension.description}`)
  .join('；');

export function buildEvolutionPrompt(state, conversation = '', options = {}) {
  const brief = buildDirectorBrief(state, conversation, options);
  const directive = customDirectives(options, 'evolutionPrompt');
  return [
    '你是这个世界幕后推演的导演。你不写正文，只输出世界接下来一轮发生了什么。',
    '硬性要求：',
    '1. 只输出一个 JSON 对象，不要代码块标记，不要任何解释文字。',
    '2. 所有 ID 必须来自输入里已有的 npc/region/faction/event id，不要新造。',
    '3. npcIntents 覆盖全部 core NPC，每人一个行动，行为必须符合其性格、需求、目标与当前所在地区。',
    '4. factionIntents 每个势力一条，行动必须能解释成"首领为了什么而下这个决定"，并且要能看出会得罪或取悦哪些内部派系。',
    '5. 关系变化用 relationDelta 表达，不要只给一个综合分：',
    `   维度：${RELATION_DIMENSION_GUIDE}。`,
    '   正负都可，范围 -30..30；同一对势力的维度可以互相矛盾（例如利益上升但敌意也上升），这种矛盾正是后续剧情的燃料。',
    '6. 事件必须有推进逻辑：concluded 只写已经完成的小进程，重大冲突要分阶段。',
    '7. 不要凭空制造灾难。任何重大变故都要有前置条件，并且可以用 1-2 句话追溯到已有的趋势、派系不满或旧账。',
    '8. factionClans 是可选字段：只有当角色卡设定或当前局势要求出现新的内部派系、或既有派系的诉求应当改变时才填。派系名必须符合这个世界的语言与组织身份（不要用"激进派/务实派"这类通用词，除非确实贴切），每个势力最多 4 个派系，demand 用给定枚举。',
    '9. rumorProposals 必须给出 scope：official（官方通告，可信、传得快）、regional（区域消息，出不了本地）、street（小道消息，真假难辨）、secret（密闻，几乎不扩散）。reach 是它最多能传到的地区数（1-12），可以按局势调大或调小。',
    '输出结构：',
    '{',
    '  "npcIntents": [{ "npcId": "", "action": "pursue_goal|travel|investigate|trade|aid|scheme|recruit|confront|spread_rumor|rest|seek_player", "goal": "", "targetId": "", "targetRegionId": "", "summary": "一句话说明他为什么这么做", "secret": false }],',
    '  "factionIntents": [{ "factionId": "", "action": "consolidate|trade|improve_relations|pressure|expand", "targetFactionId": "", "regionId": "", "summary": "首领的动机与内部压力", "relationDelta": { "trust": 0, "interest": 0, "culture": 0, "fear": 0, "hostility": 0 }, "clanNote": "哪一派会因此得势或失势" }],',
    '  "factionClans": [{ "factionId": "", "reason": "为什么此刻会出现这样的内部派系", "clans": [{ "name": "贴合本世界语境的派系名", "demand": "expansion|profit|security|vengeance|reform", "strength": 45, "satisfaction": 50, "note": "它想要什么、在怨什么" }] }],',
    '  "eventProposals": [{ "name": "", "description": "", "type": "conflict|progress", "level": 1, "regionId": "", "actorIds": [], "factionIds": [], "concluded": false }],',
    '  "rumorProposals": [{ "content": "", "type": "rumor|announcement|report|sentiment", "scope": "official|regional|street|secret", "reach": 4, "truth": "", "sourceRegionId": "", "intensity": 2 }],',
    '  "economicSignal": { "climate": "繁荣|平稳|衰退|动荡", "priceDelta": 0, "description": "" },',
    '  "backgroundSignal": "一到两句背景人群的总体状态",',
    '  "playerImpactProposal": { "reputation": 0, "wealth": 0, "description": "" }',
    '}',
    directive,
    `世界输入：\n${JSON.stringify(brief)}`,
  ].filter(Boolean).join('\n');
}

export function buildBootstrapPrompt(material, options = {}) {
  // 一次请求里生成的核心人物有限，上限 60；设置更小时按设置来。
  const coreNpcTarget = Math.max(10, Math.min(60, Number(options.coreNpcLimit) || 10));
  const directive = customDirectives(options, 'bootstrapPrompt');
  return [
    '你是世界构建导演。请根据输入材料构造一个可持续推演的世界骨架，只输出 JSON。',
    '结构要求：',
    '{',
    '  "name": "世界名", "premise": "两三句核心设定", "tone": "叙事基调",',
    '  "regions": [{ "id": "", "name": "", "type": "城市|荒野|港口|要塞|聚落|遗迹|枢纽", "description": "", "x": 120, "y": 160, "danger": 3, "prosperity": 50, "population": 900, "resources": [], "controlFactionId": "", "weather": { "type": "晴朗", "intensity": 0, "remaining": 3 }, "neighbors": [{ "targetId": "", "distance": 1 }], "children": [ 次级区域，结构与父级相同，最多三层 ] }],',
    '  "factions": [{ "id": "", "name": "", "description": "", "tier": "hegemon|great|regional|local", "leaderNpcId": "", "homeRegionId": "", "goal": "", "resources": { "wealth": 50, "influence": 50, "manpower": 50 }, "authority": 55, "stability": 60, "overlordId": "",',
    '    "clans": [{ "name": "从材料里长出来的派系名，例如某个世家、商团、教团或军中阵营", "demand": "expansion|profit|security|vengeance|reform", "strength": 55, "satisfaction": 50, "note": "它想要什么、在怨什么" }],',
    '    "relations": { "对方 faction id": { "dimensions": { "trust": 40, "interest": 60, "culture": 50, "fear": 50, "hostility": 20 }, "treaty": "", "grudge": "" } } }],',
    '  "npcs": [{ "id": "", "name": "", "role": "", "description": "", "locationId": "", "factionId": "", "core": true, "routine": "他典型的一天怎么过", "attributes": { "influence": 5, "cunning": 5, "force": 5, "empathy": 5, "resources": 5 }, "personality": { "ambition": 5, "empathy": 5, "caution": 5, "loyalty": 5 }, "needs": { "safety": 5, "wealth": 5, "belonging": 5 }, "goals": [{ "description": "", "priority": 6 }], "secrets": [] }],',
    '  "events": [{ "name": "", "description": "", "type": "conflict|progress", "level": 2, "regionId": "", "actorIds": [], "factionIds": [] }],',
    '  "rumors": [{ "content": "", "type": "rumor|announcement|report|sentiment", "scope": "official|regional|street|secret", "reach": 4, "truth": "", "sourceRegionId": "", "intensity": 2 }],',
    '  "festivals": [{ "name": "本地节庆名", "month": 3, "day": 15, "description": "这一天会发生什么，人们怎么过" }],',
    '  "economy": { "climate": "平稳", "priceIndex": 100 },',
    '  "player": { "name": "{{user}}", "regionId": "", "wealth": 120 }',
    '}',
    '硬性要求：',
    `1. 至少 5 个势力、8 个区域、${coreNpcTarget} 个 core NPC，势力之间要有互相矛盾的关系。`,
    '2. 每个势力 2-4 个内部派系，诉求必须互相冲突：有人主战、有人主和、有人只想保本。派系名要从输入材料里长出来（家族、商号、教团、军中营号、地方士绅等），不要直接用"激进派/守旧派"这种通用标签；材料没写到的，按这个世界的语言习惯命名。',
    '3. 势力关系用五个维度表达，允许"利益很高但敌意很高"这类矛盾组合。',
    '4. 区域需要 x/y 坐标用于地图，children 次级区域与父级结构相同，最多三层：第三级即再次级区域。',
    '5. 玩家的位置必须是一个真实存在的 region id。',
    '6. festivals 写 2-4 个材料里真正存在的节庆（不是通用节日）；如果材料里确实没有节庆线索，就按当地生产、信仰与权力结构推断，并让它在设定上说得通。',
    '7. 只输出 JSON。',
    directive,
    `输入材料：\n${text(material, 20000)}`,
  ].filter(Boolean).join('\n');
}

export function heuristicProposal(state) {
  const npcIntents = [];
  for (const npc of state.npcs.filter((item) => item.core && item.alive)) {
    const faction = byId(state.factions, npc.factionId);
    const region = byId(state.regions, npc.locationId);
    const nearby = state.npcs.filter((other) => other.alive && other.id !== npc.id && other.locationId === npc.locationId);
    const rival = faction
      ? Object.entries(faction.relations).sort((a, b) => a[1].value - b[1].value)[0]
      : null;
    let action = 'pursue_goal';
    let targetId = '';
    if (npc.needs.safety <= 4) {
      action = 'investigate';
    } else if (npc.needs.wealth <= 3) {
      action = 'trade';
    } else if (npc.needs.belonging <= 3) {
      const ally = nearby.slice().sort((a, b) => (a.mood?.valence ?? 0) - (b.mood?.valence ?? 0))[0];
      if (ally) {
        action = 'aid';
        targetId = ally.id;
      } else action = 'investigate';
    } else if (region && region.danger >= 7) {
      action = 'rest';
    } else if (rival && rival[1].value <= -40) {
      action = 'scheme';
      targetId = rival[0];
    }
    npcIntents.push({
      npcId: npc.id,
      action,
      targetId,
      regionId: npc.locationId,
      goal: npc.goals[0]?.description || '改善自身处境',
      summary: `${npc.name}在${region?.name || '当地'}处理自己的事务`,
      secret: false,
    });
  }
  const factionIntents = [];
  for (const faction of state.factions) {
    const clans = asArray(faction.clans);
    const unhappy = clans.filter((clan) => clan.satisfaction < 45);
    const best = Object.entries(faction.relations)
      .sort((a, b) => b[1].value - a[1].value)[0];
    let action = 'consolidate';
    let targetFactionId = '';
    if (faction.stability < 50 && unhappy.length) {
      action = 'consolidate';
    } else if (best && best[1].value >= 20) {
      action = 'trade';
      targetFactionId = best[0];
    } else {
      const worst = Object.entries(faction.relations).sort((a, b) => a[1].value - b[1].value)[0];
      if (worst && worst[1].value <= -40) {
        action = 'pressure';
        targetFactionId = worst[0];
      }
    }
    factionIntents.push({
      factionId: faction.id,
      action,
      targetFactionId,
      regionId: faction.homeRegionId,
      summary: `${faction.name}按既定目标行动`,
      clanNote: unhappy.length ? `${unhappy[0].name}正在等待交代` : '',
    });
  }
  return { npcIntents, factionIntents };
}
