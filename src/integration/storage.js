import { CHECKPOINT_KEY, SCHEMA_VERSION, STORAGE_KEY } from '../engine/constants.js';
import { normalizeWorld } from '../engine/state.js';
import { deepClone, safeJsonParse } from '../engine/utils.js';

const DB_NAME = 'living_world_engine';
const STORE_NAME = 'kv';
const LAST_TURN_KEY = 'living_world_last_turn';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function selectBaseline(checkpoints, chat) {
  const list = Array.isArray(checkpoints) ? [...checkpoints].sort((a, b) => a.messageIndex - b.messageIndex) : [];
  const messages = Array.isArray(chat) ? chat : [];
  const last = messages.at(-1);
  const targetIndex = last && !last.is_user ? messages.length - 1 : messages.length;
  const previous = list.filter((checkpoint) => checkpoint.messageIndex < targetIndex).at(-1);
  if (previous) return deepClone(previous.state);
  const first = list.find((checkpoint) => checkpoint.messageIndex === targetIndex);
  return first?.before ? deepClone(first.before) : null;
}

export function selectRollback(checkpoints, chat) {
  const list = Array.isArray(checkpoints) ? [...checkpoints].sort((a, b) => a.messageIndex - b.messageIndex) : [];
  const messageCount = Array.isArray(chat) ? chat.length : 0;
  const latest = list.at(-1);
  if (!latest || latest.messageIndex < messageCount) return null;
  const visible = list.filter((checkpoint) => checkpoint.messageIndex < messageCount).at(-1);
  if (visible) return deepClone(visible.state);
  return list[0]?.before ? deepClone(list[0].before) : null;
}

export class WorldStore {
  constructor(getContext) {
    this.getContext = getContext;
    this.db = null;
    this.memory = new Map();
  }

  async hydrate() {
    try {
      this.db = await openDatabase();
    } catch {
      this.db = null;
    }
  }

  chatKey() {
    const context = this.getContext();
    const chatId = context?.getCurrentChatId?.() || context?.chatId || context?.chatMetadata?.chat_id || 'current';
    const owner = context?.groupId ? `group_${context.groupId}` : `character_${context?.characterId ?? 'none'}`;
    return `${owner}:${chatId}`;
  }

  async idbGet(key) {
    if (!this.db) return this.memory.get(key) || null;
    return new Promise((resolve) => {
      const request = this.db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  }

  async idbSet(key, value) {
    this.memory.set(key, value);
    if (!this.db) return;
    try {
      this.db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(value, key);
    } catch {
      this.memory.set(key, value);
    }
  }

  async load() {
    const context = this.getContext();
    const metadata = context?.chatMetadata || {};
    let raw = metadata[STORAGE_KEY];
    if (!raw) raw = await this.idbGet(`${this.chatKey()}:state`);
    if (!raw) return null;
    try {
      const parsed = typeof raw === 'string' ? safeJsonParse(raw) : raw;
      if (!parsed || (parsed.schemaVersion || 1) > SCHEMA_VERSION) throw new Error('存档版本过新');
      return normalizeWorld(parsed);
    } catch {
      return null;
    }
  }

  async save(state) {
    const context = this.getContext();
    const snapshot = deepClone(state);
    if (context?.chatMetadata) {
      context.chatMetadata[STORAGE_KEY] = snapshot;
      await context.saveMetadata?.();
    }
    await this.idbSet(`${this.chatKey()}:state`, snapshot);
  }

  checkpoints() {
    return this.getContext()?.chatMetadata?.[CHECKPOINT_KEY] || [];
  }

  async saveCheckpoint(messageIndex, turnKey, before, state) {
    const context = this.getContext();
    if (!context?.chatMetadata) return;
    const checkpoints = [...this.checkpoints().filter((checkpoint) => checkpoint.messageIndex !== messageIndex), {
      messageIndex, turnKey, before: deepClone(before), state: deepClone(state), savedAt: Date.now(),
    }].sort((a, b) => a.messageIndex - b.messageIndex).slice(-10);
    context.chatMetadata[CHECKPOINT_KEY] = checkpoints;
    context.chatMetadata[LAST_TURN_KEY] = turnKey;
    await context.saveMetadata?.();
    await this.idbSet(`${this.chatKey()}:checkpoint:${messageIndex}`, { messageIndex, turnKey, state: deepClone(state) });
  }

  lastTurn() {
    return this.getContext()?.chatMetadata?.[LAST_TURN_KEY] || '';
  }

  async clear() {
    const context = this.getContext();
    if (context?.chatMetadata) {
      delete context.chatMetadata[STORAGE_KEY];
      delete context.chatMetadata[CHECKPOINT_KEY];
      delete context.chatMetadata[LAST_TURN_KEY];
      await context.saveMetadata?.();
    }
    await this.idbSet(`${this.chatKey()}:state`, null);
  }
}
