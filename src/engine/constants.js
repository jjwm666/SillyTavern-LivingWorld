export const SCHEMA_VERSION = 1;
export const STORAGE_KEY = 'living_world_state_v1';
export const CHECKPOINT_KEY = 'living_world_checkpoints_v1';
export const SETTINGS_KEY = 'living_world';
export const PROMPT_KEY = 'living_world_context';

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
