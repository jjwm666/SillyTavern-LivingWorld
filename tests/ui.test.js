import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SETTINGS, FACTION_TIERS } from '../src/engine/constants.js';
import { clanStance, clanStanding } from '../src/engine/factions.js';
import { factionTierLabel } from '../src/engine/state.js';
import { createDemoWorld } from '../src/engine/demo-world.js';
import {
  MAP_MAX_SCALE, MAP_MIN_SCALE, normalizeMapView,
  renderDice, renderEvents, renderFactions, renderMap, renderNpcInspector,
  renderOverview, renderPeople, renderPeopleGraph, renderPlayer, renderSettings,
} from '../src/ui/views.js';

test('势力层级用纯数字，适配任意世界观的卡片', () => {
  assert.deepEqual(FACTION_TIERS.map((tier) => tier.label), ['一级', '二级', '三级', '四级']);
  const world = createDemoWorld();
  for (const faction of world.factions) {
    const label = factionTierLabel(faction);
    assert.match(label, /^[一二三四]级$/);
  }
});

test('派系立场与派系关系由诉求推导', () => {
  assert.equal(clanStance({ demand: 'expansion' }), '主战');
  assert.equal(clanStance({ demand: 'profit' }), '通商');
  assert.equal(clanStance({ demand: 'security' }), '守成');
  assert.equal(clanStance({ demand: 'vengeance' }), '复仇');
  assert.equal(clanStance({ demand: 'reform' }), '清议');

  const faction = {
    clans: [
      { id: 'a', name: '拓边派', demand: 'expansion', strength: 60, satisfaction: 70 },
      { id: 'b', name: '守成派', demand: 'security', strength: 50, satisfaction: 40 },
      { id: 'c', name: '拓殖派', demand: 'expansion', strength: 30, satisfaction: 55 },
    ],
  };
  const ally = clanStanding(faction, faction.clans[0]);
  assert.equal(ally.tone, 'positive');
  assert.equal(ally.label, '同调');
  assert.equal(ally.partner, '拓殖派');

  const rival = clanStanding(faction, faction.clans[1]);
  assert.equal(rival.tone, 'negative');
  assert.equal(rival.label, '相争');

  assert.deepEqual(clanStanding({ clans: [] }, null), { tone: 'neutral', label: '尚无对手', partner: null });
});

test('地图、关系图、势力图共用同一套视口变换', () => {
  const world = createDemoWorld();
  const view = { scale: 2.5, x: -120, y: 40 };
  const map = renderMap(world, 'region_harbor', view, {});
  assert.ok(map.includes('data-lw-pan-zoom="map"'));
  assert.ok(map.includes('transform="translate(-120.00 40.00) scale(2.5000)"'));
  assert.ok(map.includes('data-lw-zoom-value'));
  assert.ok(map.includes('view-zoom-in') && map.includes('view-zoom-out') && map.includes('view-zoom-reset'));
  assert.ok(map.includes('双指缩放'));

  const graph = renderPeople(world, '', 'graph', null, view);
  assert.ok(graph.includes('data-lw-pan-zoom="people"'));
  assert.ok(graph.includes('scale(2.5000)'));

  const factions = renderFactions(world, world.factions[0].id, view);
  assert.ok(factions.includes('data-lw-pan-zoom="factions"'));
  assert.ok(factions.includes('scale(2.5000)'));
});

test('缩放比例被限制在可视范围内', () => {
  assert.equal(normalizeMapView({ scale: 99 }).scale, MAP_MAX_SCALE);
  assert.equal(normalizeMapView({ scale: 0.01 }).scale, MAP_MIN_SCALE);
  const fallback = normalizeMapView({});
  assert.equal(fallback.scale, 1);
  assert.equal(fallback.x, 0);
  assert.equal(fallback.y, 0);
});

test('人物关系图点击后以该人物为中心放射', () => {
  const world = createDemoWorld();
  const center = world.npcs[0];
  const others = world.npcs.slice(1, 4);
  for (const other of others) {
    center.relationships[other.id] = { trust: 40, affection: 20, fear: 0, debt: 0 };
    other.relationships[center.id] = { trust: 40, affection: 20, fear: 0, debt: 0 };
  }
  const html = renderPeopleGraph(world, center.id, '', { scale: 1, x: 0, y: 0 });
  assert.ok(html.includes('CENTER'));
  assert.ok(html.includes(center.name));
  assert.ok(html.includes('data-lw-action="npc-card"'));
  assert.ok(html.includes('data-lw-action="npc-focus-clear"'));
  for (const other of others) assert.ok(html.includes(other.name), `关系图应包含 ${other.name}`);
  assert.equal(html.includes('<article class="lw-relation-row'), true);
});

test('派系面板显示人心、势力与派系关系，数值面板可折叠', () => {
  const world = createDemoWorld();
  const html = renderFactions(world, world.factions[0].id, {});
  assert.ok(html.includes('人心'));
  assert.ok(html.includes('与其他派系'));
  assert.ok(html.includes('<details class="lw-fold'));
  assert.ok(!html.includes('<small>满意度</small>'));
  assert.ok(html.includes('数值面板'));
  assert.ok(html.includes('五个维度'));
});

test('概览、生涯、事件、骰点、设置、人物名片都提供折叠区块', () => {
  const world = createDemoWorld();
  const overview = renderOverview(world);
  assert.ok(overview.includes('data-fold-key="overview-timeline"'));
  assert.ok(overview.includes('data-fold-key="overview-pressure"'));
  assert.ok(overview.includes('data-fold-key="overview-macro"'));

  const player = renderPlayer(world);
  assert.ok(player.includes('data-fold-key="player-reputation"'));
  assert.ok(player.includes('data-fold-key="player-ledger"'));

  const events = renderEvents(world);
  assert.ok(events.includes('data-fold-key="events-list"'));
  assert.ok(events.includes('data-fold-key="events-rumors"'));

  const dice = renderDice(world, 'all');
  assert.ok(dice.includes('data-fold-key="dice-list"'));
  assert.ok(dice.includes('data-fold-key="dice-explain"'));

  const settingsHtml = renderSettings({ ...DEFAULT_SETTINGS, customPromptPresets: [] }, { message: '' }, world);
  assert.ok(settingsHtml.includes('data-fold-key="设置·推演与判定"'));
  assert.ok(settingsHtml.includes('data-fold-key="设置·存档与维护"'));
  assert.ok(settingsHtml.includes('<details class="lw-fold lw-settings-section'));

  const inspector = renderNpcInspector(world, world.npcs[0]);
  assert.ok(inspector.includes('data-fold-key="npc-goals-'));
  assert.ok(inspector.includes('data-fold-key="npc-secrets-'));
});

test('折叠区块的展开状态可跨重绘保留（key 唯一且稳定）', () => {
  const world = createDemoWorld();
  const first = renderOverview(world);
  const second = renderOverview(world);
  const keysOf = (html) => [...html.matchAll(/data-fold-key="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(keysOf(first), keysOf(second));
  assert.equal(new Set(keysOf(first)).size, keysOf(first).length);
});

test('规模设置放开核心 NPC 数量，并单独控制每轮简报人数', () => {
  const world = createDemoWorld();
  const html = renderSettings({ ...DEFAULT_SETTINGS, customPromptPresets: [] }, { message: '' }, world);
  assert.ok(html.includes('name="coreNpcLimit" min="1" max="400"'));
  assert.ok(html.includes('name="briefNpcLimit" min="8" max="240"'));
  assert.ok(html.includes('每轮简报人数'));
});

test('悬浮球改为白色主题球，图标与手柄随尺寸等比缩放', async () => {
  const fs = await import('node:fs/promises');
  const css = await fs.readFile(new URL('../style.css', import.meta.url), 'utf8');
  assert.ok(css.includes('--lw-float-bg: #ffffff'), '悬浮球底色应是白色');
  assert.ok(css.includes('.lw-floating > svg { width: 42%; height: 42%; }'), '图标应随球体等比缩放');
  assert.ok(css.includes('.lw-floating-resize { width: 28%; height: 28%;'), '缩放手柄应随球体等比缩放');
  assert.ok(css.includes('.lw-floating-orbit { inset: -10%; }'), '光环应随球体等比缩放');
});
