import { byId } from './utils.js';
import { refreshFactionDerived } from './state.js';

/**
 * 就地修改：把「设置里改一整段 JSON」换成「在哪看见就点哪里改」。
 * 视图只负责输出 data-lw-edit="kind:id:path:type"，真正的校验与写入都在这里，
 * 因此 UI 与引擎之间只有一条通道，改坏了也只会被拒绝而不会污染世界。
 */

/** 可点击修改的数值字段：一次写清范围，避免手改把世界推到荒谬状态。 */
export const EDIT_LIMITS = {
  prosperity: [0, 100],
  unrest: [0, 100],
  priceIndex: [20, 400],
  population: [0, 900000000],
  'weather.intensity': [0, 3],
  authority: [0, 100],
  'resources.wealth': [0, 100],
  'resources.influence': [0, 100],
  'resources.manpower': [0, 100],
  satisfaction: [0, 100],
  strength: [0, 100],
  progress: [0, 999],
  requiredProgress: [1, 999],
  wealth: [0, 900000000],
  'needs.safety': [0, 10],
  'needs.wealth': [0, 10],
  'needs.belonging': [0, 10],
  priority: [1, 5],
  'reputation.authority': [-100, 100],
  'reputation.common': [-100, 100],
  'reputation.shadow': [-100, 100],
  'reputation.circuit': [-100, 100],
};

const TEXT_LIMIT = 600;

const FIELD_LABELS = {
  name: '名称',
  description: '描述',
  worldDigest: '世界脉搏',
  wealth: '资金',
  prosperity: '繁荣',
  unrest: '动荡',
  priceIndex: '物价',
  population: '人口',
  'weather.type': '天气',
  'weather.intensity': '天气强度',
  authority: '权威',
  goal: '长期目标',
  'resources.wealth': '财富',
  'resources.influence': '影响',
  'resources.manpower': '人力',
  satisfaction: '人心',
  strength: '势力',
  progress: '进度',
  requiredProgress: '目标进度',
  content: '内容',
  role: '身份',
  'mood.label': '情绪',
  priority: '优先级',
  'needs.safety': '安全需求',
  'needs.wealth': '资源需求',
  'needs.belonging': '归属需求',
  'reputation.authority': '官方声誉',
  'reputation.common': '民间声誉',
  'reputation.shadow': '灰色声誉',
  'reputation.circuit': '行路声誉',
};

const KIND_LABELS = {
  world: '世界',
  player: '玩家',
  region: '地区',
  npc: '人物',
  faction: '势力',
  clan: '内部派系',
  event: '事件',
  rumor: '风声',
};

/** 解析 data-lw-edit="kind:id:path:type"，id 与 path 里不允许出现冒号。 */
export function parseEditSpec(raw) {
  const parts = String(raw || '').split(':');
  if (parts.length < 3) return null;
  const [kind, id, ...rest] = parts;
  let type = 'text';
  if (['number', 'textarea', 'text'].includes(rest[rest.length - 1])) type = rest.pop();
  const path = rest.join(':');
  if (!kind || !id || !path) return null;
  return { kind, id, path, type };
}

function regionById(regions, id) {
  for (const region of regions || []) {
    if (region.id === id) return region;
    const nested = regionById(region.children || [], id);
    if (nested) return nested;
  }
  return null;
}

export function resolveEditTarget(world, kind, id) {
  if (!world) return null;
  switch (kind) {
    case 'world': return world;
    case 'player': return world.player || null;
    case 'region': return regionById(world.regions, id);
    case 'npc': return byId(world.npcs, id);
    case 'faction': return byId(world.factions, id);
    case 'clan': {
      for (const faction of world.factions || []) {
        const clan = (faction.clans || []).find((item) => item.id === id);
        if (clan) return clan;
      }
      return null;
    }
    case 'event': return byId(world.events, id);
    case 'rumor': return byId(world.rumors, id);
    default: return null;
  }
}

function getByPath(target, path) {
  return String(path).split('.').filter(Boolean).reduce((node, key) => (
    node && typeof node === 'object' ? node[key] : undefined
  ), target);
}

export function setByPath(target, path, value) {
  const keys = String(path).split('.').filter(Boolean);
  if (!keys.length) return false;
  let node = target;
  for (let index = 0; index < keys.length - 1; index += 1) {
    const next = node[keys[index]];
    if (!next || typeof next !== 'object') return false;
    node = next;
  }
  node[keys[keys.length - 1]] = value;
  return true;
}

export function coerceEditValue(path, type, raw) {
  if (type === 'number') {
    const normalized = String(raw ?? '').replace(/[+,，\s]/g, '');
    if (!normalized) return { ok: false, error: '这个位置需要填写数字' };
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return { ok: false, error: '这个位置需要填写数字' };
    const limit = EDIT_LIMITS[path] || EDIT_LIMITS[String(path).split('.').pop()] || null;
    let value = limit && Number.isInteger(limit[0]) && Number.isInteger(limit[1])
      ? Math.round(parsed)
      : Math.round(parsed * 10) / 10;
    if (limit) value = Math.min(limit[1], Math.max(limit[0], value));
    return { ok: true, value };
  }
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, TEXT_LIMIT);
  if (!text) return { ok: false, error: '内容不能为空' };
  return { ok: true, value: text };
}

export function editLabel(kind, path) {
  const key = String(path);
  const field = FIELD_LABELS[key] || FIELD_LABELS[key.split('.').pop()] || key;
  return `${KIND_LABELS[kind] || ''}${field}`;
}

/** 就地修改的唯一写入入口：校验 → 落值 → 重算派生数值。 */
export function applyWorldEdit(world, payload) {
  if (!world) return { ok: false, error: '还没有可以修改的世界' };
  const { kind, id, path, type = 'text', value: raw } = payload || {};
  const target = resolveEditTarget(world, kind, id);
  if (!target) return { ok: false, error: '找不到要修改的对象，可能需要先刷新面板' };
  const coerced = coerceEditValue(path, type, raw);
  if (!coerced.ok) return coerced;
  const previous = getByPath(target, path);
  if (!setByPath(target, path, coerced.value)) return { ok: false, error: '这个字段不支持直接修改' };

  const field = String(path).split('.').pop();
  const ownerFaction = kind === 'faction'
    ? target
    : kind === 'clan'
      ? (world.factions || []).find((faction) => (faction.clans || []).some((clan) => clan.id === id)) || null
      : null;
  if (ownerFaction && (kind === 'faction' || field === 'satisfaction' || field === 'strength')) {
    refreshFactionDerived(ownerFaction);
  }

  return { ok: true, value: coerced.value, previous, label: editLabel(kind, path) };
}
