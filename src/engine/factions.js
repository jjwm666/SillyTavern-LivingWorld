import {
  CLAN_DEMANDS, CLAN_DEMAND_KEYS, CLAN_NAMES, FACTION_TIERS, FACTION_TIER_IDS,
  RELATION_DIMENSIONS, TIER_DOWNGRADE_SCORE, TIER_UPGRADE_SCORE,
} from './constants.js';
import { asArray, average, clamp, hashNumber, integer, relationLabel, text } from './utils.js';

const tierById = new Map(FACTION_TIERS.map((tier) => [tier.id, tier]));

/** 后台 API 用中文写诉求时也能对上号：扩张/通商/守成/复仇/清议，或直接写 key。 */
const DEMAND_ALIASES = new Map();
for (const [key, value] of Object.entries(CLAN_DEMANDS)) {
  DEMAND_ALIASES.set(key, key);
  DEMAND_ALIASES.set(value.label, key);
  DEMAND_ALIASES.set(value.label.replace(/派$/, ''), key);
}
DEMAND_ALIASES.set('主战', 'expansion');
DEMAND_ALIASES.set('主和', 'reform');
DEMAND_ALIASES.set('商贸', 'profit');
DEMAND_ALIASES.set('孤立', 'security');
DEMAND_ALIASES.set('清算', 'vengeance');

export function resolveClanDemand(value) {
  const raw = text(value, 20);
  if (!raw) return '';
  if (CLAN_DEMAND_KEYS.includes(raw)) return raw;
  const compacted = raw.replace(/[（(].*?[)）]/g, '').trim();
  if (DEMAND_ALIASES.has(compacted)) return DEMAND_ALIASES.get(compacted);
  for (const [alias, key] of DEMAND_ALIASES.entries()) {
    if (alias.length >= 2 && compacted.includes(alias)) return key;
  }
  return '';
}

export function tierMeta(tierId) {
  return tierById.get(tierId) || tierById.get('regional');
}

export function tierRank(tierId) {
  return tierMeta(tierId).rank;
}

/** 依据资源规模推断层级，只在旧存档/手写世界缺少 tier 时使用。 */
export function inferFactionTier(faction) {
  const prestige = average([
    integer(faction?.resources?.wealth, 50, 0, 100),
    integer(faction?.resources?.influence, 50, 0, 100),
    integer(faction?.resources?.manpower, 50, 0, 100),
  ], 50);
  if (prestige >= 72) return 'hegemon';
  if (prestige >= 58) return 'great';
  if (prestige >= 44) return 'regional';
  return 'local';
}

export function normalizeTier(value, faction) {
  const id = text(value, 20);
  return FACTION_TIER_IDS.includes(id) ? id : inferFactionTier(faction);
}

// ---------------------------------------------------------------------------
// 关系维度
// ---------------------------------------------------------------------------

/**
 * 旧存档只有一个 value。为了让迁移幂等且不丢数据，这里从 value 反推出
 * 一组维度，使 computeRelationValue 的结果精确等于原 value。
 */
export function relationDimensionsFromValue(value) {
  const safe = integer(value, 0, -100, 100);
  return {
    trust: safe > 0 ? safe : 0,
    interest: 50,
    culture: 50,
    fear: 50,
    hostility: safe < 0 ? -safe : 0,
  };
}

export function normalizeRelationDimensions(source, fallbackValue) {
  const base = source && typeof source === 'object' ? source : relationDimensionsFromValue(fallbackValue);
  return {
    trust: integer(base.trust, 0, 0, 100),
    interest: integer(base.interest, 50, 0, 100),
    culture: integer(base.culture, 50, 0, 100),
    fear: integer(base.fear, 50, 0, 100),
    hostility: integer(base.hostility, 0, 0, 100),
  };
}

/** 综合态度，仍然落在 -100..100，供排序、标签与既有规则使用。 */
export function computeRelationValue(dimensions) {
  const dims = normalizeRelationDimensions(dimensions);
  const score = dims.trust * 1
    + (dims.interest - 50) * 0.5
    + (dims.culture - 50) * 0.3
    + (dims.fear - 50) * 0.2
    - dims.hostility * 1;
  return clamp(Math.round(score), -100, 100);
}

/** 矛盾度：高利益或高信任与高敌意并存时最有戏。 */
export function computeRelationTension(dimensions) {
  const dims = normalizeRelationDimensions(dimensions);
  const aligned = Math.min(dims.hostility, dims.interest) * 0.55
    + Math.min(dims.hostility, dims.trust) * 0.3;
  const drift = Math.abs(dims.interest - dims.trust) * 0.15;
  return clamp(Math.round(aligned + drift), 0, 100);
}

/** 维度里最突出的矛盾，用作叙事钩子的原料。 */
export function describeRelationTension(dimensions) {
  const dims = normalizeRelationDimensions(dimensions);
  const notes = [];
  if (dims.hostility >= 40 && dims.interest >= 55) notes.push('利益捆绑却血债未清');
  if (dims.hostility >= 40 && dims.trust >= 50) notes.push('彼此信任却已兵戎相见');
  if (dims.fear >= 65) notes.push('一方长期以武力压人');
  if (dims.culture <= 25) notes.push('理念难以兼容');
  if (dims.trust >= 60 && dims.interest <= 30) notes.push('情分还在，实惠已经断了');
  return notes.slice(0, 2).join('；');
}

// ---------------------------------------------------------------------------
// 内部派系
// ---------------------------------------------------------------------------

function pickDemands(seed, count) {
  const start = hashNumber(seed) % CLAN_DEMAND_KEYS.length;
  const picked = [];
  for (let index = 0; index < count; index += 1) {
    picked.push(CLAN_DEMAND_KEYS[(start + index * 2) % CLAN_DEMAND_KEYS.length]);
  }
  return picked;
}

/** 缺少 clans 时按势力名确定性生成 2-4 个派系，保证老存档与手写世界都能运行。 */
export function createDefaultClans(faction, tier) {
  const meta = tierMeta(normalizeTier(tier, faction));
  const [min, max] = meta.clanRange;
  const seed = `${faction?.id || faction?.name || 'faction'}:clans`;
  const count = min + (hashNumber(seed) % (max - min + 1));
  const demands = pickDemands(seed, count);
  const stability = integer(faction?.stability, meta.authorityBase, 0, 100);
  return demands.map((demand, index) => {
    const noise = (hashNumber(`${seed}:${index}`) % 25) - 12;
    return {
      id: `clan_${faction?.id || 'f'}_${index + 1}`,
      name: CLAN_NAMES[(hashNumber(`${seed}:${index}:name`) + index) % CLAN_NAMES.length],
      demand,
      strength: clamp(20 + (hashNumber(`${seed}:${index}:s`) % 41), 5, 100),
      satisfaction: clamp(stability + noise, 0, 100),
      note: '',
      origin: 'local',
      createdRound: 0,
    };
  });
}

export function normalizeClans(source, faction, tier) {
  const list = asArray(source).filter((item) => item && typeof item === 'object').slice(0, 6);
  if (!list.length) return createDefaultClans(faction, tier);
  const fallback = createDefaultClans(faction, tier);
  const usedNames = new Set();
  return list.map((clan, index) => {
    const demand = resolveClanDemand(clan.demand) || fallback[index % fallback.length].demand;
    let name = text(clan.name, 60) || CLAN_DEMANDS[demand].label;
    if (usedNames.has(name)) name = `${name}·${index + 1}`;
    usedNames.add(name);
    return {
      id: text(clan.id, 100) || `clan_${faction?.id || 'f'}_${index + 1}`,
      name,
      demand,
      strength: integer(clan.strength, 40, 0, 100),
      satisfaction: integer(clan.satisfaction, 55, 0, 100),
      note: text(clan.note, 200),
      origin: clan.origin === 'api' ? 'api' : 'local',
      createdRound: integer(clan.createdRound, 0, 0),
    };
  });
}

/**
 * 把后台 API 依据角色卡/当前局势提出的派系融进势力。
 * 规则：同名视为同一个派系，只更新诉求与数值；新派系受层级上限约束；绝不因为提案而删除既有派系。
 * @returns {{added: object[], updated: object[], rejected: string[]}}
 */
export function mergeProposedClans(faction, proposals, round = 0) {
  const result = { added: [], updated: [], rejected: [] };
  const meta = tierMeta(normalizeTier(faction?.tier, faction));
  const maxClans = Math.min(6, meta.clanRange[1] + 1);
  const clans = asArray(faction.clans).filter(Boolean);
  for (const proposal of asArray(proposals).slice(0, 6)) {
    if (!proposal || typeof proposal !== 'object') continue;
    const name = text(proposal.name, 40).replace(/[：:，,。\s]+$/, '');
    if (name.length < 2) {
      result.rejected.push('派系名过短');
      continue;
    }
    const demand = resolveClanDemand(proposal.demand) || resolveClanDemand(proposal.summary) || '';
    const strength = integer(proposal.strength, 35, 0, 100);
    const satisfaction = integer(proposal.satisfaction, 50, 0, 100);
    const note = text(proposal.note || proposal.summary, 200);
    const existing = clans.find((clan) => clan.name === name);
    if (existing) {
      if (demand) existing.demand = demand;
      existing.strength = clamp(Math.round((existing.strength + strength) / 2), 0, 100);
      existing.satisfaction = clamp(Math.round((existing.satisfaction + satisfaction) / 2), 0, 100);
      if (note) existing.note = note;
      result.updated.push(existing);
      continue;
    }
    if (clans.length >= maxClans) {
      result.rejected.push(`${name}（${meta.label}最多 ${maxClans} 个派系）`);
      continue;
    }
    const clan = {
      id: `clan_${faction.id}_${clans.length + 1}_${hashNumber(`${faction.id}:${name}`)}`,
      name,
      demand: demand || 'security',
      strength,
      satisfaction,
      note,
      origin: 'api',
      createdRound: round,
    };
    clans.push(clan);
    result.added.push(clan);
  }
  faction.clans = clans.slice(0, maxClans);
  return result;
}

/** 广播用的派系摘要，供日志与提示词复用。 */
export function describeClan(clan) {
  const demand = clanDemandOf(clan);
  return `${clan.name}（${demand.label}｜强${clan.strength}｜满意${clan.satisfaction}）`;
}

export function computeFactionCohesion(clans) {
  const list = asArray(clans).filter(Boolean);
  if (!list.length) return 55;
  const strengths = list.map((clan) => clamp(clan.strength, 0, 100));
  const satisfaction = list.map((clan) => clamp(clan.satisfaction, 0, 100));
  const spread = Math.max(...strengths) - Math.min(...strengths);
  const satSpread = Math.max(...satisfaction) - Math.min(...satisfaction);
  return clamp(Math.round(60 - (spread / 100) * 35 - (satSpread / 100) * 25), 0, 100);
}

/** 稳定度 = 首领权威 + 派系满意度 + 派系格局的合力。 */
export function computeFactionStability(faction) {
  const authority = integer(faction?.authority, 50, 0, 100);
  const clans = asArray(faction?.clans).filter(Boolean);
  if (!clans.length) return clamp(authority, 0, 100);
  const avgSat = average(clans.map((clan) => integer(clan.satisfaction, 55, 0, 100)), 55);
  const cohesion = computeFactionCohesion(clans);
  return clamp(Math.round(authority * 0.45 + avgSat * 0.3 + cohesion * 0.25), 0, 100);
}

/** 内部张力：某个强势派系长期得不到满足。 */
export function computeFactionTension(faction) {
  const clans = asArray(faction?.clans).filter(Boolean);
  if (!clans.length) return 0;
  let worst = 0;
  for (const clan of clans) {
    const pressure = (integer(clan.strength, 40, 0, 100) / 100) * ((100 - integer(clan.satisfaction, 55, 0, 100)) / 100);
    worst = Math.max(worst, pressure);
  }
  return clamp(Math.round(worst * 100), 0, 100);
}

export function dominantClan(faction) {
  return asArray(faction?.clans).filter(Boolean).sort((a, b) => b.strength - a.strength)[0] || null;
}

export function unhappiestClan(faction) {
  return asArray(faction?.clans).filter(Boolean).sort((a, b) => a.satisfaction - b.satisfaction)[0] || null;
}

export function clanDemandOf(clan) {
  return CLAN_DEMANDS[clan?.demand] || CLAN_DEMANDS.security;
}

/** 首领采取某行动后，各派系的强弱与满意度变化。就地修改 faction。 */
export function settleClans(faction, action, { success = true, critical = false } = {}) {
  const clans = asArray(faction?.clans).filter(Boolean);
  const mood = success ? (critical ? 1.6 : 1) : 0.4;
  const satisfied = [];
  const conflicted = [];
  for (const clan of clans) {
    const demand = clanDemandOf(clan);
    if (demand.push.includes(action)) {
      clan.satisfaction = clamp(clan.satisfaction + Math.round(9 * mood), 0, 100);
      clan.strength = clamp(clan.strength + (success ? 3 : 1), 0, 100);
      clan.note = success ? `主张${demand.label}路线，本轮如愿` : '主张虽被采纳，但行动未见成效';
      satisfied.push(clan);
    } else if (demand.against.includes(action)) {
      clan.satisfaction = clamp(clan.satisfaction - Math.round(11 * mood), 0, 100);
      clan.strength = clamp(clan.strength - (success ? 4 : 2), 0, 100);
      clan.note = '反对这条路线，认为首领正在断送本派的利益';
      conflicted.push(clan);
    } else {
      clan.satisfaction = clamp(clan.satisfaction + (clan.satisfaction < 50 ? 1 : -1), 0, 100);
      clan.strength = clamp(clan.strength + (success ? 1 : -1), 0, 100);
    }
  }
  faction.authority = clamp(
    integer(faction.authority, 50, 0, 100) + (success ? 2 : -2) + (satisfied.length > conflicted.length ? 1 : 0),
    0, 100,
  );
  return { satisfied, conflicted };
}

/** 层级跃迁：规模足够大时上升，被掏空时下降。 */
export function factionTierScore(faction) {
  return average([
    integer(faction?.resources?.wealth, 50, 0, 100),
    integer(faction?.resources?.influence, 50, 0, 100),
    integer(faction?.resources?.manpower, 50, 0, 100),
  ], 50);
}

export function nextFactionTier(faction) {
  const current = tierMeta(normalizeTier(faction?.tier, faction));
  const index = FACTION_TIERS.indexOf(current);
  const score = factionTierScore(faction);
  if (score >= TIER_UPGRADE_SCORE) return FACTION_TIERS[index - 1] || null;
  if (score <= TIER_DOWNGRADE_SCORE) return FACTION_TIERS[index + 1] || null;
  return null;
}

export function relationTone(value) {
  const label = relationLabel(value);
  return { label, tone: value >= 15 ? 'positive' : value <= -15 ? 'negative' : 'neutral' };
}

export { RELATION_DIMENSIONS };
