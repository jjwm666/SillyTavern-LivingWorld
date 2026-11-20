import assert from 'node:assert/strict';
import test from 'node:test';
import { createDemoWorld } from '../src/engine/demo-world.js';
import {
  applyWorldEdit,
  coerceEditValue,
  editLabel,
  parseEditSpec,
  resolveEditTarget,
  setByPath,
} from '../src/engine/edits.js';
import {
  renderEvents,
  renderFactions,
  renderMap,
  renderNpcInspector,
  renderOverview,
  renderPlayer,
  renderSettings,
} from '../src/ui/views.js';
import { DEFAULT_SETTINGS } from '../src/engine/constants.js';

test('edit spec 解析 kind/id/path/type，缺段直接拒绝', () => {
  assert.deepEqual(parseEditSpec('region:region_harbor:prosperity:number'), {
    kind: 'region', id: 'region_harbor', path: 'prosperity', type: 'number',
  });
  assert.deepEqual(parseEditSpec('npc:npc_shen:goals.0.description'), {
    kind: 'npc', id: 'npc_shen', path: 'goals.0.description', type: 'text',
  });
  assert.equal(parseEditSpec('region:region_harbor'), null);
  assert.equal(parseEditSpec(''), null);
});

test('数值修改按范围夹取，文字拒绝空值', () => {
  assert.equal(coerceEditValue('prosperity', 'number', 120).value, 100);
  assert.equal(coerceEditValue('prosperity', 'number', -9).value, 0);
  assert.equal(coerceEditValue('weather.intensity', 'number', 9).value, 3);
  assert.equal(coerceEditValue('priority', 'number', 0).value, 1);
  assert.equal(coerceEditValue('wealth', 'number', '+1,200').value, 1200);
  assert.equal(coerceEditValue('prosperity', 'number', 'abc').ok, false);
  assert.equal(coerceEditValue('prosperity', 'number', '').ok, false);
  assert.equal(coerceEditValue('name', 'text', '   ').ok, false);
  assert.equal(coerceEditValue('name', 'text', '  雾港  ').value, '雾港');
});

test('setByPath 支持数组下标，拿不到路径时拒绝写入', () => {
  const target = { goals: [{ description: '旧目标' }], nested: { value: 1 } };
  assert.equal(setByPath(target, 'goals.0.description', '新目标'), true);
  assert.equal(target.goals[0].description, '新目标');
  assert.equal(setByPath(target, 'nested.deep.value', 2), false);
});

test('可以改到嵌套的次级区域，并保持 ID 与连接不变', () => {
  const world = createDemoWorld();
  const child = world.regions.find((region) => region.id === 'region_harbor').children[0];
  const result = applyWorldEdit(world, {
    kind: 'region', id: child.id, path: 'prosperity', type: 'number', value: 77,
  });
  assert.equal(result.ok, true);
  assert.equal(result.label, '地区繁荣');
  assert.equal(resolveEditTarget(world, 'region', child.id).prosperity, 77);
  assert.equal(world.regions.find((region) => region.id === 'region_harbor').children[0].id, child.id);
});

test('改势力权威会重算稳定度等派生数值', () => {
  const world = createDemoWorld();
  const faction = world.factions[0];
  const before = faction.stability;
  const result = applyWorldEdit(world, {
    kind: 'faction', id: faction.id, path: 'authority', type: 'number', value: 92,
  });
  assert.equal(result.ok, true);
  assert.equal(faction.authority, 92);
  assert.ok(faction.stability > before, `稳定度应随权威上升：${before} → ${faction.stability}`);
});

test('改内部派系人心会重算所属势力的团结度与稳定度', () => {
  const world = createDemoWorld();
  const faction = world.factions.find((item) => (item.clans || []).length);
  const beforeCohesion = faction.cohesion;
  const beforeStability = faction.stability;
  // 把派系人心拉齐到高位：满意度的落差变小，团结度与稳定度都该随之上升。
  for (const clan of faction.clans) {
    const result = applyWorldEdit(world, {
      kind: 'clan', id: clan.id, path: 'satisfaction', type: 'number', value: 96,
    });
    assert.equal(result.ok, true);
    assert.equal(clan.satisfaction, 96);
  }
  assert.ok(faction.cohesion > beforeCohesion, `团结度应上升：${beforeCohesion} → ${faction.cohesion}`);
  assert.ok(faction.stability > beforeStability, `稳定度应上升：${beforeStability} → ${faction.stability}`);
});

test('找不到对象或越界字段时安全失败，不写坏世界', () => {
  const world = createDemoWorld();
  assert.equal(applyWorldEdit(world, { kind: 'npc', id: 'npc_missing', path: 'name', value: 'x' }).ok, false);
  assert.equal(applyWorldEdit(world, { kind: 'npc', id: 'npc_shen', path: 'name', type: 'text', value: '  ' }).ok, false);
  assert.equal(applyWorldEdit(null, { kind: 'world', id: 'world', path: 'name', value: 'x' }).ok, false);
});

test('editLabel 给人类读的字段名', () => {
  assert.equal(editLabel('region', 'prosperity'), '地区繁荣');
  assert.equal(editLabel('npc', 'goals.0.description'), '人物描述');
  assert.equal(editLabel('rumor', 'content'), '风声内容');
});

test('各视图都输出可点修改的字段', () => {
  const world = createDemoWorld();
  const overview = renderOverview(world);
  assert.ok(overview.includes('data-lw-edit="world:world:name:text"'));
  assert.ok(overview.includes('data-lw-edit="world:world:worldDigest:textarea"'));

  const player = renderPlayer(world);
  assert.ok(player.includes('data-lw-edit="player:player:name:text"'));
  assert.ok(player.includes('data-lw-edit="player:player:wealth:number"'));
  assert.ok(player.includes('data-lw-edit="player:player:reputation.common:number"'));

  const map = renderMap(world, world.regions[0].id, {}, { regions: world.regions, path: [] });
  assert.ok(map.includes('data-lw-edit="region:'));
  assert.ok(map.includes(':prosperity:number"'));
  assert.ok(map.includes(':weather.type:text"'));

  const factions = renderFactions(world, world.factions[0].id);
  assert.ok(factions.includes('data-lw-edit="faction:'));
  assert.ok(factions.includes(':authority:number"'));
  assert.ok(factions.includes('data-lw-edit="clan:'));

  const events = renderEvents(world);
  assert.ok(events.includes('data-lw-edit="event:'));
  assert.ok(events.includes(':requiredProgress:number"'));
  assert.ok(events.includes('data-lw-edit="rumor:'));

  const inspector = renderNpcInspector(world, world.npcs[0]);
  assert.ok(inspector.includes('data-lw-edit="npc:'));
  assert.ok(inspector.includes('needs.safety:number'));
});

test('设置里不再有整段 JSON 编辑器，改为就地修改说明', () => {
  const html = renderSettings(DEFAULT_SETTINGS, { kind: 'ready', message: '就绪' }, createDemoWorld(), []);
  assert.equal(html.includes('data-lw-world-editor'), false);
  assert.equal(html.includes('用户世界编辑器'), false);
  assert.ok(html.includes('点一下就能改') || html.includes('直接点击带下划线的文字或数字'));
});
