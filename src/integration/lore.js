import { DEFAULT_DAILY_PROMPT, DEFAULT_FESTIVAL_PROMPT } from '../engine/constants.js';
import { asArray } from '../engine/utils.js';

const MAX_ENTRY_CHARS = 1200;

function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeEntry(raw, index, origin) {
  const entry = raw && typeof raw === 'object' ? raw : {};
  const keys = asArray(entry.key ?? entry.keys ?? entry.keywords).map(text).filter(Boolean);
  const comment = text(entry.comment ?? entry.name ?? entry.title);
  const content = text(entry.content ?? entry.value ?? entry.text);
  return {
    uid: String(entry.uid ?? entry.id ?? index),
    origin,
    comment: comment || (keys.length ? keys.join(' / ') : `条目 ${index + 1}`),
    keys,
    content,
    enabled: entry.disable !== true && entry.enabled !== false,
    constant: entry.constant === true,
    order: Number(entry.order ?? entry.insertion_order ?? index) || 0,
  };
}

function entriesOf(book, origin) {
  const raw = book?.entries;
  const list = Array.isArray(raw) ? raw : Object.values(raw && typeof raw === 'object' ? raw : {});
  return list
    .map((entry, index) => normalizeEntry(entry, index, origin))
    .filter((entry) => entry.comment && entry.content);
}

function bookNameOf(book, fallback) {
  return text(book?.name ?? book?.id ?? book?.comment ?? fallback) || fallback;
}

function pushBook(catalog, book) {
  if (!book || !book.name) return;
  const existing = catalog.books.find((item) => item.name === book.name);
  if (existing) {
    if (book.entries.length > existing.entries.length) existing.entries = book.entries;
    if (book.origin === 'card') existing.origin = 'card';
    return;
  }
  catalog.books.push(book);
}

function cardBookOf(context) {
  const list = context?.characters || globalThis.characters || [];
  const id = context?.characterId ?? context?.this_chid ?? 0;
  const character = list?.[id] || list?.[Number(id)] || context?.character || globalThis.character || null;
  const data = character?.data || character || {};
  const book = data?.character_book || data?.characterBook || character?.character_book || null;
  if (!book) return null;
  return {
    name: bookNameOf(book, `${text(character?.name) || '角色卡'} · 角色世界书`),
    origin: 'card',
    entries: entriesOf(book, 'card'),
  };
}

function globalBookNameOf(context) {
  const candidates = [
    context?.chatMetadata?.world_info,
    context?.chat_metadata?.world_info,
    context?.world_info,
    globalThis.world_info,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/** 把各个酒馆版本暴露世界书的方式（对象 / 数组 / 单本）统一成一串书。 */
function collectWorldInfoBooks(context) {
  const sources = [context?.worldInfo, context?.world_info, globalThis.worldInfo, globalThis.world_info];
  const out = [];
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    if (Array.isArray(source)) {
      for (const item of source) {
        if (item && typeof item === 'object' && item.entries) out.push(item);
      }
      continue;
    }
    if (source.entries) {
      out.push(source);
      continue;
    }
    for (const [name, value] of Object.entries(source)) {
      if (value && typeof value === 'object' && value.entries) {
        out.push({ ...value, name: value.name || name });
      }
    }
  }
  return out;
}

async function requestHeaders() {
  try {
    const headers = globalThis.getRequestHeaders?.();
    if (headers && typeof headers === 'object') return headers;
  } catch {
    // 忽略：退回最小请求头
  }
  return { 'Content-Type': 'application/json' };
}

/** 从酒馆后端按名字取一本世界书；拿不到就返回 null，由界面提示「条目未知」。 */
export async function fetchWorldBook(name, context) {
  const bookName = text(name);
  if (!bookName) return null;
  try {
    if (typeof context?.getWorldInfo === 'function') {
      const direct = await context.getWorldInfo(bookName);
      if (direct?.entries) return direct;
    }
  } catch {
    // 继续尝试 HTTP 接口
  }
  try {
    const headers = await requestHeaders();
    const response = await fetch('/api/worldinfo/get', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: bookName }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (data?.entries) return data;
    if (data?.book?.entries) return data.book;
    return null;
  } catch {
    return null;
  }
}

export function createLoreCatalog() {
  return { books: [], fetchedAt: 0 };
}

/**
 * 读取「角色卡绑定书 + 全局书 + 用户额外添加的书」，条目级保留 uid/开关，
 * 供侧边栏逐条勾选注入。
 */
export async function loadLoreCatalog(context, settings = {}) {
  const catalog = createLoreCatalog();
  const card = cardBookOf(context);
  if (card) pushBook(catalog, card);

  const globalName = globalBookNameOf(context);
  const discovered = collectWorldInfoBooks(context);
  for (const book of discovered) {
    const name = bookNameOf(book, '世界书');
    const isGlobal = globalName ? name === globalName : discovered.length === 1;
    pushBook(catalog, {
      name,
      origin: isGlobal ? 'global' : 'other',
      entries: entriesOf(book, isGlobal ? 'global' : 'other'),
    });
  }

  // 全局书在酒馆里通常只以书名出现在聊天元数据里，正文要按名字回后端取。
  if (globalName && !catalog.books.some((book) => book.name === globalName)) {
    const globalBook = await fetchWorldBook(globalName, context);
    pushBook(catalog, {
      name: globalName,
      origin: 'global',
      entries: globalBook ? entriesOf(globalBook, 'global') : [],
    });
  }

  for (const name of asArray(settings.loreBooks).map(text).filter(Boolean)) {
    if (catalog.books.some((book) => book.name === name)) continue;
    const book = await fetchWorldBook(name, context);
    pushBook(catalog, {
      name,
      origin: 'extra',
      entries: book ? entriesOf(book, 'extra') : [],
    });
  }

  catalog.fetchedAt = Date.now();
  return catalog;
}

export function isBookInjected(book, settings = {}) {
  if (!book) return false;
  if (settings.loreEnabled === false) return false;
  if (book.origin === 'card') return settings.loreIncludeCard !== false;
  if (book.origin === 'global') return settings.loreIncludeGlobal !== false;
  return asArray(settings.loreBooks).map(text).includes(book.name);
}

/** null 表示这本没有做过条目级筛选，默认全部启用。 */
export function selectedEntryIds(settings = {}, bookName) {
  const value = settings.loreSelection?.[bookName];
  if (!Array.isArray(value)) return null;
  return value.map(String);
}

export function entriesForBook(book, settings = {}) {
  if (!book) return [];
  const picked = selectedEntryIds(settings, book.name);
  const active = asArray(book.entries).filter((entry) => entry.enabled);
  if (picked === null) return active;
  return active.filter((entry) => picked.includes(String(entry.uid)));
}

/** 拼成注入正文用的世界书摘要。空目录或全部关闭时返回空串。 */
export function compileLoreDigest(catalog, settings = {}, maxChars = 6000) {
  const books = asArray(catalog?.books);
  if (!books.length) return '';
  const lines = [];
  let used = 0;
  for (const book of books) {
    if (!isBookInjected(book, settings)) continue;
    const entries = entriesForBook(book, settings).sort((a, b) => a.order - b.order);
    if (!entries.length) continue;
    const header = `《${book.name}》`;
    if (used + header.length > maxChars) break;
    lines.push(header);
    used += header.length + 1;
    for (const entry of entries) {
      const line = `${entry.comment}：${entry.content.slice(0, MAX_ENTRY_CHARS)}`;
      if (used + line.length > maxChars) break;
      lines.push(line);
      used += line.length + 1;
    }
  }
  return lines.join('\n').slice(0, maxChars);
}

/** 日常 / 节庆提示词：留空回落内置默认值，保证界面「可看」。 */
export function dailyPromptOf(settings = {}) {
  return text(settings.dailyPrompt) || DEFAULT_DAILY_PROMPT;
}

export function festivalPromptOf(settings = {}) {
  return text(settings.festivalPrompt) || DEFAULT_FESTIVAL_PROMPT;
}
