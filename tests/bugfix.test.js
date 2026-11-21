import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SETTINGS, STORAGE_KEY } from '../src/engine/constants.js';
import { compressRoundWindow } from '../src/engine/chronicle.js';
import { createDemoWorld } from '../src/engine/demo-world.js';
import { parseCustomFestivals } from '../src/engine/simulation.js';
import { addLog } from '../src/engine/state.js';
import { byId, deepClone } from '../src/engine/utils.js';
import { WorldAPI } from '../src/integration/api.js';
import { WorldStore } from '../src/integration/storage.js';
import { renderLore, renderMap, renderOverview, renderSettings } from '../src/ui/views.js';

const settings = { ...DEFAULT_SETTINGS };

function fakeDb() {
  const data = new Map();
  return {
    data,
    transaction() {
      const tx = { oncomplete: null, onerror: null, onabort: null };
      const store = {
        put(value, key) {
          data.set(key, value);
          queueMicrotask(() => tx.oncomplete?.());
          return {};
        },
        get(key) {
          const request = { result: data.get(key), onsuccess: null, onerror: null };
          queueMicrotask(() => request.onsuccess?.());
          return request;
        },
      };
      tx.objectStore = () => store;
      return tx;
    },
  };
}

test('deepClone 不再对 undefined 抛错，Proxy 等不可克隆值退回 JSON', () => {
  assert.equal(deepClone(undefined), undefined);
  assert.deepEqual(deepClone({ a: [1, 2] }), { a: [1, 2] });
});

test('byId 走索引：就地改写立即可见，增删后自动重建', () => {
  const world = createDemoWorld();
  const npc = world.npcs[0];
  npc.name = '改过的名字';
  assert.equal(byId(world.npcs, npc.id).name, '改过的名字');
  const added = { ...npc, id: 'npc_extra' };
  world.npcs.push(added);
  assert.equal(byId(world.npcs, 'npc_extra')?.id, 'npc_extra');
  world.npcs.pop();
  assert.equal(byId(world.npcs, 'npc_extra'), null);
});

test('自定义节庆的日期解析与界面共用一套规则', () => {
  const list = parseCustomFestivals('雾灯节|5.1|点灯\n潮生祭|3月15|放灯\n错月节|13-2|无效\n错日节|4-31|无效');
  assert.deepEqual(list.map((item) => item.name), ['雾灯节', '潮生祭']);
  assert.deepEqual([list[0].month, list[0].day], [5, 1]);
  assert.deepEqual([list[1].month, list[1].day], [3, 15]);
});

test('世界书页显示的节庆与引擎能触发的节庆一致', () => {
  const world = createDemoWorld();
  const html = renderLore(world, { ...settings, customFestivals: '雾灯节|5.1|点灯' }, { books: [] }, {});
  assert.ok(html.includes('雾灯节'), '界面应列出用 5.1 写的自定义节庆');
  const engine = parseCustomFestivals('雾灯节|5.1|点灯');
  assert.equal(engine.length, 1, '引擎同样要认这条节庆');
});

test('压缩存档不会吞掉非公开日志', () => {
  const world = createDemoWorld();
  world.round = 5;
  addLog(world, { type: 'event', title: '市集开张', round: 5, public: true });
  addLog(world, { type: 'event', title: '议长私会刺客', round: 5, public: false });
  const entry = compressRoundWindow(world, 5, 5);
  assert.ok(entry, '应有纪要生成');
  assert.ok(world.logs.some((log) => log.title === '议长私会刺客'), '非公开日志必须保留');
  assert.ok((entry.secrets || []).includes('议长私会刺客'), '纪要里也要留一份索引');
});

test('存档写 IndexedDB 时元数据只放指针，读回仍拿到整个世界', async () => {
  const context = { chatMetadata: {}, saveMetadata: async () => {}, chatId: 'chat-a', characterId: 'char-a' };
  const store = new WorldStore(() => context);
  store.db = fakeDb();
  const world = createDemoWorld();
  await store.save(world);
  const meta = context.chatMetadata[STORAGE_KEY];
  assert.equal(meta.pointer, true, '元数据应退化成指针');
  assert.equal(meta.round, world.round);
  const loaded = await store.load();
  assert.equal(loaded.name, world.name);
  assert.ok(loaded.regions.length > 0);
});

test('IndexedDB 写入失败时退回把世界写进元数据，不丢档', async () => {
  const context = { chatMetadata: {}, saveMetadata: async () => {}, chatId: 'chat-b', characterId: 'char-b' };
  const store = new WorldStore(() => context);
  store.db = {
    transaction() {
      const tx = { oncomplete: null, onerror: null, onabort: null };
      tx.objectStore = () => ({ put() { queueMicrotask(() => tx.onerror?.()); return {}; } });
      return tx;
    },
    error: new Error('quota'),
  };
  const world = createDemoWorld();
  await store.save(world);
  assert.ok(!context.chatMetadata[STORAGE_KEY].pointer, '写入失败时应保留完整存档');
  assert.ok(store.lastStorageError, '失败原因要留给诊断面板');
  assert.equal((await store.load()).name, world.name);
});

test('酒馆主 API 传的是 AbortController，外部取消能传到生成器', async () => {
  let received = null;
  const context = { generateRaw: (options) => { received = options; return Promise.resolve('{"ok":true}'); } };
  const api = new WorldAPI({ getContext: () => context, getSettings: () => ({ ...settings, connectionMode: 'st' }) });
  const controller = new AbortController();
  const pending = api.completeJson('hi', { signal: controller.signal });
  await Promise.resolve();
  assert.ok(received?.abortController instanceof AbortController, '必须是 AbortController 而不是 AbortSignal');
  controller.abort();
  assert.equal(received.abortController.signal.aborted, true, '取消信号应转接到 controller');
  await pending;
});

test('自定义接口 400 只在提示 JSON 模式不支持时重试', async () => {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push(JSON.parse(options.body));
    return { ok: false, status: 400, text: async () => '{"error":{"message":"invalid api key"}}' };
  };
  try {
    const api = new WorldAPI({
      getContext: () => ({}),
      getSettings: () => ({ ...settings, connectionMode: 'custom', customBaseUrl: 'https://api.example.com/v1', customModel: 'm', maxRetries: 0 }),
    });
    await assert.rejects(() => api.completeJson('hi'), /invalid api key/);
    assert.equal(calls.length, 1, '鉴权错误不该再发一次请求');
  } finally {
    globalThis.fetch = original;
  }
});

test('设置页渲染运行诊断记录', () => {
  const world = createDemoWorld();
  const html = renderSettings(settings, { kind: 'ready', message: '待命' }, world, [], [
    { kind: 'storage', message: 'IndexedDB 写入失败', at: Date.now() },
  ]);
  assert.ok(html.includes('运行诊断'));
  assert.ok(html.includes('IndexedDB 写入失败'));
  assert.ok(html.includes('data-fold-key="设置·运行诊断"'));
});

test('不同世界画出不同的水系，同一世界保持稳定', () => {
  const worldA = createDemoWorld();
  const worldB = createDemoWorld();
  worldB.name = '另一座城';
  worldB.seed = 'seed-b';
  const riverOf = (html) => html.match(/class="lw-atlas-river" d="([^"]+)"/)?.[1] || '';
  const a1 = riverOf(renderMap(worldA, null, {}, { seed: worldA.seed || 'a', regions: worldA.regions, path: [] }, 'atlas'));
  const a2 = riverOf(renderMap(worldA, null, {}, { seed: worldA.seed || 'a', regions: worldA.regions, path: [] }, 'atlas'));
  const b1 = riverOf(renderMap(worldB, null, {}, { seed: worldB.seed || 'b', regions: worldB.regions, path: [] }, 'atlas'));
  assert.ok(a1.length > 0 && b1.length > 0);
  assert.equal(a1, a2, '同一世界的地图必须稳定');
  assert.notEqual(a1, b1, '不同世界的水系不应完全一样');
});

test('就地修改的字段同时带拆开的 data 属性', () => {
  const world = createDemoWorld();
  const html = renderOverview(world);
  assert.ok(html.includes('data-lw-kind='));
  assert.ok(html.includes('data-lw-id='));
  assert.ok(html.includes('data-lw-path='));
});
