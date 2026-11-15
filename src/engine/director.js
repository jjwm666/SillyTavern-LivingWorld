import { NPC_ACTIONS, FACTION_ACTIONS } from './constants.js';
import { asArray, byId, text } from './utils.js';

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
  return state.rumors.filter((rumor) => rumor.active && (
    npc.knownRumorIds.includes(rumor.id)
    || rumor.locations.some((location) => location.regionId === npc.locationId && location.strength > 0)
  )).map((rumor) => ({
    id: rumor.id,
    content: rumor.content,
    type: rumor.type,
    intensity: rumor.intensity,
  }));
}

export function buildDirectorBrief(state, conversation = '') {
  const coreNpcs = state.npcs.filter((npc) => npc.core && npc.alive);
  return {
    instruction: '每个 NPC 只能使用自己的 npcBrief 信息，不得借用其他 NPC 的秘密、记忆或所在地信息。',
    world: {
      name: state.name,
      premise: state.premise,
      tone: state.tone,
      round: state.round + 1,
      trends: state.trends,
      economy: state.economy,
    },
    latestConversation: text(conversation, 14000),
    regions: state.regions.map((region) => ({
      id: region.id,
      name: region.name,
      type: region.type,
      description: region.description,
      controlFactionId: region.controlFactionId,
      danger: region.danger,
      prosperity: region.prosperity,
      unrest: region.unrest,
      neighbors: region.neighbors,
    })),
    factions: state.factions.map((faction) => ({
      id: faction.id,
      name: faction.name,
      goal: faction.goal,
      homeRegionId: faction.homeRegionId,
      resources: faction.resources,
      stability: faction.stability,
      relations: faction.relations,
    })),
    activeEvents: state.events.filter((event) => event.status === 'active').map((event) => ({
      id: event.id,
      name: event.name,
      description: event.description,
      type: event.type,
      level: event.level,
      stage: event.stage,
      regionId: event.regionId,
      actorIds: event.actorIds,
      factionIds: event.factionIds,
    })),
    npcBriefs: coreNpcs.map((npc) => {
      const region = byId(state.regions, npc.locationId);
      return {
        self: {
          ...publicNpc(npc),
          description: npc.description,
          attributes: npc.attributes,
          personality: npc.personality,
          needs: npc.needs,
          mood: npc.mood,
          goals: npc.goals,
          relationships: npc.relationships,
          memories: npc.memories.slice(-8),
          ownSecrets: npc.secrets,
          schedule: npc.schedule,
          currentPlan: npc.plan,
        },
        currentRegion: region ? {
          id: region.id,
          name: region.name,
          description: region.description,
          danger: region.danger,
          resources: region.resources,
          neighbors: region.neighbors,
        } : null,
        nearbyPeople: state.npcs.filter((other) => other.id !== npc.id && other.alive && other.locationId === npc.locationId).map(publicNpc),
        knownRumors: knownRumorsFor(state, npc),
        visibleEvents: state.events.filter((event) => event.status === 'active' && event.regionId === npc.locationId).map((event) => ({
          id: event.id,
          name: event.name,
          stage: event.stage,
          description: event.description,
        })),
      };
    }),
    allowedNpcActions: NPC_ACTIONS,
    allowedFactionActions: FACTION_ACTIONS,
  };
}

function customDirectives(options, key) {
  const specific = text(options?.[key], 6000);
  const jailbreak = text(options?.jailbreakPrompt, 6000);
  if (!specific && !jailbreak) return '';
  return `\n\n用户自定义创作指令（仍须遵守上述 JSON 结构与本地判定边界）：\n${specific}${specific && jailbreak ? '\n' : ''}${jailbreak}`;
}

export function buildEvolutionPrompt(state, conversation, options = {}) {
  const brief = buildDirectorBrief(state, conversation);
  return `你是多主体世界的“意图导演”，不是判定器，也不能直接修改世界数值。
根据最新对话和每个角色的有限认知，为世界下一轮提出行动意图。

硬性规则：
1. NPC 不知道的信息绝不能成为其行动理由；不得读取其他 npcBrief 的秘密。
2. 重要 NPC 即使没有接触玩家，也要基于自己的目标、需求、日程和关系继续生活。
3. 旅行只能选择当前区域的相邻 regionId；同地互动才可选择附近人物。
4. 你只提出意图，不宣布成功，不写骰点，不直接改变资源、关系、控制权或事件阶段。
5. 行动 ID 必须来自输入。秘密行动设置 secret=true。
6. 最多返回 ${brief.npcBriefs.length} 个 npcIntents、${state.factions.length} 个 factionIntents、2 个 eventProposals、2 个 rumorProposals。
7. 只输出一个合法 JSON 对象，不要 Markdown，不要解释。

返回结构：
{
  "npcIntents": [{"npcId":"ID","action":"${NPC_ACTIONS.join('|')}","targetId":"可选人物或势力ID","regionId":"可选相邻地区ID","goal":"行动目的","summary":"打算做什么，而非结果","secret":false}],
  "factionIntents": [{"factionId":"ID","action":"${FACTION_ACTIONS.join('|')}","targetFactionId":"可选势力ID","regionId":"扩张时必填","summary":"意图"}],
  "eventProposals": [{"name":"事件名","description":"起因与潜在影响","type":"conflict|progress","level":1,"regionId":"ID","actorIds":[],"factionIds":[]}],
  "rumorProposals": [{"content":"可能失真的内容","type":"announcement|report|rumor|sentiment","sourceRegionId":"ID","intensity":1}],
  "economicSignal":"可选，可观察到的市场变化",
  "backgroundSignal":"可选，背景人群的整体动向"
}

${customDirectives(options, 'evolutionPrompt')}

世界输入：\n${JSON.stringify(brief)}`;
}

export function buildBootstrapPrompt(material, options = {}) {
  const regionCount = Math.max(6, Math.min(12, options.regionCount || 8));
  const factionCount = Math.max(3, Math.min(8, options.factionCount || 5));
  const npcCount = Math.max(8, Math.min(24, options.coreNpcLimit || 14));
  return `把以下角色卡、世界设定与聊天材料转化为可模拟的通用世界。题材可以完全遵从输入，不要擅自改成古代或奇幻。
只输出合法 JSON，不要 Markdown。所有名称使用设定对应语言，引用 ID 保持一致。
地图必须有 ${regionCount} 个左右区域，坐标 x 范围 60-940、y 范围 50-510；neighbors 构成连通的路线网络。
势力 ${factionCount} 个左右，核心 NPC ${npcCount} 个左右。NPC 应有各自独立目标，不能都围绕玩家。
NPC 的 locationId、factionId，势力的 homeRegionId、leaderNpcId，区域的 controlFactionId 必须有效。

结构：
{
 "name":"世界名","premise":"世界概述","tone":"叙事基调",
 "calendar":{"year":1,"month":1,"day":1,"turnLabel":"初始时间"},
 "trends":[{"name":"时代主线","description":"影响","intensity":3}],
 "regions":[{"id":"region_1","name":"...","type":"...","description":"...","x":100,"y":100,"controlFactionId":"faction_1","resources":[],"danger":3,"prosperity":55,"unrest":15,"population":1000,"neighbors":[{"targetId":"region_2","distance":2,"terrain":"道路"}]}],
 "factions":[{"id":"faction_1","name":"...","description":"...","leaderNpcId":"npc_1","homeRegionId":"region_1","resources":{"wealth":50,"influence":50,"manpower":50},"stability":65,"goal":"...","playerRelation":0}],
 "npcs":[{"id":"npc_1","name":"...","role":"...","description":"...","locationId":"region_1","homeRegionId":"region_1","factionId":"faction_1","core":true,"attributes":{"influence":3,"cunning":3,"force":3,"empathy":3,"resources":3},"personality":{"ambition":5,"empathy":5,"caution":5,"loyalty":5},"needs":{"safety":6,"wealth":5,"belonging":5},"mood":{"valence":0,"arousal":3,"label":"平静"},"goals":[{"description":"长期目标","priority":8}],"relationships":{},"memories":[],"secrets":[],"schedule":{"current":"...","next":"..."}}],
 "events":[{"name":"...","description":"...","type":"conflict","level":2,"regionId":"region_1","actorIds":[],"factionIds":[],"requiredProgress":6}],
 "rumors":[{"content":"...","type":"rumor","sourceRegionId":"region_1","intensity":2}],
 "economy":{"climate":"平稳","priceIndex":100,"lastSignal":"..."}
}

${customDirectives(options, 'bootstrapPrompt')}

原始材料：\n${text(material, 30000)}`;
}

export function heuristicProposal(state) {
  const npcIntents = [];
  for (const npc of state.npcs.filter((item) => item.core && item.alive)) {
    const region = byId(state.regions, npc.locationId);
    const nearby = state.npcs.find((other) => other.id !== npc.id && other.alive && other.locationId === npc.locationId);
    const faction = byId(state.factions, npc.factionId);
    const hostile = faction ? Object.entries(faction.relations).sort((a, b) => a[1].value - b[1].value)[0] : null;
    let intent = { npcId: npc.id, action: 'pursue_goal', goal: npc.goals[0]?.description || '改善自身处境', summary: `推进“${npc.goals[0]?.description || '个人计划'}”`, secret: false };
    if (region?.danger >= 7 || npc.needs.safety <= 3) {
      const safestEdge = [...(region?.neighbors || [])].sort((a, b) => byId(state.regions, a.targetId).danger - byId(state.regions, b.targetId).danger)[0];
      if (safestEdge) intent = { npcId: npc.id, action: 'travel', regionId: safestEdge.targetId, goal: '寻找更安全的环境', summary: `准备前往${byId(state.regions, safestEdge.targetId).name}`, secret: false };
    } else if (npc.needs.wealth <= 4 || npc.attributes.resources <= 2) {
      intent = { npcId: npc.id, action: 'trade', goal: '改善资源状况', summary: '寻找有利可图的交易', secret: false };
    } else if (npc.needs.belonging <= 3 && nearby) {
      intent = { npcId: npc.id, action: 'aid', targetId: nearby.id, goal: '建立可靠关系', summary: `尝试帮助${nearby.name}`, secret: false };
    } else if (hostile && hostile[1].value <= -40 && npc.personality.ambition >= 6) {
      intent = { npcId: npc.id, action: 'scheme', targetId: hostile[0], goal: npc.goals[0]?.description, summary: `暗中削弱${byId(state.factions, hostile[0])?.name || '对手'}`, secret: true };
    }
    npcIntents.push(intent);
  }
  const factionIntents = state.factions.map((faction) => {
    if (faction.stability < 50) return { factionId: faction.id, action: 'consolidate', summary: '优先恢复内部稳定' };
    const relations = Object.entries(faction.relations).sort((a, b) => b[1].value - a[1].value);
    const friend = relations[0];
    if (friend) return { factionId: faction.id, action: 'trade', targetFactionId: friend[0], summary: '与友好势力寻求互利交易' };
    return { factionId: faction.id, action: 'consolidate', summary: '巩固现有资源' };
  });
  const eventProposals = [];
  if (!state.events.some((event) => event.status === 'active')) {
    const region = [...state.regions].sort((a, b) => b.unrest - a.unrest)[0];
    eventProposals.push({
      name: `${region.name}的局势变化`,
      description: '资源分配与地方矛盾逐渐形成新的冲突。',
      type: 'conflict', level: 2, regionId: region.id, actorIds: [], factionIds: [region.controlFactionId].filter(Boolean),
    });
  }
  return {
    npcIntents,
    factionIntents,
    eventProposals,
    rumorProposals: [],
    economicSignal: '',
    backgroundSignal: '',
  };
}
