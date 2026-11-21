import {
  ACTION_LABELS, DAILY_ACTIVITIES, DEFAULT_FESTIVALS, EVENT_STAGES, FACTION_ACTIONS,
  NPC_ACTIONS, RELATION_DIMENSION_KEYS, RUMOR_SCOPES, RUMOR_SCOPE_IDS, RUMOR_TYPES, RUMOR_TYPE_SCOPE,
} from './constants.js';
import { maybeCompress } from './chronicle.js';
import { heuristicProposal } from './director.js';
import {
  clanDemandOf, describeClan, mergeProposedClans, nextFactionTier, normalizeTier,
  resolveClanDemand, settleClans, tierMeta, unhappiestClan,
} from './factions.js';
import { isSuccess, progressFromOutcome, rollCheck, SeededRandom } from './rng.js';
import { addLog, addMemory, changeRelation, refreshFactionDerived } from './state.js';
import {
  asArray, average, byId, clamp, deepClone, hashString, integer,
  relationLabel, stageFor, text,
} from './utils.js';

function ensureNpcRelationship(npc, targetId) {
  if (!npc.relationships[targetId]) npc.relationships[targetId] = { trust: 0, affection: 0, fear: 0, debt: 0 };
  return npc.relationships[targetId];
}

function changeNpcTrust(source, target, amount) {
  if (!source || !target) return;
  for (const [npc, other] of [[source, target], [target, source]]) {
    const relation = ensureNpcRelationship(npc, other.id);
    relation.trust = integer(relation.trust + amount, 0, -100, 100);
  }
}

function updateMood(npc, valenceDelta, arousalDelta = 0) {
  npc.mood.valence = integer(npc.mood.valence + valenceDelta, 0, -10, 10);
  npc.mood.arousal = integer(npc.mood.arousal + arousalDelta, 0, 0, 10);
  npc.mood.label = npc.mood.valence <= -6 ? '悲观'
    : npc.mood.valence <= -2 ? '焦虑'
      : npc.mood.valence >= 6 ? '振奋'
        : npc.mood.arousal >= 7 ? '警惕' : '平静';
}

function ensurePlan(npc, round, intent) {
  if (!npc.plan || npc.plan.stage === '已完成' || npc.plan.stage === '已失败') {
    npc.plan = {
      id: `plan_${npc.id}_${round}`,
      goal: text(intent.goal || npc.goals[0]?.description, 240, '改善自身处境'),
      actionType: intent.action,
      targetId: text(intent.targetId, 100),
      targetRegionId: text(intent.regionId, 100),
      stage: '筹备',
      progress: 0,
      requiredProgress: 3 + Math.floor(npc.personality.ambition / 3),
      stalls: 0,
      createdRound: round,
      lastRound: round,
    };
  }
  return npc.plan;
}

function advancePlan(npc, outcome, state) {
  if (!npc.plan) return;
  const plan = npc.plan;
  const delta = progressFromOutcome(outcome);
  if (delta > 0) {
    plan.progress += delta;
    plan.stalls = 0;
  } else {
    plan.stalls += delta < 0 ? 2 : 1;
  }
  plan.lastRound = state.round;
  const ratio = plan.progress / plan.requiredProgress;
  plan.stage = plan.progress >= plan.requiredProgress ? '已完成'
    : plan.stalls >= 3 ? '已失败'
      : ratio >= 0.66 ? '关键' : ratio >= 0.25 ? '执行' : '筹备';
  if (plan.stage === '已完成') {
    const goal = npc.goals.find((item) => item.description === plan.goal) || npc.goals[0];
    if (goal) goal.progress = integer(goal.progress + 35, 0, 0, 100);
    updateMood(npc, 2, -1);
    addLog(state, {
      type: 'npc', actorId: npc.id, regionId: npc.locationId,
      title: `${npc.name}完成了一个长期计划`,
      detail: `“${plan.goal}”经过多轮推进后完成，后续目标将重新评估。`,
    });
  } else if (plan.stage === '已失败') {
    updateMood(npc, -2, 1);
    addLog(state, {
      type: 'npc', actorId: npc.id, regionId: npc.locationId,
      title: `${npc.name}的计划受挫`,
      detail: `“${plan.goal}”连续停滞，原有方案被迫放弃。`,
    });
  }
}

function createRumor(state, { content, type = 'rumor', scope = '', sourceRegionId, intensity = 2, truth = '', reach = null }) {
  const regionId = byId(state.regions, sourceRegionId) ? sourceRegionId : state.player.regionId;
  const safeType = RUMOR_TYPES.includes(type) ? type : 'rumor';
  const safeScope = RUMOR_SCOPE_IDS.includes(scope) ? scope : (RUMOR_TYPE_SCOPE[safeType] || 'street');
  const meta = RUMOR_SCOPES[safeScope];
  const rumor = {
    id: `rumor_${state.round}_${hashString(`${content}:${state.rumors.length}`)}`,
    content: text(content, 500, '一则没有来源的消息正在传播'),
    type: safeType,
    scope: safeScope,
    reach: integer(reach, meta.maxLocations, 1, 12),
    decayCarry: 0,
    truth: text(truth, 500),
    sourceRegionId: regionId,
    intensity: integer(intensity, 2, 1, 4),
    locations: [{ regionId, strength: integer(intensity, 2, 1, 4), arrivedRound: state.round }],
    createdRound: state.round,
    lastSpreadRound: state.round,
    lastScopeChangeRound: 0,
    active: true,
    pinned: false,
    retention: 8,
  };
  state.rumors.push(rumor);
  state.rumors = state.rumors.slice(-100);
  return rumor;
}

function sanitizeNpcIntent(state, npc, intent, fallback) {
  const source = intent && typeof intent === 'object' ? intent : fallback;
  return {
    npcId: npc.id,
    action: NPC_ACTIONS.includes(source?.action) ? source.action : 'pursue_goal',
    targetId: text(source?.targetId, 100),
    regionId: text(source?.regionId, 100),
    goal: text(source?.goal, 240, npc.goals[0]?.description || '改善自身处境'),
    summary: text(source?.summary, 400, '处理自己的事务'),
    secret: source?.secret === true,
  };
}

function advanceWeather(state, check) {
  const severe = ['风暴', '暴雨', '寒潮', '浓雾'];
  for (const region of state.regions) {
    region.weather.remaining -= 1;
    if (region.weather.remaining > 0) continue;
    const previous = region.weather.type;
    const roll = check({ actorId: region.id, regionId: region.id, action: 'weather', difficulty: 12, reason: `${region.name}天气变化` });
    let type = '晴朗';
    let intensity = 0;
    if (roll.roll <= 3 || roll.outcome === 'critical_failure') {
      type = severe[(roll.roll + region.name.length) % severe.length];
      intensity = roll.roll === 1 ? 3 : 2;
    } else if (roll.roll <= 8) {
      type = ['降雨', '浓雾', '寒潮', '大风'][(roll.roll + region.name.length) % 4];
      intensity = 1;
    } else if (roll.roll <= 14) type = '多云';
    else if (roll.roll <= 17) type = '微风';
    region.weather = { type, intensity, remaining: 2 + roll.roll % 3 };
    if (type !== previous || intensity >= 2) {
      addLog(state, { type: 'weather', title: `${region.name}转为${type}`, detail: intensity >= 2 ? `天气开始明显影响交通、生产与物价，影响等级 ${intensity}/3。` : '当地天气趋于平稳。', regionId: region.id, diceRollId: roll.id });
    }
  }
}

function addLedger(state, amount, reason, regionId) {
  state.player.wealth = integer(state.player.wealth + amount, 0, 0, 1000000000);
  if (amount >= 0) state.player.income = integer(state.player.income + amount, 0, 0, 1000000000);
  else state.player.expenses = integer(state.player.expenses - amount, 0, 0, 1000000000);
  state.economy.ledger.push({ id: `ledger_${state.round}_${state.economy.ledger.length}`, round: state.round, amount, reason: text(reason, 240, '日常结算'), regionId: regionId || state.player.regionId, balance: state.player.wealth });
  state.economy.ledger = state.economy.ledger.slice(-60);
}

function settlePlayerImpact(state, proposal, check) {
  const impact = proposal.playerImpactProposal || {};
  if (state.regions.some((region) => region.id === impact.regionId)) state.player.regionId = impact.regionId;
  const region = byId(state.regions, state.player.regionId) || state.regions[0];
  state.player.regionId = region.id;
  const action = ['trade', 'aid', 'scheme', 'investigate', 'travel', 'rest'].includes(impact.action) ? impact.action : 'none';
  const faction = byId(state.factions, impact.factionId) || byId(state.factions, region.controlFactionId);
  const upkeep = Math.max(1, Math.round(region.priceIndex / 100 + region.weather.intensity));
  if (state.round % 3 === 0 || action !== 'none') addLedger(state, -upkeep, '旅途与日常补给', region.id);
  if (action === 'none') return;
  const reputation = Object.values(state.player.reputation).reduce((sum, value) => sum + value, 0) / 4;
  const modifier = Math.round(reputation / 35 + (faction?.playerRelation || 0) / 45);
  const difficulty = 9 + Math.ceil(region.danger / 4) + region.weather.intensity;
  const roll = check({ actorId: 'player', regionId: region.id, action: `player_${action}`, modifier, difficulty, reason: text(impact.summary, 300, `玩家${ACTION_LABELS[action] || action}`) });
  const success = isSuccess(roll.outcome);
  const criticalSuccess = roll.outcome === 'critical_success';
  const criticalFailure = roll.outcome === 'critical_failure';
  const amount = integer(impact.amount, 8, 1, 30);
  let delta = 0;
  const changeReputation = (key, value) => { state.player.reputation[key] = integer(state.player.reputation[key] + value, 0, -100, 100); };
  if (action === 'trade') {
    delta = success ? amount + (criticalSuccess ? amount : 0) : -Math.min(state.player.wealth, Math.ceil(amount / 2));
    changeReputation('circuit', success ? 2 : -1);
    if (success) region.prosperity = integer(region.prosperity + 1, 55, 0, 100);
  } else if (action === 'aid') {
    changeReputation('common', success ? 4 : criticalFailure ? -2 : 0);
    if (success) changeReputation('authority', 1);
  } else if (action === 'scheme') {
    changeReputation('shadow', success ? 4 : -2);
    if (!success) changeReputation('authority', criticalFailure ? -5 : -2);
  } else if (action === 'investigate') {
    changeReputation('circuit', success ? 3 : 0);
    if (criticalFailure) changeReputation('common', -1);
  } else if (action === 'rest' && success) changeReputation('common', 1);
  if (delta) addLedger(state, delta, success ? '行动收益' : '行动损失', region.id);
  if (faction) faction.playerRelation = integer(faction.playerRelation + (success ? 3 : criticalFailure ? -6 : -2), 0, -100, 100);
  addLog(state, { type: 'player', title: `玩家行动：${ACTION_LABELS[action]}`, detail: `${text(impact.summary, 300, '本轮行动已结算')}。${success ? '行动取得进展' : '行动遭遇阻碍'}${delta ? `，资金${delta > 0 ? '+' : ''}${delta}` : ''}${faction ? `，${faction.name}态度${success ? '改善' : '转冷'}` : ''}。`, regionId: region.id, actorId: 'player', diceRollId: roll.id, public: !(action === 'scheme' && success) });
}

function nextStepToward(state, fromId, targetId) {
  if (fromId === targetId) return fromId;
  const queue = [[fromId]];
  const seen = new Set([fromId]);
  while (queue.length) {
    const path = queue.shift();
    const region = byId(state.regions, path[path.length - 1]);
    for (const edge of region?.neighbors || []) {
      if (seen.has(edge.targetId)) continue;
      const next = [...path, edge.targetId];
      if (edge.targetId === targetId) return next[1];
      seen.add(edge.targetId);
      queue.push(next);
    }
  }
  return fromId;
}

function addStoryHook(state, hook) {
  state.storyHooks.push({ id: hook.id || `hook_${state.round}_${state.storyHooks.length}`, kind: hook.kind || 'npc', actorId: hook.actorId || null, regionId: hook.regionId, title: text(hook.title, 160, '新的剧情动向'), content: text(hook.content, 600), urgency: integer(hook.urgency, 1, 1, 3), status: hook.status || 'active', createdRound: state.round, expiresRound: state.round + 3 });
  state.storyHooks = state.storyHooks.slice(-40);
}

function createTwists(state) {
  const roll = state.dice.filter((item) => item.round === state.round && ['critical_failure', 'critical_success'].includes(item.outcome) && !['weather', 'regional_incident'].includes(item.action))
    .sort((a, b) => (a.outcome === 'critical_failure' ? -1 : 1) - (b.outcome === 'critical_failure' ? -1 : 1))[0];
  if (!roll) return;
  const actor = byId(state.npcs, roll.actorId);
  const event = byId(state.events, roll.actorId);
  const subject = actor?.name || event?.name || (roll.actorId === 'player' ? '玩家的行动' : '地方局势');
  const kind = roll.outcome === 'critical_failure' ? 'complication' : 'opportunity';
  const regionId = roll.regionId || actor?.locationId || event?.regionId || state.player.regionId;
  const content = kind === 'complication'
    ? `${subject}原本的行动引发额外阻碍，相关人物需要面对代价、误解或新的时间压力；具体表现应延续当前场景因果。`
    : `${subject}出现了超出预期的机会，相关人物可能主动提出合作、透露线索或改变原定安排；玩家可以自行决定是否承接。`;
  state.twists.push({ id: `twist_${roll.id}`, round: state.round, kind, actorId: roll.actorId, regionId, content, diceRollId: roll.id });
  state.twists = state.twists.slice(-30);
  addStoryHook(state, { id: `hook_${roll.id}`, kind, actorId: roll.actorId, regionId, title: kind === 'complication' ? '意外波折' : '意外机会', content, urgency: 3, status: regionId === state.player.regionId ? 'active' : 'approaching' });
  addLog(state, { type: 'twist', title: kind === 'complication' ? '大失败引发意外波折' : '大成功打开意外机会', detail: content, regionId, actorId: roll.actorId, diceRollId: roll.id });
}

function syncStoryHooks(state) {
  for (const hook of state.storyHooks) {
    if (hook.status === 'approaching') {
      const actor = byId(state.npcs, hook.actorId);
      if (!actor || actor.locationId === state.player.regionId || hook.regionId === state.player.regionId) {
        hook.status = 'active';
        hook.regionId = state.player.regionId;
      }
    }
    if (['active', 'approaching'].includes(hook.status) && state.round > hook.expiresRound) hook.status = 'expired';
  }
}

function applyNpcIntent(state, npc, intent, check) {
  const region = byId(state.regions, npc.locationId);
  if (!region) return;
  const targetNpc = byId(state.npcs, intent.targetId);
  const targetFaction = byId(state.factions, intent.targetId) || byId(state.factions, targetNpc?.factionId);
  const ownFaction = byId(state.factions, npc.factionId);
  const plan = ensurePlan(npc, state.round, intent);
  let attribute = 'cunning';
  let modifier = Math.floor(npc.attributes.cunning / 2) + Math.floor(npc.personality.ambition / 4);
  let difficulty = 11;
  let detail = '';
  let title = `${npc.name}：${intent.summary}`;
  let publicEvent = !intent.secret;
  let targetRegion = byId(state.regions, intent.regionId);

  if (intent.action === 'travel') {
    const edge = region.neighbors.find((item) => item.targetId === intent.regionId);
    if (!targetRegion || !edge) {
      npc.lastAction = `无法直接前往${targetRegion?.name || '未知地点'}，改为处理当地事务`;
      addMemory(npc, state.round, '发现目标地点与当前位置没有直接路线。', -1);
      addLog(state, { type: 'npc', actorId: npc.id, regionId: region.id, title: `${npc.name}的旅行计划受路线限制`, detail: npc.lastAction, public: false });
      return;
    }
    attribute = 'force';
    modifier = Math.floor(npc.attributes.force / 2) + Math.floor(npc.personality.caution / 4);
    difficulty = 7 + edge.distance + Math.floor(targetRegion.danger / 3) + region.weather.intensity + targetRegion.weather.intensity;
  } else if (['aid', 'confront'].includes(intent.action)) {
    if (!targetNpc || targetNpc.locationId !== npc.locationId || !targetNpc.alive) {
      npc.lastAction = '目标不在同一区域，行动取消';
      addLog(state, { type: 'npc', actorId: npc.id, regionId: region.id, title: `${npc.name}未能接触行动目标`, detail: npc.lastAction, public: false });
      return;
    }
  }

  if (intent.action === 'trade') {
    attribute = 'influence';
    modifier = Math.floor(npc.attributes.influence / 2) + Math.floor(npc.attributes.resources / 3);
    difficulty = 9 + Math.floor(state.economy.priceIndex / 60);
  } else if (intent.action === 'aid') {
    attribute = 'empathy';
    modifier = Math.floor(npc.attributes.empathy / 2) + Math.floor(npc.personality.empathy / 3);
    difficulty = 10;
  } else if (intent.action === 'scheme') {
    attribute = 'cunning';
    modifier += Math.floor(npc.personality.caution / 4);
    difficulty = 11 + Math.floor((targetFaction?.resources.influence || targetNpc?.attributes.influence || 4) / 3);
  } else if (intent.action === 'recruit') {
    attribute = 'influence';
    modifier = Math.floor(npc.attributes.influence / 2) + Math.floor((ownFaction?.stability || 40) / 30);
    difficulty = 12;
  } else if (intent.action === 'confront') {
    attribute = 'force';
    modifier = Math.floor(npc.attributes.force / 2) + Math.floor(npc.mood.arousal / 4);
    difficulty = 9 + Math.floor(targetNpc.attributes.force / 2);
  } else if (intent.action === 'seek_player') {
    attribute = 'empathy';
    modifier = Math.floor(npc.attributes.empathy / 2) + Math.floor(npc.personality.ambition / 3);
    difficulty = 9 + (npc.locationId === state.player.regionId ? 0 : 2);
  } else if (intent.action === 'rest') {
    attribute = 'empathy';
    modifier = 2;
    difficulty = 7;
  } else if (intent.action === 'spread_rumor') {
    attribute = 'influence';
    modifier = Math.floor(npc.attributes.influence / 2) + Math.floor(npc.attributes.cunning / 3);
    difficulty = 11;
  }

  const roll = check({
    actorId: npc.id, action: intent.action, modifier, difficulty,
    reason: `${npc.name}尝试${intent.summary}`, regionId: region.id,
  });
  const success = isSuccess(roll.outcome);
  const critical = roll.outcome === 'critical_success';
  const criticalFailure = roll.outcome === 'critical_failure';
  npc.lastAction = `${intent.summary}（${roll.formula}，${roll.total}）`;

  if (intent.action === 'travel') {
    if (success) {
      npc.locationId = targetRegion.id;
      detail = `${npc.name}沿${region.name}与${targetRegion.name}之间的路线抵达目的地。`;
      addMemory(npc, state.round, `从${region.name}抵达${targetRegion.name}。`, 0);
    } else {
      npc.needs.safety = integer(npc.needs.safety - 1, 0, 0, 10);
      detail = `${npc.name}未能在本轮完成前往${targetRegion.name}的旅行。`;
    }
  } else if (intent.action === 'investigate') {
    if (success) {
      const secretOwner = state.npcs.find((other) => other.id !== npc.id && other.locationId === npc.locationId && other.secrets.length);
      const learned = secretOwner?.secrets[0] || targetNpc?.secrets[0] || `${region.name}的危险为 ${region.danger}，控制势力为${byId(state.factions, region.controlFactionId)?.name || '无'}。`;
      addMemory(npc, state.round, `调查所得：${learned}`, 1);
      detail = `${npc.name}获得了新的私人信息，但该信息尚未自动公开。`;
      if (critical && secretOwner) npc.knownRumorIds = [...new Set([...npc.knownRumorIds, ...state.rumors.filter((rumor) => rumor.sourceRegionId === region.id).map((rumor) => rumor.id)])];
    } else {
      detail = `${npc.name}的调查没有获得可靠信息。`;
      addMemory(npc, state.round, '一次调查没有取得进展。', -1);
    }
  } else if (intent.action === 'trade') {
    if (success) {
      const gain = critical ? 2 : 1;
      npc.attributes.resources = integer(npc.attributes.resources + gain, 0, 0, 10);
      npc.needs.wealth = integer(npc.needs.wealth + 2, 0, 0, 10);
      region.prosperity = integer(region.prosperity + (critical ? 3 : 1), 0, 0, 100);
      if (ownFaction) ownFaction.resources.wealth = integer(ownFaction.resources.wealth + 2, 0, 0, 100);
      detail = `${npc.name}完成交易，改善了个人资源并带动${region.name}的局部市场。`;
    } else {
      npc.needs.wealth = integer(npc.needs.wealth - 1, 0, 0, 10);
      if (criticalFailure) npc.attributes.resources = integer(npc.attributes.resources - 1, 0, 0, 10);
      detail = `${npc.name}的交易未能改善处境${criticalFailure ? '，还损失了一部分资源' : ''}。`;
    }
  } else if (intent.action === 'aid') {
    if (success) {
      changeNpcTrust(npc, targetNpc, critical ? 14 : 8);
      targetNpc.needs.safety = integer(targetNpc.needs.safety + 1, 0, 0, 10);
      npc.needs.belonging = integer(npc.needs.belonging + 2, 0, 0, 10);
      addMemory(targetNpc, state.round, `${npc.name}在需要时提供了帮助。`, 2);
      detail = `${npc.name}帮助了${targetNpc.name}，双方信任上升。`;
    } else {
      changeNpcTrust(npc, targetNpc, -2);
      detail = `${npc.name}的援助没有取得预期效果，双方略显尴尬。`;
    }
  } else if (intent.action === 'scheme') {
    if (success) {
      if (targetFaction) {
        targetFaction.stability = integer(targetFaction.stability - (critical ? 8 : 4), 0, 0, 100);
        detail = `${npc.name}的暗中谋划削弱了${targetFaction.name}的稳定性。`;
      } else if (targetNpc) {
        targetNpc.attributes.resources = integer(targetNpc.attributes.resources - 1, 0, 0, 10);
        detail = `${npc.name}的谋划使${targetNpc.name}损失了部分资源。`;
      } else {
        region.unrest = integer(region.unrest + 3, 0, 0, 100);
        detail = `${npc.name}的秘密行动加剧了${region.name}的不安定。`;
      }
      publicEvent = false;
    } else {
      publicEvent = true;
      if (targetFaction && ownFaction) changeRelation(state.factions, ownFaction.id, targetFaction.id, -8, `${npc.name}的谋划暴露`);
      if (targetNpc) {
        changeNpcTrust(npc, targetNpc, -12);
        addMemory(targetNpc, state.round, `察觉${npc.name}可能正在针对自己。`, -3);
      }
      createRumor(state, { content: `${npc.name}似乎正在暗中策划不利于他人的行动。`, sourceRegionId: region.id, intensity: 2 });
      detail = `${npc.name}的秘密谋划暴露，相关目标开始提防。`;
    }
  } else if (intent.action === 'recruit') {
    if (success && ownFaction) {
      ownFaction.resources.manpower = integer(ownFaction.resources.manpower + (critical ? 7 : 4), 0, 0, 100);
      ownFaction.resources.influence = integer(ownFaction.resources.influence + 1, 0, 0, 100);
      detail = `${npc.name}为${ownFaction.name}招募了新的支持者。`;
    } else {
      detail = `${npc.name}的招募没有获得足够响应。`;
    }
  } else if (intent.action === 'confront') {
    changeNpcTrust(npc, targetNpc, success ? -10 : -16);
    ensureNpcRelationship(targetNpc, npc.id).fear = integer(ensureNpcRelationship(targetNpc, npc.id).fear + (success ? 10 : 3), 0, 0, 100);
    updateMood(targetNpc, -2, 2);
    region.unrest = integer(region.unrest + (criticalFailure ? 5 : 2), 0, 0, 100);
    detail = success ? `${npc.name}在对峙中压制了${targetNpc.name}，双方关系恶化。` : `${npc.name}未能在对峙中压住${targetNpc.name}，冲突反而扩大。`;
  } else if (intent.action === 'spread_rumor') {
    const rumor = createRumor(state, {
      content: intent.summary,
      sourceRegionId: region.id,
      intensity: success ? (critical ? 4 : 3) : 1,
      type: 'rumor',
    });
    for (const other of state.npcs.filter((item) => item.locationId === region.id)) other.knownRumorIds.push(rumor.id);
    detail = success ? `${npc.name}让一则风声在${region.name}扩散。` : `${npc.name}传播的风声没有获得多少关注。`;
  } else if (intent.action === 'seek_player') {
    if (success) {
      const nextRegionId = nextStepToward(state, npc.locationId, state.player.regionId);
      npc.locationId = nextRegionId;
      const arrived = nextRegionId === state.player.regionId;
      addStoryHook(state, { actorId: npc.id, regionId: nextRegionId, title: `${npc.name}${arrived ? '主动找上门' : '正在寻找玩家'}`, content: `${npc.name}基于自己的目标与听闻，决定${text(intent.summary, 300, '主动联系玩家')}。${arrived ? '可在当前场景中自然发起对话、请求或警告，不替玩家决定回应。' : '目前正沿真实路线接近玩家所在地。'}`, urgency: critical ? 3 : 2, status: arrived ? 'active' : 'approaching' });
      detail = arrived ? `${npc.name}主动来到玩家所在地，准备就“${plan.goal}”发起接触。` : `${npc.name}启程寻找玩家，沿路线抵达${byId(state.regions, nextRegionId)?.name || '下一站'}。`;
    } else {
      detail = `${npc.name}试图寻找玩家，但被自己的事务或错误线索耽搁。`;
      if (criticalFailure) npc.needs.safety = integer(npc.needs.safety - 1, 0, 0, 10);
    }
  } else if (intent.action === 'rest') {
    if (success) {
      npc.needs.safety = integer(npc.needs.safety + 2, 0, 0, 10);
      npc.needs.belonging = integer(npc.needs.belonging + 1, 0, 0, 10);
      updateMood(npc, 1, -2);
      detail = `${npc.name}休整并恢复了判断力。`;
    } else detail = `${npc.name}被日常事务打断，未能充分休整。`;
  } else {
    detail = success ? `${npc.name}向“${plan.goal}”迈进了一步。` : `${npc.name}推进“${plan.goal}”时遇到阻碍。`;
  }

  if (intent.action === 'pursue_goal' || plan.actionType === intent.action) advancePlan(npc, roll.outcome, state);
  updateMood(npc, success ? 1 : -1, success ? 0 : 1);
  npc.schedule.current = intent.summary;
  npc.schedule.next = plan.stage === '已完成' || plan.stage === '已失败' ? '重新评估目标' : `继续“${plan.goal}”`;
  addMemory(npc, state.round, detail, success ? 1 : -1);
  addLog(state, {
    type: 'npc', actorId: npc.id, regionId: npc.locationId,
    title, detail, diceRollId: roll.id, public: publicEvent,
  });
}

function sanitizeRelationDelta(source) {
  if (!source || typeof source !== 'object') return null;
  const delta = {};
  let touched = false;
  for (const key of RELATION_DIMENSION_KEYS) {
    const value = Number(source[key]);
    if (!Number.isFinite(value) || value === 0) continue;
    delta[key] = Math.round(clamp(value, -30, 30));
    touched = true;
  }
  return touched ? delta : null;
}

function sanitizeFactionIntent(faction, intent, fallback) {
  const source = intent && typeof intent === 'object' ? intent : fallback;
  return {
    factionId: faction.id,
    action: FACTION_ACTIONS.includes(source?.action) ? source.action : 'consolidate',
    targetFactionId: text(source?.targetFactionId, 100),
    regionId: text(source?.regionId, 100),
    summary: text(source?.summary, 400, faction.goal),
    relationDelta: sanitizeRelationDelta(source?.relationDelta),
    clanNote: text(source?.clanNote, 200),
  };
}

function factionPowerModifier(faction) {
  const meta = tierMeta(normalizeTier(faction.tier, faction));
  return Math.floor(faction.resources.influence / 25)
    + Math.floor(integer(faction.authority, 50, 0, 100) / 40)
    + Math.floor(meta.influenceBonus / 7);
}

function describeClanReaction(report) {
  const parts = [];
  if (report.satisfied.length) parts.push(`${report.satisfied.map((clan) => clan.name).join('、')}因主张被采纳而声势上涨`);
  if (report.conflicted.length) parts.push(`${report.conflicted.map((clan) => clan.name).join('、')}指责首领偏离本派利益，当众表示不满`);
  if (!parts.length) parts.push('各派系反应平平，仍在观望首领的下一步');
  return parts.join('；');
}

function raiseInnerTensionHook(state, faction, clan) {
  const hookId = `hook_clan_${faction.id}_${clan.id}`;
  if (state.storyHooks.some((hook) => hook.id === hookId && ['active', 'approaching'].includes(hook.status))) return;
  const region = byId(state.regions, faction.homeRegionId) || state.regions[0];
  const demand = clanDemandOf(clan);
  addStoryHook(state, {
    id: hookId,
    kind: 'complication',
    regionId: region.id,
    title: `${faction.name}：${clan.name}离心`,
    content: `${faction.name}内部的${clan.name}（${demand.summary}）长期未获满足，正在私下串联，要求首领在下一轮给出交代。若继续被忽视，这一派可能带人出走、另寻靠山，或在关键时刻掣肘。`,
    urgency: 2,
    status: region.id === state.player.regionId ? 'active' : 'approaching',
  });
}

/** 首领行动结算之后，处理内部派系的强弱、满意度与叙事反馈。 */
function settleFactionAftermath(state, faction, action, outcome, home) {
  const report = settleClans(faction, action, outcome);
  if (report.satisfied.length) faction.resources.manpower = integer(faction.resources.manpower + 1, 0, 0, 100);
  if (report.conflicted.length >= 2) faction.resources.influence = integer(faction.resources.influence - 2, 0, 0, 100);
  refreshFactionDerived(faction);
  addLog(state, {
    type: 'faction',
    regionId: home?.id,
    title: `${faction.name}内部：${report.conflicted.length ? '派系反弹' : report.satisfied.length ? '派系归心' : '派系观望'}`,
    detail: `${describeClanReaction(report)}。稳定度 ${faction.stability}，首领权威 ${faction.authority}，内部张力 ${faction.tension}。`,
    public: false,
  });
  if (faction.tension >= 62) {
    const clan = unhappiestClan(faction);
    if (clan) raiseInnerTensionHook(state, faction, clan);
  }
}

function applyFactionIntent(state, faction, intent, check) {
  const target = byId(state.factions, intent.targetFactionId);
  const controlled = state.regions.filter((region) => region.controlFactionId === faction.id);
  const home = byId(state.regions, faction.homeRegionId) || controlled[0] || state.regions[0];
  let difficulty = 11;
  let modifier = factionPowerModifier(faction);
  if (intent.action === 'expand') {
    const targetRegion = byId(state.regions, intent.regionId);
    const connected = controlled.some((region) => region.neighbors.some((edge) => edge.targetId === intent.regionId));
    if (!targetRegion || targetRegion.controlFactionId === faction.id || !connected) {
      addLog(state, { type: 'faction', regionId: home.id, title: `${faction.name}的扩张意图不符合地图条件`, detail: '目标地区不存在、已被控制，或不与现有控制区相邻。', public: false });
      return;
    }
    modifier += Math.floor(faction.resources.manpower / 30);
    difficulty = 11 + Math.floor(targetRegion.danger / 3);
    const roll = check({ actorId: faction.id, action: 'expand', modifier, difficulty, reason: `${faction.name}试图控制${targetRegion.name}` });
    const outcome = { success: isSuccess(roll.outcome), critical: roll.outcome === 'critical_success' };
    if (outcome.success) {
      const former = byId(state.factions, targetRegion.controlFactionId);
      targetRegion.controlFactionId = faction.id;
      targetRegion.unrest = integer(targetRegion.unrest + 8, 0, 0, 100);
      faction.resources.influence = integer(faction.resources.influence + 4, 0, 0, 100);
      if (former) {
        former.resources.influence = integer(former.resources.influence - 5, 0, 0, 100);
        former.authority = integer(former.authority - 3, 0, 0, 100);
        changeRelation(state.factions, faction.id, former.id, -15, `争夺${targetRegion.name}控制权`, { hostility: 12, fear: 5, trust: -4 });
      }
      addLog(state, { type: 'faction', regionId: targetRegion.id, title: `${targetRegion.name}的控制权易主`, detail: `${faction.name}取得控制权${former ? `，原控制者${former.name}的影响力下降` : ''}。`, diceRollId: roll.id });
    } else {
      faction.resources.manpower = integer(faction.resources.manpower - 3, 0, 0, 100);
      targetRegion.unrest = integer(targetRegion.unrest + 4, 0, 0, 100);
      addLog(state, { type: 'faction', regionId: targetRegion.id, title: `${faction.name}在${targetRegion.name}扩张受挫`, detail: '行动未能改变控制权，并造成一定人力损耗。', diceRollId: roll.id });
    }
    settleFactionAftermath(state, faction, 'expand', outcome, home);
    return;
  }

  const roll = check({ actorId: faction.id, action: intent.action, modifier, difficulty, reason: intent.summary });
  const success = isSuccess(roll.outcome);
  const critical = roll.outcome === 'critical_success';
  const explicitDelta = intent.relationDelta || null;
  let title = `${faction.name}：${intent.summary}`;
  let detail = '';
  if (intent.action === 'trade' && target) {
    if (success) {
      faction.resources.wealth = integer(faction.resources.wealth + 5, 0, 0, 100);
      target.resources.wealth = integer(target.resources.wealth + 4, 0, 0, 100);
      changeRelation(state.factions, faction.id, target.id, 6, '互利贸易', explicitDelta || { interest: 12, trust: 4 });
      detail = `${faction.name}与${target.name}完成贸易，双方财富与关系改善。`;
    } else {
      changeRelation(state.factions, faction.id, target.id, -2, '贸易分歧', explicitDelta || { trust: -4, hostility: 2 });
      detail = '贸易谈判没有达成协议，双方对条件存有分歧。';
    }
  } else if (intent.action === 'improve_relations' && target) {
    if (success) {
      changeRelation(state.factions, faction.id, target.id, 10, '主动外交与利益交换', explicitDelta || { trust: 7, hostility: -6, culture: 3 });
    } else {
      changeRelation(state.factions, faction.id, target.id, -3, '外交接触失败', explicitDelta || { trust: -5, hostility: 3 });
    }
    detail = success
      ? `${faction.name}与${target.name}的关系转为${relationLabel(faction.relations[target.id]?.value ?? 0)}。`
      : `${faction.name}的外交接触引起${target.name}疑虑。`;
  } else if (intent.action === 'pressure' && target) {
    if (success) {
      target.authority = integer(target.authority - 4, 0, 0, 100);
      refreshFactionDerived(target);
      faction.resources.influence = integer(faction.resources.influence + 2, 0, 0, 100);
    }
    changeRelation(state.factions, faction.id, target.id, -9, `${faction.name}施加压力`, explicitDelta || { hostility: 11, fear: 9, trust: -6 });
    detail = success ? `${target.name}在压力下稳定度与首领威望同时受损。` : `${target.name}顶住压力，但双方关系继续恶化。`;
  } else {
    if (success) {
      faction.resources.manpower = integer(faction.resources.manpower + 2, 0, 0, 100);
      home.unrest = integer(home.unrest - 3, 0, 0, 100);
      detail = `${faction.name}整肃内部，重新压住各派的争执，${home.name}的基本盘得到巩固。`;
    } else {
      home.unrest = integer(home.unrest + 1, 0, 0, 100);
      detail = `${faction.name}的内部整顿遇到阻力，各派互相推诿。`;
    }
  }
  if (intent.clanNote) detail = `${detail}（${intent.clanNote}）`;
  addLog(state, { type: 'faction', regionId: home.id, title, detail, diceRollId: roll.id });
  settleFactionAftermath(state, faction, intent.action, { success, critical }, home);
}

/** 势力分层：附庸抽成、庇护与层级跃迁。 */
function settleFactionHierarchy(state) {
  const map = new Map(state.factions.map((faction) => [faction.id, faction]));
  for (const faction of state.factions) {
    const overlord = map.get(faction.overlordId);
    if (!overlord) {
      faction.overlordId = '';
      continue;
    }
    overlord.resources.influence = integer(overlord.resources.influence + 1, 0, 0, 100);
    overlord.resources.wealth = integer(overlord.resources.wealth + 1, 0, 0, 100);
    faction.authority = integer(faction.authority + 1, 0, 0, 100);
    const relation = faction.relations[overlord.id];
    if (relation?.dimensions && relation.dimensions.fear < 45) relation.dimensions.fear = integer(relation.dimensions.fear + 3, 45, 0, 100);
  }
  for (const faction of state.factions) {
    const changed = nextFactionTier(faction);
    if (!changed) continue;
    const before = tierMeta(normalizeTier(faction.tier, faction));
    const upgrade = changed.rank > before.rank;
    faction.tier = changed.id;
    faction.authority = clamp(integer(faction.authority, 50, 0, 100) + (upgrade ? 4 : -5), 0, 100);
    addLog(state, {
      type: 'faction',
      regionId: faction.homeRegionId,
      title: `${faction.name}${upgrade ? '升为' : '降为'}${changed.label}`,
      detail: `资源规模的变化让${faction.name}在势力分层中移动了一级，周边势力的态度与要价都会随之调整。`,
    });
  }
}

function applyExistingEvent(state, event, check) {
  if (event.status !== 'active') return;
  const previousStage = event.stage;
  const region = byId(state.regions, event.regionId) || state.regions[0];
  const actors = event.actorIds.map((id) => byId(state.npcs, id)).filter(Boolean);
  const factions = event.factionIds.map((id) => byId(state.factions, id)).filter(Boolean);
  const modifier = Math.floor(average(actors.map((npc) => npc.attributes.cunning), 3) / 2)
    + Math.floor(average(factions.map((faction) => faction.stability), 50) / 35)
    - Math.floor(region.danger / 4);
  const difficulty = 10 + event.level;
  const roll = check({ actorId: event.id, action: 'event_progress', regionId: region.id, modifier, difficulty: difficulty + region.weather.intensity, reason: `${event.name}进入阶段判定` });
  const delta = progressFromOutcome(roll.outcome);
  event.progress = Math.max(0, event.progress + delta);
  event.stalls = delta > 0 ? 0 : event.stalls + (delta < 0 ? 2 : 1);
  event.lastRound = state.round;
  if (event.progress >= event.requiredProgress) event.status = 'completed';
  if (event.stalls >= 3) event.status = 'failed';
  if (['completed', 'failed'].includes(event.status) && !event.resolvedRound) event.resolvedRound = state.round;
  event.stage = stageFor(event);
  event.history.push(`第${state.round}轮：${roll.formula}=${roll.total}，${event.stage}`);
  event.history = event.history.slice(-30);
  if (event.status === 'completed') {
    if (event.type === 'conflict') {
      region.unrest = integer(region.unrest + 12 + event.level * 2, 0, 0, 100);
      region.prosperity = integer(region.prosperity - event.level * 3, 0, 0, 100);
    } else {
      region.prosperity = integer(region.prosperity + 6 + event.level, 0, 0, 100);
      region.unrest = integer(region.unrest - 5, 0, 0, 100);
    }
  }
  if (event.status === 'failed' && event.type === 'conflict') region.unrest = integer(region.unrest - 3, 0, 0, 100);
  if (previousStage !== event.stage || delta !== 0) {
    addLog(state, {
      type: 'event', regionId: region.id,
      title: `${event.name}：${event.stage}`,
      detail: `${roll.formula}，判定 ${roll.total}。${delta > 0 ? '事件取得实质进展。' : delta < 0 ? '事件出现倒退。' : '事件暂时停滞。'}`,
      diceRollId: roll.id,
    });
  }
}

function proposeEvents(state, proposals, check) {
  for (const proposal of asArray(proposals).slice(0, 2)) {
    const region = byId(state.regions, proposal?.regionId) || [...state.regions].sort((a, b) => b.unrest - a.unrest)[0];
    const name = text(proposal?.name, 160, `${region.name}的突发变故`);
    const roll = check({ actorId: 'world', action: 'event_emergence', modifier: Math.floor(region.unrest / 30), difficulty: 11, reason: `${name}是否形成持续事件` });
    if (!isSuccess(roll.outcome)) {
      addLog(state, { type: 'event', regionId: region.id, title: `${name}的苗头暂时消散`, detail: '形成事件的判定未通过，本轮只留下轻微迹象。', diceRollId: roll.id, public: false });
      continue;
    }
    const type = proposal?.type === 'progress' ? 'progress' : 'conflict';
    const event = {
      id: `event_${state.round}_${hashString(`${name}:${state.events.length}`)}`,
      name,
      description: text(proposal?.description, 600, '多种因素汇合为新的持续事件。'),
      type,
      level: integer(proposal?.level, 2, 1, 4),
      stage: EVENT_STAGES[type][0],
      status: 'active',
      progress: 0,
      requiredProgress: integer(proposal?.requiredProgress, 4 + integer(proposal?.level, 2, 1, 4) * 2, 2, 30),
      stalls: 0,
      regionId: region.id,
      actorIds: asArray(proposal?.actorIds).filter((id) => byId(state.npcs, id)),
      factionIds: asArray(proposal?.factionIds).filter((id) => byId(state.factions, id)),
      createdRound: state.round,
      lastRound: state.round,
      history: [`第${state.round}轮形成，${roll.formula}=${roll.total}`],
    };
    state.events.push(event);
    state.events = state.events.slice(-80);
    addLog(state, { type: 'event', regionId: region.id, title: `新事件：${name}`, detail: event.description, diceRollId: roll.id });
  }
}

function spreadRumors(state, check, rng) {
  for (const rumor of state.rumors.filter((item) => item.active)) {
    const scope = RUMOR_SCOPES[rumor.scope] || RUMOR_SCOPES.street;
    const reach = clamp(integer(rumor.reach, scope.maxLocations, 1, 12), 1, 12);
    const roll = check({
      actorId: rumor.id,
      action: 'rumor_spread',
      modifier: rumor.intensity - 2 + scope.spread,
      difficulty: 12,
      reason: `${scope.label}沿地图传播判定`,
    });
    let spread = false;
    if (isSuccess(roll.outcome) && rumor.locations.length < reach) {
      const origins = [...rumor.locations];
      for (const origin of origins) {
        if (rumor.locations.length >= reach) break;
        const region = byId(state.regions, origin.regionId);
        const candidates = region?.weather.intensity >= 3
          ? []
          : (region?.neighbors || []).filter((edge) => !rumor.locations.some((location) => location.regionId === edge.targetId));
        if (!candidates.length || origin.strength <= 0) continue;
        const edge = rng.pick(candidates);
        rumor.locations.push({ regionId: edge.targetId, strength: Math.max(1, origin.strength - 1), arrivedRound: state.round });
        spread = true;
      }
    }
    if (spread) {
      rumor.lastSpreadRound = state.round;
      const arrived = rumor.locations.filter((location) => location.arrivedRound === state.round).map((location) => byId(state.regions, location.regionId)?.name).filter(Boolean);
      addLog(state, { type: 'rumor', title: `${scope.label}传到新的地区`, detail: `“${rumor.content}”传至${arrived.join('、')}。`, diceRollId: roll.id });
    }
    // 层级决定衰减速度：官方通告几乎不掉强度，密闻一次就凉
    if (!rumor.pinned && state.round % 2 === 0) {
      rumor.decayCarry = Math.min(4, (Number(rumor.decayCarry) || 0) + scope.decay);
      const steps = Math.floor(rumor.decayCarry);
      if (steps > 0) {
        rumor.decayCarry -= steps;
        for (const location of rumor.locations) {
          if (state.round - location.arrivedRound > 0) location.strength = Math.max(0, location.strength - steps);
        }
      }
    }
    // 知晓范围可变：小道消息传得够广，就会被转述成区域消息（甚至被官方接管口径）
    if (rumor.scope === 'street' && rumor.locations.filter((location) => location.strength > 0).length >= 5 && rumor.intensity >= 3) {
      rumor.scope = 'regional';
      rumor.reach = Math.max(rumor.reach, RUMOR_SCOPES.regional.maxLocations);
      rumor.lastScopeChangeRound = state.round;
      addLog(state, { type: 'rumor', title: '小道消息传成了公论', detail: `“${rumor.content}”已经传遍数地，开始被当作区域内的既成说法。` });
    }
    for (const npc of state.npcs) {
      if (rumor.locations.some((location) => location.regionId === npc.locationId && location.strength > 0) && !npc.knownRumorIds.includes(rumor.id)) npc.knownRumorIds.push(rumor.id);
    }
    if (!rumor.locations.some((location) => location.strength > 0)) rumor.active = false;
  }
  state.rumors = state.rumors.filter((rumor) => rumor.pinned || rumor.active || state.round - rumor.createdRound <= rumor.retention).slice(-100);
}

function settleEconomy(state, proposal, check) {
  const prosperity = average(state.regions.map((region) => region.prosperity), 50);
  const unrest = average(state.regions.map((region) => region.unrest), 20);
  const roll = check({ actorId: 'world', action: 'economy', modifier: Math.floor(prosperity / 30) - Math.floor(unrest / 35), difficulty: 10, reason: '整体经济气候变化' });
  const success = isSuccess(roll.outcome);
  for (const region of state.regions) {
    const localDelta = (success ? -1 : 2) + region.weather.intensity * 2 + Math.floor(region.unrest / 35) - Math.floor(region.prosperity / 45);
    region.priceIndex = integer(region.priceIndex + localDelta, 100, 30, 400);
  }
  state.economy.priceIndex = integer(Math.round(average(state.regions.map((region) => region.priceIndex), 100)) + (success ? -1 : 1), 100, 20, 400);
  state.economy.climate = unrest >= 65 ? '动荡' : prosperity >= 72 && state.economy.priceIndex < 140 ? '繁荣' : prosperity < 40 || state.economy.priceIndex > 155 ? '衰退' : '平稳';
  state.economy.lastSignal = text(proposal.economicSignal, 500) || (success ? '交易与生产保持稳定，部分价格压力缓解。' : '需求与供应出现波动，市场参与者转向谨慎。');
  addLog(state, { type: 'economy', title: `经济气候：${state.economy.climate}`, detail: `${state.economy.lastSignal} 价格指数 ${state.economy.priceIndex}。`, diceRollId: roll.id });
}

function settleBackground(state, proposal, check) {
  let totalPopulation = 0;
  let activeRegions = 0;
  for (const region of state.regions) {
    const roll = check({ actorId: region.id, regionId: region.id, action: 'background', modifier: Math.floor(region.prosperity / 30) - Math.floor(region.unrest / 30) - region.weather.intensity, difficulty: 10, reason: `${region.name}背景人群结算` });
    const success = isSuccess(roll.outcome);
    const populationChange = success ? 1.01 + (roll.outcome === 'critical_success' ? 0.01 : 0) : 0.995 - (roll.outcome === 'critical_failure' ? 0.01 : 0);
    region.population = Math.max(0, Math.round(region.population * populationChange));
    region.prosperity = integer(region.prosperity + (success ? 1 : -1) - (region.weather.intensity >= 2 ? 1 : 0), 0, 0, 100);
    region.unrest = integer(region.unrest + (success ? -1 : 1), 0, 0, 100);
    totalPopulation += region.population;
    if (success) activeRegions += 1;
    if (roll.outcome === 'critical_failure') {
      addLog(state, { type: 'region', regionId: region.id, title: `${region.name}民生承压`, detail: '背景人群的生产与生活受到明显冲击，人口与繁荣下降。', diceRollId: roll.id });
    }
  }
  state.background.simulatedPeople = totalPopulation;
  state.background.lastSettlement = text(proposal.backgroundSignal, 700) || `${activeRegions}/${state.regions.length} 个地区的背景生活总体稳定，其余地区出现不同程度压力。`;
}

/**
 * 后台 API 依据角色卡与当前局势提出的派系：本地只做规则校验后并入。
 * 关闭 aiClans 时完全忽略提案，保留插件自己按层级生成的派系。
 */
function applyClanProposals(state, proposals, options) {
  if (options?.aiClans === false) return [];
  const created = [];
  for (const proposal of asArray(proposals).slice(0, 8)) {
    const faction = byId(state.factions, proposal?.factionId);
    if (!faction) continue;
    const clans = asArray(proposal?.clans);
    if (!clans.length) continue;
    const result = mergeProposedClans(faction, clans, state.round);
    if (result.added.length) {
      refreshFactionDerived(faction);
      const names = result.added.map((clan) => describeClan(clan)).join('、');
      addLog(state, {
        type: 'faction',
        regionId: faction.homeRegionId,
        title: `${faction.name}内部浮现新的派系`,
        detail: `${names}${proposal.reason ? `。起因：${text(proposal.reason, 200)}` : ''}`,
      });
      for (const clan of result.added) created.push({ factionId: faction.id, clanId: clan.id, name: clan.name, demand: clan.demand });
    }
    if (result.updated.length) {
      const changed = result.updated.filter((clan) => clan.createdRound === state.round).length;
      if (changed) refreshFactionDerived(faction);
    }
  }
  return created;
}

/** 自定义节日文本：一行一个「名称|月-日|描述」，也接受「名称|3月15日|描述」。 */
export function parseCustomFestivals(raw) {
  const list = [];
  for (const line of String(raw || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split('|').map((part) => part.trim());
    const name = parts[0];
    if (!name) continue;
    // 与面板的显示保持一致：3-15 / 3/15 / 3.15 / 3月15 / 3月15日 都认。
    const match = /^(\d{1,2})\s*[-\/月.]\s*(\d{1,2})\s*日?$/.exec(parts[1] || '');
    if (!match) continue;
    const month = Number(match[1]);
    const day = Number(match[2]);
    // 越界日期直接跳过，避免把 13 月静默夹成 12 月、把 31 日夹成 30 日。
    if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 30)) continue;
    list.push({
      id: `fest_custom_${hashString(`${name}:${month}:${day}`)}`,
      name: text(name, 60),
      month,
      day,
      description: text(parts.slice(2).join('|'), 300),
      origin: 'custom',
      active: true,
    });
  }
  return list;
}

/** 合并内置节日、世界书生成的节日与自定义节日（按名称去重，后者覆盖前者）。 */
export function resolveFestivals(state, options = {}) {
  const map = new Map();
  const push = (festival) => {
    if (!festival?.name) return;
    map.set(text(festival.name, 60), {
      id: text(festival.id, 100) || `fest_${hashString(festival.name)}`,
      name: text(festival.name, 60),
      month: integer(festival.month, 1, 1, 12),
      day: integer(festival.day, 1, 1, 30),
      description: text(festival.description, 300),
      origin: ['local', 'worldbook', 'custom'].includes(festival.origin) ? festival.origin : 'local',
      active: festival.active !== false,
    });
  };
  for (const festival of DEFAULT_FESTIVALS) push(festival);
  for (const festival of asArray(state.festivals)) push(festival);
  for (const festival of parseCustomFestivals(options.customFestivals)) push(festival);
  return [...map.values()].filter((festival) => festival.active);
}

/** 日期命中节日时结算：节庆会短暂改变物价、民生与人物情绪。 */
function settleFestivals(state, options) {
  if (options?.festivals === false) return [];
  const triggered = [];
  for (const festival of resolveFestivals(state, options)) {
    if (festival.month !== state.calendar.month || festival.day !== state.calendar.day) continue;
    for (const region of state.regions) {
      region.prosperity = integer(region.prosperity + 2, region.prosperity, 0, 100);
      region.unrest = integer(region.unrest - 3, region.unrest, 0, 100);
      region.priceIndex = integer(region.priceIndex + 3, region.priceIndex, 30, 400);
    }
    for (const npc of state.npcs) {
      if (!npc.core || !npc.alive) continue;
      updateMood(npc, 1, 1);
    }
    addLog(state, {
      type: 'festival',
      title: `节令：${festival.name}`,
      detail: `${festival.description || '按旧例举行'}。市面热闹，物价短暂上扬，乡里的怨气也暂时压下去一些。`,
    });
    triggered.push({ name: festival.name, origin: festival.origin });
  }
  return triggered;
}

function pickDailyActivity(npc, round) {
  const role = `${npc.role || ''}${npc.name || ''}`;
  const matched = DAILY_ACTIVITIES.filter((activity) => activity.keywords.some((keyword) => role.includes(keyword)));
  const pool = matched.length ? matched : DAILY_ACTIVITIES;
  return pool[hashString(`${npc.id}:${round}`).length % pool.length] || pool[0];
}

/**
 * 日常生活：不掷骰、不改变大格局，只给人物的这一轮留下生活痕迹。
 * 这是正文最需要的质感，也是"人物在过自己的日子"的证据。
 */
function settleDailyLife(state, rng, options) {
  if (options?.dailyLife === false) return [];
  const actors = clamp(integer(options?.dailyActors, 2, 0, 4), 0, 4);
  if (!actors) return [];
  const living = state.npcs.filter((npc) => npc.alive && npc.core);
  if (!living.length) return [];
  const local = living.filter((npc) => npc.locationId === state.player.regionId);
  const pool = local.length >= actors ? local : [...local, ...living.filter((npc) => !local.includes(npc))];
  const picked = [];
  const candidates = [...pool];
  while (picked.length < actors && candidates.length) {
    const index = rng.int(0, candidates.length - 1);
    picked.push(candidates.splice(index, 1)[0]);
  }
  const logs = [];
  for (const npc of picked) {
    const activity = pickDailyActivity(npc, state.round);
    npc.routine = activity.text;
    npc.schedule.current = activity.text;
    if (activity.mood) updateMood(npc, activity.mood, 0);
    addLog(state, {
      type: 'daily',
      regionId: npc.locationId,
      actorId: npc.id,
      title: `${npc.name}的一天`,
      detail: `${activity.text}。`,
    });
    logs.push({ npcId: npc.id, text: activity.text });
  }
  return logs;
}

export function evolveWorld(previousState, proposal = {}, options = {}) {
  const state = deepClone(previousState);
  state.round += 1;
  state.pendingTurns = 0;
  state.calendar.day += 1;
  if (state.calendar.day > 30) {
    state.calendar.day = 1;
    state.calendar.month += 1;
    if (state.calendar.month > 12) {
      state.calendar.month = 1;
      state.calendar.year += 1;
    }
  }
  state.calendar.turnLabel = `第 ${state.round} 轮 · ${state.calendar.year}年${state.calendar.month}月${state.calendar.day}日`;
  // 重 roll：同一轮用同一个种子会掷出一模一样的结果，所以重掷时把序数拌进种子里。
  const reroll = Math.max(0, Math.trunc(Number(options.reroll) || 0));
  const rng = new SeededRandom(reroll > 0 ? `${state.seed}:round:${state.round}:reroll:${reroll}` : `${state.seed}:round:${state.round}`);
  let sequence = 0;
  const globalModifier = integer(options.diceModifier, 0, -10, 10);
  const check = (input) => {
    const baseModifier = integer(input.modifier, 0, -20, 20);
    const roll = rollCheck(rng, { ...input, modifier: baseModifier + globalModifier, round: state.round, sequence: sequence += 1 });
    roll.baseModifier = baseModifier;
    roll.globalModifier = globalModifier;
    state.dice.push(roll);
    return roll;
  };
  advanceWeather(state, check);
  const safeProposal = proposal && typeof proposal === 'object' ? proposal : {};
  settlePlayerImpact(state, safeProposal, check);
  const fallback = heuristicProposal(state);
  const providedNpcIntents = asArray(safeProposal.npcIntents);
  const coreNpcs = state.npcs.filter((npc) => npc.core && npc.alive);
  for (const [index, npc] of coreNpcs.entries()) {
    const proposed = providedNpcIntents.find((intent) => intent?.npcId === npc.id);
    let backup = fallback.npcIntents.find((intent) => intent?.npcId === npc.id);
    if (!proposed && npc.locationId === state.player.regionId && (state.round + index) % 5 === 0 && npc.personality.ambition >= 6) {
      backup = { npcId: npc.id, action: 'seek_player', goal: npc.goals[0]?.description, summary: `就“${npc.goals[0]?.description || '自己的处境'}”主动接触玩家`, secret: false };
    }
    applyNpcIntent(state, npc, sanitizeNpcIntent(state, npc, proposed, backup), check);
  }
  const providedFactionIntents = asArray(safeProposal.factionIntents);
  for (const faction of state.factions) {
    const proposed = providedFactionIntents.find((intent) => intent?.factionId === faction.id);
    const backup = fallback.factionIntents.find((intent) => intent?.factionId === faction.id);
    applyFactionIntent(state, faction, sanitizeFactionIntent(faction, proposed, backup), check);
  }
  settleFactionHierarchy(state);
  // API 依据角色卡与当前局势提出的派系，在这里并入（本地只做规则校验）
  const createdClans = applyClanProposals(state, safeProposal.factionClans, options);
  for (const event of state.events) applyExistingEvent(state, event, check);
  proposeEvents(state, safeProposal.eventProposals, check);
  const incidentRoll = check({ actorId: 'world', action: 'regional_incident', modifier: 0, difficulty: 19, reason: '本轮是否出现额外区域变故' });
  if (incidentRoll.roll >= 19) {
    const region = [...state.regions].sort((a, b) => b.unrest - a.unrest)[0];
    proposeEvents(state, [{ name: `${region.name}的突发变故`, description: '长期积累的风险在偶然因素触发下迅速显现。', type: 'conflict', level: 3, regionId: region.id }], check);
  }
  for (const rumor of asArray(safeProposal.rumorProposals).slice(0, 2)) {
    const roll = check({ actorId: 'world', action: 'rumor_origin', modifier: integer(rumor?.intensity, 2, 1, 4) - 2, difficulty: 9, reason: '新风声是否获得关注' });
    if (isSuccess(roll.outcome)) createRumor(state, rumor);
  }
  spreadRumors(state, check, rng);
  settleEconomy(state, safeProposal, check);
  settleBackground(state, safeProposal, check);
  const festivals = settleFestivals(state, options);
  const dailyLife = settleDailyLife(state, rng, options);
  for (const event of state.events) {
    if (!event.pinned && ['completed', 'failed'].includes(event.status) && state.round - event.resolvedRound >= event.retention) event.status = 'archived';
  }
  createTwists(state);
  syncStoryHooks(state);
  for (const faction of state.factions) refreshFactionDerived(faction);
  for (const npc of state.npcs) npc.knownRumorIds = [...new Set(npc.knownRumorIds)].slice(-100);
  state.dice = state.dice.slice(-300);
  // 成功推演计数：重 roll 会回退轮次但不会回退这个计数，分级压缩以它为准
  state.evolutionCount = integer(state.evolutionCount, 0, 0) + 1;
  const compressed = maybeCompress(state, options);
  // 世界脉搏写的是世界本身：全境盛衰、谁在抬头、哪里在烧、哪些事还在推进。
  // 不要复述某个角色做了什么——那会把宏观摘要写成一则人物流水账。
  const regionCount = Math.max(1, state.regions.length);
  const avgProsperity = Math.round(state.regions.reduce((sum, region) => sum + region.prosperity, 0) / regionCount);
  const avgUnrest = Math.round(state.regions.reduce((sum, region) => sum + region.unrest, 0) / regionCount);
  const buoyant = [...state.regions].sort((a, b) => b.prosperity - a.prosperity)[0];
  const restless = [...state.regions].sort((a, b) => b.unrest - a.unrest)[0];
  const ascendant = [...state.factions].sort((a, b) => (b.resources.influence + b.authority) - (a.resources.influence + a.authority))[0];
  const fraying = [...state.factions].sort((a, b) => (b.tension || 0) - (a.tension || 0))[0];
  const pendingEvents = state.events.filter((event) => event.status === 'active');
  const pulseParts = [
    `第 ${state.round} 轮，全境平均繁荣 ${avgProsperity}、动荡 ${avgUnrest}`,
    buoyant ? `景气最盛的是${buoyant.name}（繁荣 ${buoyant.prosperity}）` : '',
    restless && restless.unrest >= 35 ? `最不安的是${restless.name}（动荡 ${restless.unrest}）` : '',
    ascendant ? `${ascendant.name}声势领先（影响 ${ascendant.resources.influence}、权威 ${Math.round(ascendant.authority)}）` : '',
    fraying && (fraying.tension || 0) >= 45 ? `${fraying.name}内部离心最重（张力 ${Math.round(fraying.tension)}）` : '',
    pendingEvents.length
      ? `${pendingEvents.length} 件事仍在推进：${pendingEvents.slice(0, 2).map((event) => event.name).join('、')}`
      : '暂时没有公开事件在推进',
  ].filter(Boolean);
  state.worldDigest = `${pulseParts.join('；')}。`;
  state.lastEvolution = {
    round: state.round,
    evolutionCount: state.evolutionCount,
    reroll,
    coreNpcActions: coreNpcs.length,
    factionActions: state.factions.length,
    diceRolls: state.dice.filter((roll) => roll.round === state.round).length,
    backgroundPopulation: state.background.simulatedPeople,
    activeStoryHooks: state.storyHooks.filter((hook) => hook.status === 'active').length,
    clanCount: state.factions.reduce((sum, faction) => sum + (faction.clans?.length || 0), 0),
    maxFactionTension: state.factions.reduce((max, faction) => Math.max(max, faction.tension || 0), 0),
    createdClans,
    festivals,
    dailyLife,
    compressed: compressed.map((entry) => ({ tier: entry.tier, fromRound: entry.fromRound, toRound: entry.toRound })),
    chronicleSize: state.chronicle.length,
    completedAt: new Date().toISOString(),
  };
  return state;
}
