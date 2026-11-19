import { asArray, clamp, hashString, integer, text } from './utils.js';

/**
 * 分级压缩（存档压缩）。
 *
 * 观察到的真实问题是：推演跑久了，日志、事件、风声越堆越多，注入越来越长，
 * 而其中大部分信息早就不再影响叙事。这里按「成功推演次数」而不是轮次号来压缩，
 * 因为重 roll 会回退轮次，但不会重复消耗一次真正的推进。
 *
 * - 一级：把 keepRounds 之前的日志压成一条「第 X–Y 轮纪要」，并从 logs 中移除原文；
 * - 二级：每 compressTier2Every 条一级纪要合并成一条更粗的二级纪要；
 * - 三级：每 compressTier3Every 条二级纪要合并成一条三级纪要（史书级）。
 *
 * 压缩只动「已归档」的细节，绝不删除事件、风声、人物与势力状态，所以回滚仍然安全：
 * 检查点保存的是压缩前的完整状态，回滚时会把纪要一起退回去。
 */

function clampInt(value, fallback, min, max) {
  return clamp(integer(value, fallback, min, max), min, max);
}

function roundDigest(state, round) {
  const logs = state.logs
    .filter((log) => log.round === round && log.public !== false)
    .map((log) => text(log.title, 120))
    .filter(Boolean);
  const unique = [];
  for (const title of logs) {
    if (!unique.includes(title)) unique.push(title);
    if (unique.length >= 4) break;
  }
  return unique.join('；');
}

function chronicleId(state, tier, fromRound, toRound) {
  return `chron_${tier}_${fromRound}_${toRound}_${hashString(`${state.seed}:${tier}:${fromRound}:${toRound}`)}`;
}

/** 已压缩到的轮次上限（只统计一级纪要覆盖范围）。 */
export function compressedThrough(state) {
  return asArray(state.chronicle)
    .reduce((max, entry) => Math.max(max, integer(entry?.toRound, 0, 0)), 0);
}

/** 把 [fromRound, toRound] 的公开日志压成一条一级纪要，并移除原文日志。 */
export function compressRoundWindow(state, fromRound, toRound) {
  if (toRound < fromRound) return null;
  const entries = [];
  for (let round = fromRound; round <= toRound; round += 1) {
    const digest = roundDigest(state, round);
    if (digest) entries.push(`第${round}轮：${digest}`);
  }
  if (!entries.length) return null;
  const entry = {
    id: chronicleId(state, 1, fromRound, toRound),
    tier: 1,
    fromRound,
    toRound,
    title: fromRound === toRound ? `第 ${fromRound} 轮纪要` : `第 ${fromRound}–${toRound} 轮纪要`,
    text: text(entries.join('／'), 1400),
    entries: entries.slice(0, 12),
    createdAt: new Date().toISOString(),
  };
  state.chronicle.push(entry);
  state.logs = state.logs.filter((log) => log.round < fromRound || log.round > toRound);
  return entry;
}

function mergeEntries(state, entries, tier) {
  const ordered = [...entries].sort((a, b) => a.fromRound - b.fromRound);
  if (ordered.length < 2) return null;
  const fromRound = ordered[0].fromRound;
  const toRound = ordered[ordered.length - 1].toRound;
  const merged = {
    id: chronicleId(state, tier, fromRound, toRound),
    tier,
    fromRound,
    toRound,
    title: `${tier === 3 ? '纪年' : '辑要'} 第 ${fromRound}–${toRound} 轮`,
    text: text(ordered.map((entry) => entry.text).join('；'), tier === 3 ? 1600 : 1500),
    entries: ordered.flatMap((entry) => asArray(entry.entries)).slice(0, 12),
    createdAt: new Date().toISOString(),
  };
  const mergedIds = new Set(ordered.map((entry) => entry.id));
  state.chronicle = state.chronicle.filter((entry) => !mergedIds.has(entry.id));
  state.chronicle.push(merged);
  return merged;
}

function collapseTier(state, tier, every) {
  const created = [];
  let entries = state.chronicle.filter((entry) => entry.tier === tier);
  // 保留最近的几条不合并，避免刚生成的纪要被立刻吞并后失去细节
  while (entries.length >= every + 1) {
    const batch = entries.slice(0, every);
    const merged = mergeEntries(state, batch, tier + 1);
    if (!merged) break;
    created.push(merged);
    entries = state.chronicle.filter((entry) => entry.tier === tier);
  }
  return created;
}

/**
 * 每轮推演结束后调用。返回本轮新生成的纪要（用于日志与 lastEvolution）。
 * @param {object} state 会被就地修改
 * @param {object} options 插件设置（compressionEnabled/compressEvery/compressTier2Every/compressTier3Every/compressKeepRounds）
 */
export function maybeCompress(state, options = {}) {
  if (!Array.isArray(state.chronicle)) state.chronicle = [];
  const created = [];
  const enabled = options.compressionEnabled !== false;
  const keepRounds = clampInt(options.compressKeepRounds, 4, 1, 50);
  const every = clampInt(options.compressEvery, 12, 2, 400);
  const tier2Every = clampInt(options.compressTier2Every, 5, 2, 50);
  const tier3Every = clampInt(options.compressTier3Every, 5, 2, 50);
  const evolutionCount = integer(state.evolutionCount, 0, 0);
  if (enabled && evolutionCount > 0 && evolutionCount % every === 0) {
    const cutoff = state.round - keepRounds;
    const covered = compressedThrough(state);
    if (cutoff > covered) {
      const entry = compressRoundWindow(state, covered + 1, cutoff);
      if (entry) created.push(entry);
    }
  }
  created.push(...collapseTier(state, 1, tier2Every));
  created.push(...collapseTier(state, 2, tier3Every));
  state.chronicle = state.chronicle.slice(-160);
  return created;
}

/** 供注入使用：从粗到细分层取出纪要。 */
export function chronicleSummary(state, { tier3 = 2, tier2 = 2, tier1 = 2 } = {}) {
  const chronicle = asArray(state.chronicle);
  const pick = (tier, limit) => chronicle
    .filter((entry) => entry.tier === tier)
    .sort((a, b) => b.toRound - a.toRound)
    .slice(0, limit);
  return {
    era: pick(3, tier3),
    volumes: pick(2, tier2),
    recent: pick(1, tier1),
  };
}

/** 面板与文档用：压缩进度摘要。 */
export function compressionState(state, options = {}) {
  const chronicle = asArray(state.chronicle);
  return {
    evolutionCount: integer(state.evolutionCount, 0, 0),
    every: clampInt(options.compressEvery, 12, 2, 400),
    untilNext: (() => {
      const every = clampInt(options.compressEvery, 12, 2, 400);
      const count = integer(state.evolutionCount, 0, 0);
      return count % every === 0 ? every : every - (count % every);
    })(),
    tier1: chronicle.filter((entry) => entry.tier === 1).length,
    tier2: chronicle.filter((entry) => entry.tier === 2).length,
    tier3: chronicle.filter((entry) => entry.tier === 3).length,
    compressedThrough: compressedThrough(state),
    liveLogs: asArray(state.logs).length,
  };
}
