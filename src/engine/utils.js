export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : min));
}

export function integer(value, fallback = 0, min = -Infinity, max = Infinity) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(clamp(number, min, max)) : fallback;
}

export function text(value, maxLength = 500, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const result = String(value).trim();
  return (result || fallback).slice(0, maxLength);
}

export function deepClone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function average(values, fallback = 0) {
  const valid = values.map(Number).filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : fallback;
}

export function hashNumber(value) {
  let hash = 2166136261;
  const input = String(value);
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function hashString(value) {
  return hashNumber(value).toString(36);
}

export function makeId(prefix = 'id') {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}_${uuid || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`}`;
}

export function stableId(prefix, label, index = 0) {
  return `${prefix}_${hashString(`${label}:${index}`)}`;
}

export function byId(collection, id) {
  return asArray(collection).find((item) => item.id === id) || null;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function truncateMiddle(value, maxLength = 80) {
  const input = String(value ?? '');
  if (input.length <= maxLength) return input;
  const side = Math.floor((maxLength - 1) / 2);
  return `${input.slice(0, side)}…${input.slice(-side)}`;
}

export function formatNumber(value) {
  return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value) || 0);
}

export function relationLabel(value) {
  const number = Number(value) || 0;
  if (number >= 75) return '血盟';
  if (number >= 40) return '盟友';
  if (number >= 15) return '友好';
  if (number >= -14) return '中立';
  if (number >= -39) return '冷淡';
  if (number >= -74) return '敌对';
  return '世仇';
}

export function outcomeLabel(outcome) {
  return {
    critical_success: '大成功',
    success: '成功',
    failure: '失败',
    critical_failure: '大失败',
  }[outcome] || '未判定';
}

export function stageFor(event) {
  if (event.status === 'failed') return event.type === 'conflict' ? '已消散' : '已失败';
  const stages = event.type === 'conflict'
    ? ['萌芽', '发酵', '逼近', '已爆发']
    : ['筹备', '执行', '关键', '已完成'];
  const ratio = event.requiredProgress > 0 ? event.progress / event.requiredProgress : 0;
  const index = Math.min(stages.length - 1, Math.floor(ratio * stages.length));
  return stages[index];
}

export function safeJsonParse(raw) {
  if (raw && typeof raw === 'object') return raw;
  const source = String(raw || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  try {
    return JSON.parse(source);
  } catch {
    const start = source.indexOf('{');
    const end = source.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(source.slice(start, end + 1));
    throw new Error('后台 API 未返回有效 JSON');
  }
}

export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
