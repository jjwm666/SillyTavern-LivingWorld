import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_SETTINGS } from '../src/engine/constants.js';
import {
  compileLoreDigest,
  createLoreCatalog,
  entriesForBook,
  isBookInjected,
  loadLoreCatalog,
  selectedEntryIds,
} from '../src/integration/lore.js';
import { chatSnapshotSize, forgetChat, readChat, rememberChat } from '../src/integration/context.js';
import { renderLore } from '../src/ui/views.js';

const cardContext = () => ({
  characterId: 0,
  characters: [{
    name: '雾港守夜人',
    data: {
      character_book: {
        name: '雾港设定集',
        entries: [
          { uid: 1, comment: '旧码头', content: '旧码头在城西，夜里只有卸货的苦力。' },
          { uid: 2, comment: '潮汐公会', content: '船工公会握着潮汐表。', disable: true },
          { uid: 3, comment: '灯塔', content: '灯塔由七家轮流值守。' },
        ],
      },
    },
  }],
  chatMetadata: { world_info: '大陆总览' },
});

test('世界书目录合并角色卡书、全局书与其他书，并保留条目编号', async () => {
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push([url, JSON.parse(options.body).name]);
    return {
      ok: true,
      json: async () => ({ entries: [{ uid: `g-${calls.length}`, comment: '王都', content: '王都建在高原上。' }] }),
    };
  };
  try {
    const context = cardContext();
    const catalog = await loadLoreCatalog(context, { loreBooks: ['北境补充设定'] });
    assert.equal(catalog.books.length, 3, '角色卡书、全局书、额外书各一本');
    const [card, global, extra] = catalog.books;
    assert.equal(card.origin, 'card');
    assert.equal(global.name, '大陆总览');
    assert.equal(global.origin, 'global');
    assert.equal(extra.name, '北境补充设定');
    assert.equal(extra.origin, 'extra');
    assert.equal(calls.length, 2, '全局书与额外书都按书名回后端取');
    assert.deepEqual(card.entries.map((entry) => entry.uid), ['1', '2', '3']);
    assert.equal(card.entries[1].enabled, false, 'disable 条目保留但默认不启用');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('注入开关按来源生效，条目选择可逐条收窄摘要', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false });
  try {
    const catalog = await loadLoreCatalog(cardContext(), { loreBooks: [] });
    const [card, global] = catalog.books;
    const settings = { ...DEFAULT_SETTINGS };
    assert.equal(isBookInjected(card, settings), true, '默认注入角色卡绑定书');
    assert.equal(isBookInjected(global, settings), true, '默认注入全局世界书');
    assert.equal(isBookInjected(global, { ...settings, loreIncludeGlobal: false }), false);
    assert.equal(isBookInjected(card, { ...settings, loreEnabled: false }), false, '总开关关闭后全部不注入');

    const all = compileLoreDigest(catalog, settings);
    assert.ok(all.includes('《雾港设定集》'));
    assert.ok(all.includes('旧码头：旧码头在城西'));
    assert.ok(!all.includes('船工公会'), '禁用条目不进摘要');

    const narrowed = { ...settings, loreSelection: { 雾港设定集: ['3'] } };
    assert.deepEqual(selectedEntryIds(narrowed, '雾港设定集'), ['3']);
    assert.equal(entriesForBook(card, narrowed).length, 1);
    const partial = compileLoreDigest(catalog, narrowed);
    assert.ok(partial.includes('灯塔'));
    assert.ok(!partial.includes('旧码头：'));
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('生成拦截器里的正文会被记住，作为读不到上下文时的兜底', () => {
  const messages = [{ is_user: true, mes: '夜里我去码头。' }, { is_user: false, mes: '潮水退得很低。' }];
  assert.equal(readChat({}).length, 0);
  rememberChat(messages);
  assert.equal(chatSnapshotSize(), 2);
  assert.deepEqual(readChat({}), messages);
  assert.deepEqual(readChat({ chat: [] }), messages, '上下文里是空数组时也回落到拦截器快照');
  forgetChat();
  assert.equal(readChat({}).length, 0);
});

test('世界书页能渲染注入开关、条目与日常节庆区', () => {
  const catalog = createLoreCatalog();
  catalog.books = [
    {
      name: '雾港设定集',
      origin: 'card',
      entries: [
        { uid: '1', origin: 'card', comment: '旧码头', keys: [], content: '旧码头在城西。', enabled: true, constant: false, order: 0 },
        { uid: '2', origin: 'card', comment: '灯塔', keys: [], content: '灯塔由七家轮流值守。', enabled: true, constant: false, order: 1 },
      ],
    },
  ];
  const world = {
    festivals: [{ name: '雾灯节', month: 3, day: 15, description: '全城点灯。', origin: 'worldbook' }],
    logs: [{ round: 2, public: true, type: 'daily', title: '市集早开', detail: '鱼贩先到了。' }],
  };
  const html = renderLore(world, { ...DEFAULT_SETTINGS, customFestivals: '潮生祭|8-2|放灯船' }, catalog, { message: '待命' });
  assert.ok(html.includes('id="lw-lore-form"'), '应有独立的保存表单');
  assert.ok(html.includes('data-lw-action="lore-load"'), '应提供重新读取');
  assert.ok(html.includes('data-lw-action="lore-book-toggle"'), '书名可切换注入');
  assert.ok(html.includes('data-lw-action="lore-entry-toggle"'), '条目可逐条勾选');
  assert.ok(html.includes('data-lw-action="lore-generate-prompt"'), '生成按钮应接入 API');
  assert.ok(html.includes('data-lw-action="lore-save-preset"'), '生成结果可另存为提示词预设');
  assert.ok(html.includes('角色卡绑定'), '标注世界书来源');
  assert.ok(html.includes('雾灯节') && html.includes('潮生祭'), '世界书节庆与自定义节庆都要出现');
  assert.ok(html.includes('市集早开'), '日常记录应展示');
  assert.ok(html.includes('lw-lore-side-card'), '侧栏保留生成与说明卡');
});

test('推送菜单不再被内容层盖住，地图与水系样式齐全', async () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const header = /\.lw-header \{([^}]*)\}/.exec(css);
  assert.ok(header, '应有 .lw-header 规则');
  assert.match(header[1], /position: relative/, '顶栏需建立定位上下文');
  assert.match(header[1], /z-index: 30/, '顶栏层级要高于内容区');
  assert.match(css, /\.lw-run-menu \{[^}]*z-index: 40/, '菜单层级需高于顶栏');
  for (const rule of ['.lw-atlas-sea', '.lw-atlas-river', '.lw-atlas-title', '.lw-atlas-lane', '.lw-atlas-park']) {
    assert.ok(css.includes(rule), `应有 ${rule} 样式`);
  }
});
