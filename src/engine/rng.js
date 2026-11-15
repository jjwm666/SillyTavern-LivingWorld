import { clamp, hashString, integer } from './utils.js';

export class SeededRandom {
  constructor(seed) {
    this.seed = String(seed || 'living-world');
    this.state = parseInt(hashString(this.seed), 36) || 0x6d2b79f5;
    this.calls = 0;
  }

  next() {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    this.calls += 1;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  int(min, max) {
    const low = integer(min, 0);
    const high = integer(max, low);
    return Math.floor(this.next() * (high - low + 1)) + low;
  }

  chance(probability) {
    return this.next() < clamp(probability, 0, 1);
  }

  pick(values) {
    return values.length ? values[this.int(0, values.length - 1)] : null;
  }

  fork(label) {
    return new SeededRandom(`${this.seed}:${label}`);
  }
}

export function rollCheck(rng, {
  round = 0,
  actorId = 'world',
  action = 'check',
  modifier = 0,
  difficulty = 10,
  reason = '',
  sequence = 0,
} = {}) {
  const roll = rng.int(1, 20);
  const safeModifier = integer(modifier, 0, -20, 20);
  const safeDifficulty = integer(difficulty, 10, 1, 40);
  const total = roll + safeModifier;
  let outcome = total >= safeDifficulty ? 'success' : 'failure';
  if (roll === 20 || total >= safeDifficulty + 8) outcome = 'critical_success';
  if (roll === 1 || total <= safeDifficulty - 8) outcome = 'critical_failure';
  return {
    id: `dice_${round}_${sequence}_${hashString(`${actorId}:${action}:${roll}:${total}`)}`,
    round,
    actorId,
    action,
    reason,
    formula: `1d20${safeModifier >= 0 ? '+' : ''}${safeModifier} vs ${safeDifficulty}`,
    roll,
    sides: 20,
    modifier: safeModifier,
    total,
    difficulty: safeDifficulty,
    outcome,
    randomCall: rng.calls,
  };
}

export function isSuccess(outcome) {
  return outcome === 'success' || outcome === 'critical_success';
}

export function progressFromOutcome(outcome) {
  return {
    critical_success: 2,
    success: 1,
    failure: 0,
    critical_failure: -1,
  }[outcome] || 0;
}
