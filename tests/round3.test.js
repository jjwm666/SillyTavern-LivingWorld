import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createWorldFromBootstrap } from '../src/engine/state.js';
import { evolveWorld } from '../src/engine/simulation.js';
import { DEFAULT_SETTINGS } from '../src/engine/constants.js';
import { readChat } from '../src/integration/context.js';
import { WorldStore } from '../src/integration/storage.js';
import { renderDice } from '../src/ui/views.js';

const settings = { ...DEFAULT_SETTINGS };

function bootstrapWorld() {
  return createWorldFromBootstrap({
    world: { name: '雾港', era: '盐历四百年', description: '潮汐与盐税的年代。' },
    regions: [
      { name: '雾港', type: '城市', description: '河口港市。', x: 200, y: 260, weather: { type: '雨', intensity: 1, remaining: 2 } },
      { name: '盐丘', type: '荒野', description: '盐碱高地。', x: 620, y: 200 },
    ],
    factions: [
      { name: '评议会', doctrine: '秩序', goal: '维持旧秩序', description: '老派议事机构。' },
      { name: '商约', doctrine: '逐利', goal: '打通海路', description: '沿海商团。' },
    ],
    npcs: [
      { name: '沈砚', role: '书记官', personality: '谨慎', goal: '保全档案', secret: '私藏旧账', regionName: '雾港', core: true },
      { name: '何栖', role: '船长', personality: '爽利', goal: '出海', secret: '船货不明', regionName: '雾港', core: true },
    ],
  }, { seed: 'round3-seed' });
}

test('同一轮重掷会换一种走法，同一重掷序数结果稳定', () => {
  const base = bootstrapWorld();
  const proposal = { npcIntents: [], factionIntents: [], eventProposals: [], rumorProposals: [] };

  const first = evolveWorld(base, proposal, settings);
  const again = evolveWorld(base, proposal, settings);
  assert.equal(first.lastEvolution.reroll, 0, '首轮标记为未重掷');
  assert.deepEqual(
    first.dice.map((roll) => roll.total),
    again.dice.map((roll) => roll.total),
    '不重掷时同一轮结果一致',
  );

  const rerolled = evolveWorld(base, proposal, { ...settings, reroll: 1 });
  assert.equal(rerolled.lastEvolution.reroll, 1);
  const changed = rerolled.dice.some((roll, index) => roll.total !== first.dice[index]?.total);
  assert.ok(changed, '重掷后骰点序列应当变化');

  const repeat = evolveWorld(base, proposal, { ...settings, reroll: 1 });
  assert.deepEqual(
    rerolled.dice.map((roll) => roll.total),
    repeat.dice.map((roll) => roll.total),
    '同一个重掷序数可以复现，便于回看',
  );
});

test('本轮摘要写世界而不是角色流水账', () => {
  const world = evolveWorld(bootstrapWorld(), { npcIntents: [], factionIntents: [] }, settings);
  const digest = world.worldDigest;
  assert.ok(digest.includes('全境平均繁荣'), `摘要应描述世界态势，实际是：${digest}`);
  assert.ok(digest.includes('声势领先') || digest.includes('局势平稳'), '摘要应提到势力格局');
  assert.ok(digest.endsWith('。'));
});

test('readChat 能从三种上下文来源读到正文', () => {
  const messages = [{ is_user: true, mes: '你好' }];
  assert.deepEqual(readChat({ chat: messages }), messages);
  assert.deepEqual(readChat({ chat: [], chatMessages: messages }), messages);
  assert.deepEqual(readChat({ chat: { messages } }), messages);
  assert.deepEqual(readChat(null), []);
  assert.deepEqual(readChat({}), []);

  globalThis.SillyTavern = { chat: messages };
  try {
    assert.deepEqual(readChat({}), messages, '可以从全局 SillyTavern 兜底读取');
  } finally {
    delete globalThis.SillyTavern;
  }
});

test('顶栏推进按钮左侧有独立的回退与重 roll 按钮，其余动作在弹出菜单里', () => {
  const panel = readFileSync(new URL('../src/ui/panel.js', import.meta.url), 'utf8');
  const start = panel.indexOf('<div class="lw-run-controls">');
  const end = panel.indexOf('</header>', start);
  assert.ok(start > -1 && end > start, '顶栏应有推演控制组');
  const controls = panel.slice(start, end);
  const rollbackAt = controls.indexOf('data-lw-action="rollback-turn"');
  const rerollAt = controls.indexOf('data-lw-action="reroll-turn" data-mode="dice"');
  const runAt = controls.indexOf('lw-run-toggle');
  assert.ok(rollbackAt > -1 && rerollAt > -1 && runAt > -1, '回退、重 roll 与推演按钮都要在控制组内');
  assert.ok(rollbackAt < runAt && rerollAt < runAt, '回退与重 roll 必须在推进按钮左边');
  assert.ok(controls.includes('lw-turn-button'), '独立按钮使用 lw-turn-button 样式');
  assert.ok(panel.includes('data-lw-action="run-menu"'));
  for (const action of ['evolve', 'reroll-turn', 'discard-evolution', 'rollback-turn']) {
    assert.ok(panel.includes(`data-lw-action="${action}"`), `菜单应包含 ${action}`);
  }
  assert.ok(panel.includes('data-mode="dice"') && panel.includes('data-mode="full"'));
  assert.ok(panel.includes('lw-spinner'), '推演中应换成即时旋转图标');
  assert.ok(panel.includes('aria-expanded'));
});

test('存档可以取当前检查点、忘掉上一轮、丢掉指定检查点', async () => {
  const context = {
    chatMetadata: {},
    saveMetadata: async () => {},
    chatId: 'chat-test',
    characterId: 'char-test',
  };
  const store = new WorldStore(() => context);
  const world = bootstrapWorld();

  await store.saveCheckpoint(4, 'turn-a', world, world);
  await store.saveCheckpoint(6, 'turn-b', world, world);
  assert.equal(store.checkpoints().length, 2);
  assert.equal(store.latestCheckpoint().messageIndex, 6);

  await store.dropCheckpoint(6);
  assert.deepEqual(store.checkpoints().map((entry) => entry.messageIndex), [4]);
  assert.equal(store.latestCheckpoint().messageIndex, 4);

  context.chatMetadata['living_world_last_turn'] = { messageIndex: 6, turnKey: 'turn-b' };
  assert.ok(store.lastTurn());
  await store.forgetLastTurn();
  assert.ok(!store.lastTurn(), '忘掉上一轮后同一条消息可以重新推演');
});

test('骰点分类计数守恒，老存档缺字段也不会算错', () => {
  const world = bootstrapWorld();
  world.dice = [
    { id: 'a', action: 'travel', total: 40, difficulty: 30, success: true, round: world.round },
    { id: 'b', action: 'trade', total: 20, difficulty: 30, success: false, round: world.round },
    { id: 'c', actorType: 'faction', action: 'expand', total: 55, difficulty: 40, success: true, round: 1 },
    { id: 'd', total: 10, difficulty: 5, success: true },
  ];
  const html = renderDice(world, 'all');
  assert.ok(html.includes('本轮 4 次 · 档案内累计 4 次') || html.includes('档案内累计 4 次'), '四类之和应等于全部');
});

test('骰点页在重掷后显示重掷次数', () => {
  const world = bootstrapWorld();
  world.lastEvolution = { reroll: 3, round: world.round };
  const html = renderDice(world, 'all');
  assert.ok(html.includes('本轮已重掷 3 次'));
});
