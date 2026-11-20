import { PROMPT_PRESETS, RELATION_DIMENSIONS, RUMOR_SCOPES, RUMOR_TYPE_LABELS } from '../engine/constants.js';
import { chronicleSummary } from '../engine/chronicle.js';
import { resolveFestivals } from '../engine/simulation.js';
import { describeRelationTension, tierMeta } from '../engine/factions.js';
import { asArray, byId, stageFor } from '../engine/utils.js';

const DEFAULT_GUIDE = [
  '把下面的事实当成已经发生的世界状态写进正文，用叙述、对话、动作与具体细节自然体现；不要逐条复述，不要输出条目、编号或标签。',
  '本轮正文至少要落到 2 条势力层面的动向与 1 条人物动向，优先写与当前场景有关的部分。',
  '秘密、未公开的计划与真实内情不要让角色直接说出来，只能通过反常举动、暗示、流言或旁人的猜测体现。',
  '稳定度、财富、权威这类数字只用于你判断态势，绝对不要写进正文。',
  '玩家行为与这些事实冲突时，以事实为准，并让人物做出符合其性格与利益立场的反应。',
  '不要提及"引擎""系统""状态""推演""数据"等词，也不要解释这些设定从哪来。',
  '风声要分层对待：官方通告可以当作被公开引用的说法，区域消息只在本地说，小道消息要写出不确定与人为加工的偏差，密闻只能通过暗示与反常举动体现。',
  '节令与日常是生活质感，不是任务清单：让它们出现在对话的空隙、街上的气味与旁人的闲谈里，而不是单独列出来。',
];

/**
 * 取当前聊天的消息数组。不同酒馆版本把记录放在不同位置
 * （context.chat / context.chatMessages / 全局 SillyTavern.chat），
 * 这里统一成一份数组，读不到才退回空数组，避免整条链路以为「没有正文」。
 */
export function readChat(context) {
  const sources = [context?.chat, context?.chatMessages, context?.chat_history, globalThis.SillyTavern?.chat];
  for (const source of sources) {
    if (Array.isArray(source) && source.length) return source;
  }
  for (const source of sources) {
    if (source && typeof source === 'object' && Array.isArray(source.messages)) return source.messages;
  }
  return [];
}

export function extractRecentConversation(chat, maxMessages = 10, maxChars = 14000) {
  const history = asArray(chat).filter((message) => message && !message.is_system && !message.isSystem);
  const tail = history.slice(-maxMessages);
  const lines = [];
  for (const message of tail) {
    const name = message.name || (message.is_user ? '玩家' : '角色');
    const content = String(message.mes || message.content || '').replace(/\s+/g, ' ').trim();
    if (!content) continue;
    lines.push(`${name}：${content}`);
  }
  let joined = lines.join('\n');
  if (joined.length > maxChars) joined = joined.slice(-maxChars);
  return joined;
}

function section(title, lines) {
  const body = asArray(lines).filter(Boolean).join('\n');
  return body ? { title, body } : null;
}

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function relationSummary(faction, other) {
  const relation = faction.relations?.[other.id];
  if (!relation) return `${other.name}：未知`;
  const dims = relation.dimensions || {};
  const detail = RELATION_DIMENSIONS
    .filter((dimension) => Number(dims[dimension.key]) !== 50 || dimension.key === 'trust' || dimension.key === 'hostility')
    .map((dimension) => `${dimension.label}${Math.round(Number(dims[dimension.key] ?? 50))}`)
    .join('/');
  const tension = describeRelationTension(dims);
  return `${other.name} ${relation.label}（${detail}${tension ? `；${tension}` : ''}）`;
}

function clanLine(faction) {
  const clans = [...asArray(faction.clans)];
  if (!clans.length) return '';
  const parts = clans
    .sort((a, b) => b.strength - a.strength)
    .map((clan) => `${clan.name}（强${clan.strength}/满意${clan.satisfaction}${clan.note ? `，${compact(clan.note)}` : ''}）`);
  return `派系：${parts.join('、')}`;
}

function factionBlock(state, allowedIds = null) {
  const factions = [...state.factions]
    .filter((faction) => !allowedIds?.size || allowedIds.has(faction.id))
    .sort((a, b) => tierMeta(b.tier).rank - tierMeta(a.tier).rank);
  const lines = [];
  for (const faction of factions) {
    const meta = tierMeta(faction.tier);
    const leader = byId(state.npcs, faction.leaderNpcId);
    const relations = state.factions
      .filter((other) => other.id !== faction.id)
      .map((other) => relationSummary(faction, other))
      .slice(0, 4)
      .join('；');
    lines.push(`- ${faction.name}（${meta.label}｜${faction.status}｜稳定${faction.stability}｜首领权威${faction.authority}` + (leader ? `｜首领${leader.name}` : '') + '）');
    if (faction.goal) lines.push(`  目标：${compact(faction.goal)}`);
    const clans = clanLine(faction);
    if (clans) lines.push(`  ${clans}`);
    if (relations) lines.push(`  关系：${relations}`);
  }
  return lines;
}

function innerConflictBlock(state, allowedIds = null) {
  const lines = [];
  for (const faction of state.factions) {
    if (allowedIds?.size && !allowedIds.has(faction.id)) continue;
    const tension = Number(faction.tension) || 0;
    const unhappy = asArray(faction.clans)
      .filter((clan) => clan.satisfaction < 45)
      .sort((a, b) => a.satisfaction - b.satisfaction);
    if (tension < 55 && !unhappy.length) continue;
    const names = unhappy.slice(0, 2).map((clan) => `${clan.name}（${clan.note || '诉求长期未被回应'}）`).join('、');
    lines.push(`- ${faction.name}：内部张力${tension}${names ? `；${names}正在观望首领下一步` : ''}`);
  }
  return lines;
}

function closingReminder() {
  return [
    '【落笔前最后确认】',
    '上面这些是已经发生的客观事实，请直接写进正文：让至少两个势力各自推进一件事，让至少一个人物主动出手，',
    '并让读者从对话、动作和细节里感到势力内部的矛盾，而不是由叙述者解释。',
    '不要出现「引擎」「系统」「推演」「数据」「本轮」这类词，也不要罗列数字。',
  ].join('\n');
}

/**
 * 相关性焦点：世界照常全量运转，但注入只给「正文正在发生的地方与人」。
 * 依据是玩家所在地区 + 最近对话里被提到的地名与人名；没有焦点时退回全局摘要。
 * @returns {{ active: boolean, regions: Set<string>, npcs: Set<string>, factions: Set<string> }}
 */
export function buildFocus(state, options = {}) {
  const empty = { active: false, regions: new Set(), npcs: new Set(), factions: new Set() };
  if (options.focusInjection === false) return empty;
  const playerRegion = byId(state.regions, state.player?.regionId) || state.regions[0];
  const conversation = typeof options.conversation === 'string' ? options.conversation : '';
  const regionIds = new Set();
  const npcIds = new Set();
  const factionIds = new Set();
  const addNpc = (npc) => {
    if (!npc) return;
    npcIds.add(npc.id);
    if (byId(state.regions, npc.locationId)) regionIds.add(npc.locationId);
    if (byId(state.regions, npc.homeRegionId)) regionIds.add(npc.homeRegionId);
    if (byId(state.factions, npc.factionId)) factionIds.add(npc.factionId);
  };
  if (playerRegion) regionIds.add(playerRegion.id);
  // 对话里提到的人：正文正在写他，就必须知道他在做什么
  for (const npc of state.npcs) {
    if (!npc.alive || !npc.name || npc.name.length < 2) continue;
    if (conversation.includes(npc.name)) addNpc(npc);
  }
  // 对话里提到的地区
  for (const region of state.regions) {
    if (region.name.length >= 2 && conversation.includes(region.name)) regionIds.add(region.id);
  }
  // 玩家所在地区的人（生活质感的主要来源）
  for (const npc of state.npcs) {
    if (npc.alive && npc.core && npc.locationId === playerRegion?.id) addNpc(npc);
  }
  // 焦点地区的控制势力与它们的首领
  for (const region of state.regions) {
    if (!regionIds.has(region.id)) continue;
    if (byId(state.factions, region.controlFactionId)) factionIds.add(region.controlFactionId);
  }
  for (const faction of state.factions) {
    if (!factionIds.has(faction.id)) continue;
    const leader = byId(state.npcs, faction.leaderNpcId);
    if (leader?.alive) addNpc(leader);
  }
  const npcLimit = Math.max(3, Math.min(16, Number(options.focusNpcLimit) || 8));
  const factionLimit = Math.max(2, Math.min(10, Number(options.focusFactionLimit) || 4));
  return {
    active: npcIds.size > 0,
    regions: regionIds,
    npcs: new Set([...npcIds].slice(0, npcLimit)),
    factions: new Set([...factionIds].slice(0, factionLimit)),
  };
}

/** 风声按层级分组：不同层级的可信度与传播范围完全不同，混在一起会毁掉信息差。 */
function rumorLines(state, focus) {
  const regionIds = focus.active && focus.regions.size ? focus.regions : new Set([state.player?.regionId]);
  const order = ['official', 'regional', 'street', 'secret'];
  const lines = [];
  for (const scope of order) {
    const meta = RUMOR_SCOPES[scope];
    const rumors = state.rumors
      .filter((rumor) => rumor.active && (rumor.scope || 'street') === scope)
      .filter((rumor) => rumor.sourceRegionId === state.player?.regionId
        || asArray(rumor.locations).some((location) => regionIds.has(location.regionId) && location.strength > 0))
      .slice(0, 2);
    for (const rumor of rumors) {
      const reached = asArray(rumor.locations).filter((location) => location.strength > 0).length;
      const hint = scope === 'street' ? '（真假难辨）'
        : scope === 'secret' ? '（只有极少数人知道）'
          : scope === 'official' ? '（可当事实）' : '（本地流传）';
      lines.push(`- ${meta.label}｜${compact(rumor.content)}${hint}｜已传到 ${reached} 地`);
    }
  }
  return lines.slice(0, 6);
}

/** 编年纪要：越久远的事越短，只保留"读者需要记得"的那一句。 */
function chronicleLines(state) {
  const summary = chronicleSummary(state, { tier3: 1, tier2: 2, tier1: 2 });
  const lines = [];
  for (const entry of summary.era) lines.push(`〔纪年·${entry.title}〕${compact(entry.text).slice(0, 220)}`);
  for (const entry of summary.volumes) lines.push(`〔辑要·${entry.title}〕${compact(entry.text).slice(0, 200)}`);
  for (const entry of summary.recent) lines.push(`〔近纪·${entry.title}〕${compact(entry.text).slice(0, 180)}`);
  return lines;
}

function nextFestival(state, options = {}) {
  const { month, day } = state.calendar || {};
  if (!month) return null;
  const festivals = resolveFestivals(state, options);
  if (!festivals.length) return null;
  const today = month * 100 + (day || 1);
  const key = (festival) => festival.month * 100 + festival.day;
  const distance = (festival) => (key(festival) >= today ? key(festival) - today : key(festival) + 1200 - today);
  return [...festivals].sort((a, b) => distance(a) - distance(b))[0] || null;
}

/** 日常与节令：给正文提供生活质感，而不是只给冲突。 */
function dailyLines(state, options = {}) {
  const logs = state.logs.filter((log) => log.round === state.round && log.public && (log.type === 'daily' || log.type === 'festival'));
  const lines = logs.slice(0, 5).map((log) => `- ${compact(log.title)}：${compact(log.detail).slice(0, 120)}`);
  const festival = nextFestival(state, options);
  if (festival) {
    const origin = festival.origin === 'worldbook' ? '（见诸传说与典籍）' : festival.origin === 'custom' ? '（你设定的节庆）' : '';
    lines.push(`- 将至的节令：${compact(festival.name)}（${festival.month} 月 ${festival.day} 日）${origin}${festival.description ? `——${compact(festival.description).slice(0, 90)}` : ''}`);
  }
  return lines;
}

export function buildInjectionGuide(options = {}) {
  const preset = options.preset ? PROMPT_PRESETS[options.preset] : null;
  const custom = typeof options.injectGuide === 'string' ? compact(options.injectGuide) : '';
  const guide = [...DEFAULT_GUIDE];
  if (preset?.injectGuide) guide.push(compact(preset.injectGuide));
  if (custom) guide.push(custom);
  return guide.map((line, index) => `${index + 1}. ${line}`).join('\n');
}

function fitSections(header, sections, maxChars) {
  const limit = Number(maxChars);
  const parts = [header];
  let used = header.length;
  for (const item of sections) {
    if (!item) continue;
    const rendered = `\n\n【${item.title}】\n${item.body}`;
    if (Number.isFinite(limit) && limit > 0 && used + rendered.length > limit) continue;
    parts.push(rendered);
    used += rendered.length;
  }
  return parts.join('');
}

/**
 * 构造注入给主 API 的世界上下文。
 *
 * 主 API 曾经"看不懂"这段内容，原因不是信息不够，而是：
 * 1) 只有数据、没有指令，模型不知道要把它们当作既定事实写进正文；
 * 2) 缺少收尾标签，模型容易把整段当成用户发言的一部分；
 * 3) 数字与内部字段太多，模型倾向于复述而不是叙事。
 * 所以这里改成「事实 + 写作要求 + 收尾标签」的结构，并把数字压缩成态势描述。
 */
export function buildWorldContext(state, options = {}) {
  if (!state) return '';
  const playerRegion = byId(state.regions, state.player?.regionId) || state.regions[0];
  const open = '<living_world>';
  const close = '</living_world>';
  const guideOn = options.guide !== false;
  const head = guideOn
    ? `${open}\n【世界档案｜既定事实】\n以下是玩家上一轮行动之后，世界引擎结算出的既成事实。它们已经发生，是这个世界的现状，不是待选剧情，也不是玩家的发言。\n\n【写作要求】\n${buildInjectionGuide(options)}\n`
    : `${open}\n【世界档案｜既定事实】\n以下是玩家上一轮行动之后，世界引擎结算出的既成事实，它们是这个世界的现状。\n`;

  const sections = [];
  const focus = buildFocus(state, options);
  const focusFactions = focus.active ? focus.factions : null;

  sections.push(section('当前局势', [
    `${compact(state.name)}｜第${state.round}轮｜${compact(state.calendar?.turnLabel)}｜经济${compact(state.economy?.climate)}`,
    compact(state.worldDigest),
  ]));

  sections.push(section('时代潮流', state.trends.map((trend) => `- ${compact(trend.name)}：${compact(trend.description)}`)));

  const activeEvents = state.events.filter((event) => event.status === 'active').slice(0, 6);
  sections.push(section('进行中的事件', activeEvents.map((event) => {
    const region = byId(state.regions, event.regionId);
    return `- ${compact(event.name)}（${event.type === 'conflict' ? '冲突' : '进程'}·${stageFor(event)}｜${region?.name || '未知区域'}）${compact(event.description).slice(0, 120)}`;
  })));

  const npcLogs = state.logs
    .filter((log) => log.round === state.round && log.public && ['npc', 'faction', 'event', 'world'].includes(log.type))
    .slice(0, 8);
  sections.push(section('人物与势力的动向', npcLogs.map((log) => `- ${compact(log.title)}${log.detail ? `：${compact(log.detail).slice(0, 140)}` : ''}`)));

  sections.push(section('本轮骰点转折', state.twists
    .filter((twist) => twist.round === state.round)
    .slice(0, 3)
    .map((twist) => `- ${twist.kind === 'opportunity' ? '转机' : '意外'}：${compact(twist.content)}`)));

  sections.push(section('地图与控制', [
    `玩家所在：${playerRegion?.name || '未知'}（危险${playerRegion?.danger ?? 0}｜繁荣${playerRegion?.prosperity ?? 0}｜动荡${playerRegion?.unrest ?? 0}）`,
    ...(focusFactions ? state.factions.filter((faction) => focusFactions.has(faction.id)) : state.factions.slice(0, 8)).map((faction) => {
      const held = state.regions.filter((region) => region.controlFactionId === faction.id).slice(0, 4).map((region) => region.name);
      return held.length ? `- ${faction.name}控制：${held.join('、')}` : `- ${faction.name}：暂无稳定控制区`;
    }),
  ]));

  sections.push(section('势力格局', factionBlock(state, focusFactions)));
  sections.push(section('内部矛盾', innerConflictBlock(state, focusFactions)));

  const focusNpcs = focus.active
    ? state.npcs.filter((npc) => focus.npcs.has(npc.id))
    : state.npcs.filter((npc) => npc.alive && npc.core).slice(0, 14);
  sections.push(section('人物状态', focusNpcs.map((npc) => {
    const region = byId(state.regions, npc.locationId);
    const faction = byId(state.factions, npc.factionId);
    const goal = npc.goals?.[0]?.description;
    const routine = npc.routine ? `｜今日：${compact(npc.routine)}` : '';
    return `- ${npc.name}（${compact(npc.role)}${faction ? `｜${faction.name}` : ''}｜${region?.name || '未知'}｜${npc.mood?.label || '平静'}${routine}）${goal ? `正在${compact(goal)}` : ''}`;
  })));

  sections.push(section('当地风声', rumorLines(state, focus)));

  sections.push(section('节令与日常', dailyLines(state, options)));

  const chronicle = chronicleLines(state);
  sections.push(section('编年纪要', chronicle));

  sections.push(section('近期公开变化', state.logs
    .filter((log) => log.public && log.round >= Math.max(0, state.round - 2))
    .slice(-6)
    .map((log) => `- ${compact(log.title)}`)));

  const hooks = state.storyHooks.filter((hook) => ['active', 'approaching'].includes(hook.status)).slice(0, 4);
  sections.push(section('正在逼近的剧情钩子', hooks.map((hook) => `- ${compact(hook.title)}：${compact(hook.content).slice(0, 140)}`)));

  sections.push(section('玩家处境', [
    `财富${state.player?.wealth ?? 0}｜声望 官府${state.player?.reputation?.authority ?? 0}/民间${state.player?.reputation?.common ?? 0}/暗面${state.player?.reputation?.shadow ?? 0}/江湖${state.player?.reputation?.circuit ?? 0}`,
    ...state.factions
      .filter((faction) => Number(faction.playerRelation) !== 0)
      .slice(0, 5)
      .map((faction) => `- ${faction.name}对玩家：${faction.playerRelation > 0 ? '友好' : '敌视'}（${faction.playerRelation}）`),
  ]));

  if (options.includeSecrets) {
    sections.push(section('未公开内情', state.npcs
      .filter((npc) => npc.alive && npc.secrets?.length)
      .slice(0, 6)
      .flatMap((npc) => npc.secrets.slice(0, 1).map((secret) => `- ${npc.name}：${compact(secret)}`))));
  }

  const value = `${fitSections(head, sections, options.maxChars)}\n${guideOn ? `${closingReminder()}\n` : ''}${close}`;
  const limit = Number(options.maxChars);
  if (Number.isFinite(limit) && limit > 0 && value.length > limit) {
    const keep = Math.max(0, limit - close.length - 1);
    return `${value.slice(0, keep)}\n${close}`;
  }
  return value;
}
