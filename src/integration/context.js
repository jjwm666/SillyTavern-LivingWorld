import { byId, relationLabel, text } from '../engine/utils.js';

export function extractRecentConversation(chat, maxMessages = 10, maxChars = 14000) {
  return (Array.isArray(chat) ? chat : []).slice(-maxMessages).map((message) => {
    const speaker = message?.is_user ? '{{user}}' : (message?.name || '{{char}}');
    return `${speaker}: ${text(message?.mes, 4000)}`;
  }).join('\n\n').slice(-maxChars);
}

function fitSections(header, sections, maxChars) {
  const limit = Math.max(500, Number(maxChars) || 9000);
  let output = header;
  for (const section of sections) {
    if (!section.text) continue;
    const remaining = limit - output.length - 2;
    if (remaining <= 0) break;
    const content = section.text.length > remaining
      ? `${section.text.slice(0, Math.max(0, remaining - 20))}\n……[本节按预算截断]`
      : section.text;
    output += `\n\n${content}`;
  }
  return output.slice(0, limit);
}

export function buildWorldContext(state, options = {}) {
  if (!state) return '';
  const playerRegion = byId(state.regions, options.playerRegionId || state.player.regionId);
  const factions = state.factions.map((faction) => {
    const relations = Object.entries(faction.relations || {}).map(([id, relation]) => {
      const other = byId(state.factions, id);
      return `${other?.name || id}:${relationLabel(relation.value)}`;
    }).join('、');
    return `- ${faction.name}｜${faction.status}｜稳定${faction.stability}｜财富${faction.resources.wealth}｜目标：${faction.goal}${relations ? `｜关系：${relations}` : ''}`;
  }).join('\n');
  const regions = state.regions.map((region) => {
    const controller = byId(state.factions, region.controlFactionId);
    const routes = region.neighbors.map((edge) => `${byId(state.regions, edge.targetId)?.name || edge.targetId}(${edge.distance})`).join('、');
    return `- ${region.name}｜控制：${controller?.name || '无'}｜天气：${region.weather.type}(影响${region.weather.intensity}/3)｜繁荣${region.prosperity}｜动荡${region.unrest}｜物价${region.priceIndex}｜危险${region.danger}｜路线：${routes}`;
  }).join('\n');
  const activeEvents = state.events.filter((event) => event.status === 'active').map((event) => {
    const region = byId(state.regions, event.regionId);
    return `- ${event.name}｜Lv.${event.level}｜${event.stage}｜进度${event.progress}/${event.requiredProgress}｜地区：${region?.name || '未知'}｜${event.description}`;
  }).join('\n');
  const localPeople = state.npcs.filter((npc) => npc.alive && (npc.locationId === playerRegion?.id || npc.core)).map((npc) => {
    const faction = byId(state.factions, npc.factionId);
    const region = byId(state.regions, npc.locationId);
    const publicPlan = npc.locationId === playerRegion?.id && npc.plan && !npc.plan.goal.includes('秘密')
      ? `｜公开日程：${npc.schedule.current}` : '';
    return `- ${npc.name}｜${npc.role}｜${region?.name || '未知'}｜${faction?.name || '无所属'}｜状态：${npc.status}${publicPlan}`;
  }).join('\n');
  const localRumors = state.rumors.filter((rumor) => rumor.active && rumor.locations.some((location) => location.regionId === playerRegion?.id && location.strength > 0)).map((rumor) => {
    const location = rumor.locations.find((item) => item.regionId === playerRegion?.id);
    return `- [${rumor.type}｜强度${location?.strength || rumor.intensity}] ${rumor.content}`;
  }).join('\n');
  const publicLogs = state.logs.filter((log) => log.public && log.round >= state.round - 2).slice(-12).map((log) => `- 第${log.round}轮｜${log.title}：${log.detail}`).join('\n');
  const storyHooks = (state.storyHooks || []).filter((hook) => hook.status === 'active' && hook.regionId === playerRegion?.id).map((hook) => {
    const actor = byId(state.npcs, hook.actorId);
    return `- [${hook.kind === 'npc' ? '人物主动行动' : hook.kind === 'complication' ? '意外波折' : '意外机会'}｜紧迫度${hook.urgency}/3] ${actor?.name || ''}：${hook.content}`;
  }).join('\n');
  const sections = [
    { text: `【当前公开局势】\n${state.worldDigest}\n时间：${state.calendar.turnLabel}\n玩家所在区域：${playerRegion?.name || '未知'}` },
    { text: `【时代趋势】\n${state.trends.map((trend) => `- ${trend.name}(${trend.intensity}/5)：${trend.description}`).join('\n') || '无'}` },
    { text: `【进行中的事件】\n${activeEvents || '无'}` },
    { text: `【人物主动剧情与骰点转折】\n${storyHooks || '暂无'}\n这些是本地模拟已经产生的接触动机或转折机会。可自然融入当前场景，不要机械播报，不要强迫玩家接受，也不要替玩家决定回应。` },
    { text: `【地图与势力控制】\n${regions}` },
    { text: `【势力关系】\n${factions}` },
    { text: `【人物公开状态】\n${localPeople || '无'}` },
    { text: `【玩家所在地可听闻的风声】\n${localRumors || '暂无'}` },
    { text: `【近期公开变化】\n${publicLogs || '无'}` },
    { text: `【玩家公开处境、经济与背景】\n资金：${state.player.wealth}；本地物价：${playerRegion?.priceIndex || state.economy.priceIndex}。声誉：官方${state.player.reputation.authority}、民间${state.player.reputation.common}、灰色${state.player.reputation.shadow}、行路${state.player.reputation.circuit}。\n世界经济：${state.economy.climate}，平均价格指数${state.economy.priceIndex}。${state.economy.lastSignal}\n背景：${state.background.lastSettlement}` },
  ];
  if (options.includeSecrets) {
    const secrets = state.npcs.filter((npc) => npc.secrets.length || npc.plan).map((npc) => `- ${npc.name}｜秘密：${npc.secrets.join('；') || '无'}｜私人计划：${npc.plan?.goal || '无'}(${npc.plan?.stage || '无'})`).join('\n');
    sections.push({ text: `【仅叙事者可见的秘密，不得让玩家无条件知道】\n${secrets || '无'}` });
  }
  const header = `<living_world>\n以下是本地世界引擎在上轮回复后结算的事实，供本次叙事保持一致。它不是玩家全知信息：角色只能知道自己所在地、亲历或听闻的内容；未公开计划与秘密不可被无故点破。不要输出骰点，除非场景需要；不要把这些状态当成必须逐条复述的清单。`;
  return fitSections(header, sections, options.maxChars);
}
