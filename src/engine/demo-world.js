import { changeRelation, createWorldFromBootstrap } from './state.js';

export function createDemoWorld() {
  const regions = [
    ['region_harbor', '白砾港', '港口', 120, 280, 'faction_compact', 68, 22],
    ['region_capital', '弥央城', '城市', 360, 130, 'faction_council', 74, 18],
    ['region_reach', '北境风原', '荒野', 660, 90, 'faction_clans', 38, 34],
    ['region_foundry', '炉心工区', '枢纽', 650, 300, 'faction_guild', 61, 28],
    ['region_mire', '沉默泽', '遗迹', 870, 450, 'faction_clans', 24, 55],
    ['region_orchard', '澜川农庄', '聚落', 390, 450, 'faction_council', 57, 20],
    ['region_border', '断桥关', '要塞', 110, 500, 'faction_watch', 42, 42],
    ['region_free', '浮灯自由市', '城市', 890, 180, 'faction_compact', 79, 16],
  ].map(([id, name, type, x, y, controlFactionId, prosperity, unrest]) => ({
    id, name, type, x, y, controlFactionId, prosperity, unrest,
    description: `${name}是灰潮群岛的重要区域，地方利益与外来力量在此交汇。`,
    resources: type === '港口' ? ['航运', '仓储'] : type === '城市' ? ['金融', '人脉'] : ['地方物产'],
    danger: Math.round(unrest / 12), population: 900 + prosperity * 24, neighbors: [],
  }));
  regions.find((region) => region.id === 'region_harbor').children = [
    { id: 'region_harbor_docks', name: '白砾港·潮汐码头', type: '港区', x: 220, y: 190, controlFactionId: 'faction_compact', prosperity: 72, unrest: 18, danger: 2, population: 860, resources: ['装卸', '修船'], neighbors: [{ targetId: 'region_harbor_oldtown', distance: 1, terrain: '石阶' }] },
    { id: 'region_harbor_oldtown', name: '白砾港·旧城仓街', type: '街区', x: 650, y: 210, controlFactionId: 'faction_compact', prosperity: 61, unrest: 26, danger: 3, population: 1120, resources: ['仓储', '旧货'], neighbors: [{ targetId: 'region_harbor_docks', distance: 1, terrain: '石阶' }], children: [
      { id: 'region_harbor_saltmarket', name: '旧城仓街·盐雾市', type: '市集', x: 260, y: 210, controlFactionId: 'faction_compact', prosperity: 66, unrest: 21, danger: 2, population: 280, resources: ['调味品', '消息'] },
      { id: 'region_harbor_customs', name: '旧城仓街·联合税关', type: '关口', x: 700, y: 330, controlFactionId: 'faction_council', prosperity: 48, unrest: 31, danger: 3, population: 90, resources: ['税务', '通行文书'] },
    ] },
  ];
  regions.find((region) => region.id === 'region_foundry').children = [
    { id: 'region_foundry_upper', name: '炉心工区·上层炉桥', type: '工区', x: 240, y: 180, controlFactionId: 'faction_guild', prosperity: 68, unrest: 24, danger: 3, population: 740, resources: ['精炼', '能源'] },
    { id: 'region_foundry_lower', name: '炉心工区·下层宿舍', type: '居住区', x: 670, y: 350, controlFactionId: 'faction_guild', prosperity: 43, unrest: 39, danger: 4, population: 1380, resources: ['劳工', '诊所'], children: [
      { id: 'region_foundry_clinic', name: '下层宿舍·葵灯诊所', type: '诊所', x: 380, y: 250, controlFactionId: 'faction_guild', prosperity: 45, unrest: 27, danger: 2, population: 60, resources: ['医疗', '病例'] },
      { id: 'region_foundry_canteen', name: '下层宿舍·公共食堂', type: '公共设施', x: 700, y: 180, controlFactionId: 'faction_guild', prosperity: 39, unrest: 44, danger: 2, population: 110, resources: ['配给', '集会'] },
    ] },
  ];
  const edges = [
    ['region_harbor', 'region_capital', 2], ['region_harbor', 'region_orchard', 2],
    ['region_harbor', 'region_border', 3], ['region_capital', 'region_reach', 3],
    ['region_capital', 'region_foundry', 2], ['region_capital', 'region_orchard', 1],
    ['region_reach', 'region_free', 2], ['region_reach', 'region_foundry', 2],
    ['region_foundry', 'region_mire', 3], ['region_foundry', 'region_free', 2],
    ['region_foundry', 'region_orchard', 2], ['region_orchard', 'region_border', 2],
    ['region_mire', 'region_free', 2],
  ];
  for (const [sourceId, targetId, distance] of edges) {
    regions.find((region) => region.id === sourceId).neighbors.push({ targetId, distance, terrain: '航路' });
    regions.find((region) => region.id === targetId).neighbors.push({ targetId: sourceId, distance, terrain: '航路' });
  }
  const factions = [
    ['faction_council', '弥央评议会', '#6d8dff', 'region_capital', '维持群岛秩序与中央权威'],
    ['faction_compact', '白砾商约', '#53bda9', 'region_harbor', '控制航路并扩大自由贸易'],
    ['faction_guild', '炉心同业会', '#e2aa5a', 'region_foundry', '争取工匠自治与能源配额'],
    ['faction_clans', '北境氏族联盟', '#c982e8', 'region_reach', '保住土地与传统生活方式'],
    ['faction_watch', '断桥守夜人', '#e47777', 'region_border', '监控灰潮并守住边境'],
  ].map(([id, name, color, homeRegionId, goal], index) => ({
    id, name, color, homeRegionId, goal,
    description: `${name}围绕“${goal}”展开长期行动。`,
    resources: { wealth: 45 + index * 6, influence: 62 - index * 3, manpower: 48 + index * 4 },
    stability: 58 + index * 4, playerRelation: 0,
  }));
  const people = [
    ['npc_shen', '沈砚', '评议会书记官', 'faction_council', 'region_capital', '查明议费缺口并保住自己的职位'],
    ['npc_he', '何汐', '商约船队主事', 'faction_compact', 'region_harbor', '建立一条不受评议会约束的新航路'],
    ['npc_luo', '洛衡', '独立测绘师', null, 'region_harbor', '完成沉默泽的地下路线图'],
    ['npc_qin', '秦冶', '同业会代表', 'faction_guild', 'region_foundry', '让工区获得独立能源配给权'],
    ['npc_yan', '晏葵', '工区医师', 'faction_guild', 'region_foundry', '找到工人怪病的真正来源'],
    ['npc_su', '苏蘅', '北境斥候', 'faction_clans', 'region_reach', '阻止商约测绘队进入祖地'],
    ['npc_zhou', '周槐', '农庄税务官', 'faction_council', 'region_orchard', '在征粮与乡邻关系之间求存'],
    ['npc_rong', '荣姑', '浮灯消息贩', null, 'region_free', '建立一个只出售真实情报的品牌'],
    ['npc_jiang', '江铎', '守夜人队长', 'faction_watch', 'region_border', '查清最近三次边境失联事件'],
    ['npc_mo', '莫离', '流亡技师', null, 'region_mire', '修复旧时代信标并隐藏自己的身份'],
    ['npc_lin', '林霁', '商约谈判人', 'faction_compact', 'region_free', '促成自由市与工区的长期合约'],
    ['npc_tang', '唐芜', '评议会特使', 'faction_council', 'region_reach', '把北境重新纳入评议会的税制'],
  ].map(([id, name, role, factionId, locationId, goal], index) => ({
    id, name, role, factionId, locationId, homeRegionId: locationId, core: true,
    description: `${role}，拥有自己的利益、恐惧与私人关系。`,
    attributes: { influence: 3 + index % 4, cunning: 4 + (index * 2) % 4, force: 2 + index % 5, empathy: 3 + (index * 3) % 5, resources: 2 + index % 4 },
    personality: { ambition: 4 + index % 6, empathy: 3 + (index * 2) % 6, caution: 2 + (index * 3) % 7, loyalty: 3 + index % 5 },
    needs: { safety: 4 + index % 6, wealth: 3 + (index * 2) % 6, belonging: 3 + (index * 3) % 6 },
    mood: { valence: index % 5 - 2, arousal: 3 + index % 5, label: ['平静', '警惕', '焦虑', '振奋'][index % 4] },
    goals: [{ description: goal, priority: 7 + index % 4 }],
    memories: [{ round: 0, content: '灰潮正在改变既有的生活秩序。', emotionalWeight: -1 }],
    secrets: index % 3 === 0 ? ['曾隐瞒一份与旧时代有关的记录。'] : [],
    schedule: { current: role === '独立测绘师' ? '核对航路图' : '处理本职事务', next: '推进个人目标' },
  }));
  factions[0].leaderNpcId = 'npc_shen';
  factions[1].leaderNpcId = 'npc_he';
  factions[2].leaderNpcId = 'npc_qin';
  factions[3].leaderNpcId = 'npc_su';
  factions[4].leaderNpcId = 'npc_jiang';
  const world = createWorldFromBootstrap({
    name: '灰潮群岛', seed: 'grey-tide-demo',
    premise: '神秘灰潮改变航路与资源分布，群岛中的城市、商会、工区、氏族和边境守卫因此重新洗牌。',
    tone: '低魔工业幻想、克制、政治与个人生活并行',
    worldDigest: '灰潮后的第三条航路刚刚开放，工区配额争议和北境税制同时逼近临界点。',
    trends: [
      { name: '灰潮改道', description: '旧航路逐渐失效，新航线带来财富与未知风险。', intensity: 4 },
      { name: '配额危机', description: '工区能源不足正在影响所有依赖生产的地区。', intensity: 3 },
    ],
    regions, factions, npcs: people,
    player: { name: '旅人', regionId: 'region_harbor', wealth: 160, reputation: { authority: 4, common: 8, shadow: 0, circuit: 3 } },
    events: [
      { id: 'event_quota', name: '工区配额争议', description: '工区要求独立配给，评议会担忧先例扩散。', type: 'conflict', level: 3, regionId: 'region_foundry', actorIds: ['npc_qin', 'npc_shen'], factionIds: ['faction_guild', 'faction_council'], progress: 2, requiredProgress: 7 },
      { id: 'event_mapping', name: '新航路测绘', description: '多方正在争夺第一条稳定新航路的所有权。', type: 'progress', level: 3, regionId: 'region_harbor', actorIds: ['npc_he', 'npc_luo'], factionIds: ['faction_compact'], progress: 1, requiredProgress: 6 },
      { id: 'event_disappear', name: '边境失联', description: '三支边境巡逻队先后失去联系。', type: 'conflict', level: 2, regionId: 'region_border', actorIds: ['npc_jiang'], factionIds: ['faction_watch'], requiredProgress: 5 },
    ],
    rumors: [
      { id: 'rumor_route', content: '有人声称白砾港已经出现一张永远不会迷航的海图。', type: 'rumor', truth: '测绘只完成了一部分。', sourceRegionId: 'region_harbor', intensity: 3, locations: [{ regionId: 'region_harbor', strength: 3 }, { regionId: 'region_capital', strength: 1 }] },
      { id: 'rumor_quota', content: '工区可能在本月停止向外供应能源。', type: 'report', sourceRegionId: 'region_foundry', intensity: 3, locations: [{ regionId: 'region_foundry', strength: 3 }, { regionId: 'region_capital', strength: 2 }] },
    ],
    economy: { climate: '平稳', priceIndex: 106, lastSignal: '新航路预期推高仓储价格，能源订单趋于保守。' },
  }, { seed: 'grey-tide-demo', coreNpcLimit: 24 });
  changeRelation(world.factions, 'faction_compact', 'faction_guild', 48, '长期能源与航运合约');
  changeRelation(world.factions, 'faction_council', 'faction_guild', -32, '工区独立配额争议');
  changeRelation(world.factions, 'faction_council', 'faction_clans', -58, '北境税制与祖地争端');
  changeRelation(world.factions, 'faction_compact', 'faction_clans', -24, '新航路测绘边界争议');
  changeRelation(world.factions, 'faction_watch', 'faction_clans', 28, '边境互助');
  return world;
}
