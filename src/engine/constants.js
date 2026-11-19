export const SCHEMA_VERSION = 3;
export const STORAGE_KEY = 'living_world_state_v1';
export const CHECKPOINT_KEY = 'living_world_checkpoints_v1';
export const SETTINGS_KEY = 'living_world';
export const PROMPT_KEY = 'living_world_context';

export const PROMPT_PRESETS = Object.freeze({
  balanced: Object.freeze({
    name: '通用均衡',
    bootstrapPrompt: '保留输入材料的题材、时代与力量体系。让个人目标、地方利益和世界主线同时存在，避免所有冲突都围绕玩家。为每个势力设置彼此诉求不同的内部派系，让首领的每一次抉择都可能得罪一部分自己人。',
    evolutionPrompt: '平衡人物生活、势力博弈、地区变化与风声传播。优先延续已有因果，不要每轮强行制造重大危机。势力内部的不满应通过具体人物与具体条件表现出来。',
    injectGuide: '叙述节奏保持日常与暗流交替：大多数动向体现为生活中的细节与旁人的态度，只有真正的大事才推到台前。',
  }),
  intrigue: Object.freeze({
    name: '权谋与势力斗争',
    bootstrapPrompt: '强化组织之间的利益冲突、职位与资源依赖、秘密联盟和情报差。为核心 NPC 设置可长期推进的政治或组织目标。每个势力至少要有三派不同诉求（扩张、通商、守成、复仇、改革），让首领权威与派系诉求互相牵制。',
    evolutionPrompt: '提高外交、谋划、招募、施压和扩张意图的权重。秘密行动应有动机与信息来源，避免无依据的全知背叛。让派系诉求与首领决策频繁错位：满足一方就会激怒另一方。',
    injectGuide: '多写台面下的交换与试探：一句双关的问候、一次刻意的座位安排、一份送错地方的礼单，都比直接说明立场更有力。旨意与私心并置。',
  }),
  exploration: Object.freeze({
    name: '探索与区域危机',
    bootstrapPrompt: '强化区域差异、路线风险、资源分布和可探索地点，让地图距离与控制区对人物决策产生明显影响。势力的内部派系应围绕“是否冒险向外”分裂。',
    evolutionPrompt: '提高旅行、调查、区域事件和风声扩散的权重。危机应有预兆与阶段，保留安全期和恢复空间。探索带来的新发现应当改变势力内部的派系强弱。',
    injectGuide: '让环境参与叙事：天气、路面、气味、远处的火光。危险的逼近要能被感官先察觉，而不是由旁白直接通报。',
  }),
  ensemble: Object.freeze({
    name: '群像与自主生活',
    bootstrapPrompt: '为核心 NPC 建立不依赖玩家的职业、亲密关系、日常需求、私人计划和彼此交错的人生目标。势力的内部分歧应落到具体人物身上，而不是抽象数字。',
    evolutionPrompt: '优先让人物根据日程、需求、情绪和私人记忆行动。增加援助、交易、休整与同地互动，不必每轮都推动主线。人物对自己所属势力的派系立场应有明确态度。',
    injectGuide: '留白与生活感优先：让人物有自己的作息、口癖和小算盘，势力的风向通过他们今天做了什么、推掉了什么体现。',
  }),
});

export const DEFAULT_SETTINGS = Object.freeze({
  autoEvolve: true,
  evolutionInterval: 1,
  diceModifier: 0,
  connectionMode: 'st',
  customBaseUrl: '',
  customApiKey: '',
  customModel: '',
  requestTimeout: 120,
  maxRetries: 2,
  temperature: 0.7,
  maxTokens: 12000,
  injectMaxChars: 9000,
  injectDepth: 2,
  injectGuide: true,
  injectGuideText: '',
  includeSecrets: false,
  coreNpcLimit: 24,
  backgroundNpcsPerRegion: 120,
  autoBootstrap: true,
  promptPreset: 'balanced',
  customPromptPresets: [],
  bootstrapPrompt: '',
  evolutionPrompt: '',
  jailbreakPrompt: '',
  theme: 'dark',
  floatingButton: true,
  floatingSize: 58,
  floatingX: null,
  floatingY: null,
  activeTab: 'overview',
  mapZoom: 1,
  reduceMotion: false,
  // 派系：允许后台 API 依据角色卡与当前局势自定义内部派系
  aiClans: true,
  // 风声分层
  rumorLayers: true,
  // 注入相关性：只注入与正文地区/人物有关的细节
  focusInjection: true,
  focusNpcLimit: 8,
  focusFactionLimit: 4,
  // 分级压缩：按成功推演次数压缩纪要
  compressionEnabled: true,
  compressEvery: 12,
  compressTier2Every: 5,
  compressTier3Every: 5,
  compressKeepRounds: 4,
  // 日常系统
  dailyLife: true,
  dailyActors: 2,
  festivals: true,
  customFestivals: '',
});

export const NPC_ACTIONS = Object.freeze([
  'pursue_goal', 'travel', 'investigate', 'trade', 'aid', 'scheme',
  'recruit', 'confront', 'spread_rumor', 'rest', 'seek_player',
]);

export const FACTION_ACTIONS = Object.freeze([
  'consolidate', 'trade', 'improve_relations', 'pressure', 'expand',
]);

export const EVENT_STAGES = Object.freeze({
  conflict: ['萌芽', '发酵', '逼近', '已爆发'],
  progress: ['筹备', '执行', '关键', '已完成'],
});

export const RELATION_LEVELS = Object.freeze([
  { min: 75, label: '血盟' },
  { min: 40, label: '盟友' },
  { min: 15, label: '友好' },
  { min: -14, label: '中立' },
  { min: -39, label: '冷淡' },
  { min: -74, label: '敌对' },
  { min: -100, label: '世仇' },
]);

/**
 * 势力间关系的拆分维度。`value` 仍然是综合态度（用于排序、标签、既有逻辑），
 * 但真正可叙事的是这几个互相独立的维度：它们可以彼此矛盾，矛盾本身就是权谋素材。
 * weight 参与 computeRelationValue 的加权：value = trust + (interest-50)*.5 + (culture-50)*.3 + (fear-50)*.2 - hostility
 */
export const RELATION_DIMENSIONS = Object.freeze([
  { key: 'trust', label: '信任', weight: 1, tone: 'positive', description: '对方是否守约、是否会在关键时刻站在自己一边' },
  { key: 'interest', label: '利益', weight: 0.5, tone: 'positive', description: '贸易、补给、技术与市场的相互依赖程度' },
  { key: 'culture', label: '理念', weight: 0.3, tone: 'positive', description: '秩序观、信仰与生活方式的可兼容程度' },
  { key: 'fear', label: '畏惧', weight: 0.2, tone: 'neutral', description: '对方的武力、情报与报复能力造成的压力' },
  { key: 'hostility', label: '敌意', weight: -1, tone: 'negative', description: '未清算的旧账、血债与公开敌对的惯性' },
]);

export const RELATION_DIMENSION_KEYS = Object.freeze(RELATION_DIMENSIONS.map((dimension) => dimension.key));

/** 内部派系诉求：决定首领的哪一类行动会让谁满意、让谁失势。 */
export const CLAN_DEMANDS = Object.freeze({
  expansion: Object.freeze({ label: '扩张派', summary: '主张对外扩张、夺取新地盘与话语权', push: Object.freeze(['expand']), against: Object.freeze(['consolidate', 'improve_relations']) }),
  profit: Object.freeze({ label: '通商派', summary: '主张贸易、开放往来与稳定的收益', push: Object.freeze(['trade']), against: Object.freeze(['pressure', 'expand']) }),
  security: Object.freeze({ label: '守成派', summary: '主张稳固基本盘、少生事端', push: Object.freeze(['consolidate']), against: Object.freeze(['expand']) }),
  vengeance: Object.freeze({ label: '复仇派', summary: '要求清算旧账、压制宿敌', push: Object.freeze(['pressure']), against: Object.freeze(['trade', 'improve_relations']) }),
  reform: Object.freeze({ label: '清议派', summary: '要求整顿旧制、对外改善名分', push: Object.freeze(['improve_relations']), against: Object.freeze(['trade', 'consolidate']) }),
});

export const CLAN_DEMAND_KEYS = Object.freeze(Object.keys(CLAN_DEMANDS));

export const CLAN_NAMES = Object.freeze([
  '激进派', '务实派', '守旧派', '少壮派', '元老派', '外务派', '军中派', '清议派', '商团派', '乡土派',
]);

/** 势力分层：层级决定首领权威基线、内部派系数量与影响力加成。 */
export const FACTION_TIERS = Object.freeze([
  Object.freeze({ id: 'hegemon', label: '霸主', rank: 4, authorityBase: 68, clanRange: [3, 4], influenceBonus: 14, description: '足以改写区域秩序的中心权力' }),
  Object.freeze({ id: 'great', label: '雄主', rank: 3, authorityBase: 60, clanRange: [3, 4], influenceBonus: 9, description: '拥有稳定基本盘与对外投射能力的强权' }),
  Object.freeze({ id: 'regional', label: '诸侯', rank: 2, authorityBase: 52, clanRange: [2, 3], influenceBonus: 4, description: '在本地有实质控制力，但受制于更大势力' }),
  Object.freeze({ id: 'local', label: '地方', rank: 1, authorityBase: 44, clanRange: [2, 2], influenceBonus: 0, description: '依附于地方环境的小型组织' }),
]);

export const FACTION_TIER_IDS = Object.freeze(FACTION_TIERS.map((tier) => tier.id));

export const TIER_UPGRADE_SCORE = 84;
export const TIER_DOWNGRADE_SCORE = 18;

export const ECONOMY_CLIMATES = Object.freeze(['繁荣', '平稳', '衰退', '动荡']);
export const MOODS = Object.freeze(['平静', '振奋', '焦虑', '愤怒', '悲观', '警惕']);
export const REGION_TYPES = Object.freeze(['城市', '荒野', '港口', '要塞', '聚落', '遗迹', '枢纽', '领域']);

export const ACTION_LABELS = Object.freeze({
  pursue_goal: '推进计划',
  travel: '前往',
  investigate: '调查',
  trade: '交易',
  aid: '援助',
  scheme: '谋划',
  recruit: '招募',
  confront: '对峙',
  spread_rumor: '传播风声',
  rest: '休整',
  seek_player: '主动寻找玩家',
  consolidate: '巩固',
  improve_relations: '改善关系',
  pressure: '施压',
  expand: '扩张',
});

export const STATUS_LABELS = Object.freeze({
  idle: '待命',
  queued: '等待推演',
  running: '世界推演中',
  ready: '世界已同步',
  error: '推演失败',
});

/**
 * 风声分层：分层决定「谁能听到、能传多远、传得多快、衰减多快」。
 * spread 加到传播判定上；maxLocations 是默认知晓范围（可达地区数，运行中可被 API 改写）；
 * decay 是每轮衰减权重（越大消失越快）。
 */
export const RUMOR_SCOPES = Object.freeze({
  official: Object.freeze({
    id: 'official', label: '官方通告', order: 0, spread: 3, maxLocations: 9, decay: 0.5,
    description: '官府、行会或宗教等权威机构的正式说法：传播最快，跨区几乎不受阻，衰减最慢',
  }),
  regional: Object.freeze({
    id: 'regional', label: '区域消息', order: 1, spread: 1, maxLocations: 4, decay: 1,
    description: '某一地区内部正在流通的消息：出不了本地，容易被本地事件覆盖',
  }),
  street: Object.freeze({
    id: 'street', label: '小道消息', order: 2, spread: 0, maxLocations: 6, decay: 1.5,
    description: '坊间口耳相传：真假难辨、容易走样，传得远但没人能担保',
  }),
  secret: Object.freeze({
    id: 'secret', label: '密闻', order: 3, spread: -2, maxLocations: 1, decay: 2.5,
    description: '只有极少数人知道的隐秘：几乎不会自然扩散，泄露本身就是剧情',
  }),
});

export const RUMOR_SCOPE_IDS = Object.freeze(Object.keys(RUMOR_SCOPES));

export const RUMOR_TYPES = Object.freeze(['announcement', 'report', 'rumor', 'sentiment']);

export const RUMOR_TYPE_LABELS = Object.freeze({
  announcement: '公告',
  report: '通报',
  rumor: '流言',
  sentiment: '舆情',
});

/** 旧存档只有 type，没有 scope：按来源推断一个默认层级。 */
export const RUMOR_TYPE_SCOPE = Object.freeze({
  announcement: 'official',
  report: 'regional',
  rumor: 'street',
  sentiment: 'street',
});

/** 日常活动模板：pickDailyActivity 会优先挑与职业关键词匹配的条目。 */
export const DAILY_ACTIVITIES = Object.freeze([
  Object.freeze({ id: 'ledger', keywords: ['商', '账', '钱', '掌柜', '贸易'], text: '清点账目，顺带听了一耳朵码头上的闲话', mood: 1 }),
  Object.freeze({ id: 'patrol', keywords: ['卫', '兵', '守', '警', '巡'], text: '沿着惯常的路线走了一圈，什么也没查出来，什么也没放过', mood: 0 }),
  Object.freeze({ id: 'forge', keywords: ['匠', '炉', '工', '铁'], text: '在炉火前耗掉了大半天，做成的活计只能换一顿酒', mood: 1 }),
  Object.freeze({ id: 'scribe', keywords: ['书记', '文书', '祭', '学', '僧'], text: '抄了一整天的旧文书，抄到一半忽然停笔', mood: 0 }),
  Object.freeze({ id: 'market', keywords: ['农', '渔', '市', '摊'], text: '在集市上和人争了半个时辰的价钱，最后还是照原价成交', mood: 1 }),
  Object.freeze({ id: 'letters', keywords: ['使', '外', '议', '官'], text: '写了几封信，又烧掉其中一封', mood: -1 }),
  Object.freeze({ id: 'drink', keywords: [], text: '在小馆子里坐到深夜，听邻桌把旧事说得像新事', mood: 1 }),
  Object.freeze({ id: 'visit', keywords: [], text: '绕路去看了一位久未联系的人，只在门外站了一会儿', mood: 0 }),
  Object.freeze({ id: 'repair', keywords: [], text: '修补屋顶与门闩，为将到的天气做准备', mood: 0 }),
  Object.freeze({ id: 'idle', keywords: [], text: '这一天什么正经事也没做，只是把该想的事又想了一遍', mood: -1 }),
]);

/** 内置节日：与 settings.customFestivals 及角色卡世界书生成的节日合并。 */
export const DEFAULT_FESTIVALS = Object.freeze([
  Object.freeze({ id: 'fest_thaw', name: '开河节', month: 2, day: 18, description: '冰面开裂、货船复航，沿河一带整夜不熄灯', origin: 'local' }),
  Object.freeze({ id: 'fest_mid', name: '年中集市', month: 6, day: 12, description: '各地商队赶在同一天入城，物价与口角一起上涨', origin: 'local' }),
  Object.freeze({ id: 'fest_harvest', name: '收成祭', month: 9, day: 21, description: '仓廪封顶，乡里按旧例向领主与神庙纳贡', origin: 'local' }),
  Object.freeze({ id: 'fest_silence', name: '静默日', month: 12, day: 3, description: '旧例禁止喧哗与交易，只有钟声与私下的拜会', origin: 'local' }),
]);

export const FESTIVAL_ORIGINS = Object.freeze(['local', 'worldbook', 'custom']);

export const FESTIVAL_ORIGIN_LABELS = Object.freeze({
  local: '本地',
  worldbook: '世界书',
  custom: '自定义',
});

/** 派系来源：local = 插件按层级生成，api = 后台 API 依据角色卡提出。 */
export const CLAN_ORIGINS = Object.freeze(['local', 'api']);

