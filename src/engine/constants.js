export const SCHEMA_VERSION = 1;
export const STORAGE_KEY = 'living_world_state_v1';
export const CHECKPOINT_KEY = 'living_world_checkpoints_v1';
export const SETTINGS_KEY = 'living_world';
export const PROMPT_KEY = 'living_world_context';

export const PROMPT_PRESETS = Object.freeze({
  balanced: Object.freeze({
    name: '通用均衡',
    bootstrapPrompt: '保留输入材料的题材、时代与力量体系。让个人目标、地方利益和世界主线同时存在，避免所有冲突都围绕玩家。',
    evolutionPrompt: '平衡人物生活、势力博弈、地区变化与风声传播。优先延续已有因果，不要每轮强行制造重大危机。',
  }),
  intrigue: Object.freeze({
    name: '权谋与势力斗争',
    bootstrapPrompt: '强化组织之间的利益冲突、职位与资源依赖、秘密联盟和情报差。为核心 NPC 设置可长期推进的政治或组织目标。',
    evolutionPrompt: '提高外交、谋划、招募、施压和扩张意图的权重。秘密行动应有动机与信息来源，避免无依据的全知背叛。',
  }),
  exploration: Object.freeze({
    name: '探索与区域危机',
    bootstrapPrompt: '强化区域差异、路线风险、资源分布和可探索地点，让地图距离与控制区对人物决策产生明显影响。',
    evolutionPrompt: '提高旅行、调查、区域事件和风声扩散的权重。危机应有预兆与阶段，保留安全期和恢复空间。',
  }),
  ensemble: Object.freeze({
    name: '群像与自主生活',
    bootstrapPrompt: '为核心 NPC 建立不依赖玩家的职业、亲密关系、日常需求、私人计划和彼此交错的人生目标。',
    evolutionPrompt: '优先让人物根据日程、需求、情绪和私人记忆行动。增加援助、交易、休整与同地互动，不必每轮都推动主线。',
  }),
});

export const DEFAULT_SETTINGS = Object.freeze({
  autoEvolve: true,
  connectionMode: 'st',
  customBaseUrl: '',
  customApiKey: '',
  customModel: '',
  requestTimeout: 120,
  maxRetries: 2,
  temperature: 0.7,
  maxTokens: 12000,
  injectMaxChars: 9000,
  includeSecrets: false,
  coreNpcLimit: 24,
  backgroundNpcsPerRegion: 120,
  autoBootstrap: true,
  promptPreset: 'balanced',
  bootstrapPrompt: '',
  evolutionPrompt: '',
  jailbreakPrompt: '',
  floatingButton: true,
  activeTab: 'overview',
  mapZoom: 1,
  reduceMotion: false,
});

export const NPC_ACTIONS = Object.freeze([
  'pursue_goal', 'travel', 'investigate', 'trade', 'aid', 'scheme',
  'recruit', 'confront', 'spread_rumor', 'rest',
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
