import { CHECKPOINT_KEY, SCHEMA_VERSION, STORAGE_KEY } from '../engine/constants.js';
import { isNewerThanSupported, migrateCheckpoints, migrateWorld } from '../engine/migrations.js';
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
    this.lastMigration = null;
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

  /**
   * 写 IndexedDB。put() 立即返回、事务完成才算写完，异步错误也进不了 try/catch，
   * 所以这里等 oncomplete 再算成功，并把失败原因留给诊断面板。
   */
  async idbSet(key, value) {
    this.memory.set(key, value);
    if (!this.db) return false;
    try {
      await new Promise((resolve, reject) => {
        const tx = this.db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('IndexedDB 写入失败'));
        tx.onabort = () => reject(tx.error || new Error('IndexedDB 写入被中断'));
      });
      return true;
    } catch (error) {
      this.lastStorageError = error?.message || String(error);
      return false;
    }
  }

  async load() {
    const context = this.getContext();
    const metadata = context?.chatMetadata || {};
    let raw = metadata[STORAGE_KEY];
    const isPointer = raw && typeof raw === 'object' && raw.pointer === true;
    if (!raw || isPointer) raw = await this.idbGet(`${this.chatKey()}:state`);
    if (!raw) return null;
    try {
      const parsed = typeof raw === 'string' ? safeJsonParse(raw) : raw;
      if (!parsed) return null;
      if (isNewerThanSupported(parsed)) throw new Error('存档版本过新');
      const migration = migrateWorld(parsed);
      const world = normalizeWorld(migration.world);
      if (migration.migrated) {
        this.lastMigration = { from: migration.fromVersion, to: migration.toVersion };
        await this.save(world);
      }
      return world;
    } catch {
      return null;
    }
  }

  async save(state) {
    const context = this.getContext();
    const snapshot = deepClone(state);
    const stored = await this.idbSet(`${this.chatKey()}:state`, snapshot);
    if (!context?.chatMetadata) return;
    // 世界本体（含上百背景 NPC）只留在 IndexedDB，聊天元数据里放一个指针，
    // 否则每存一次都要把整份世界写进聊天存档。IDB 写失败时才退回旧做法，避免丢档。
    context.chatMetadata[STORAGE_KEY] = stored
      ? { pointer: true, version: snapshot.version, round: snapshot.round, savedAt: new Date().toISOString() }
      : snapshot;
    await context.saveMetadata?.();
  }

  checkpoints() {
    const raw = this.getContext()?.chatMetadata?.[CHECKPOINT_KEY] || [];
    // 检查点里也存着世界状态：老存档的回滚必须能读，所以这里同样走迁移。
    return migrateCheckpoints(raw);
  }

  /** 最近一次推演的检查点，重 roll 用它回到推演之前。 */
  latestCheckpoint() {
    return this.checkpoints().at(-1) || null;
  }

  async saveCheckpoint(messageIndex, turnKey, before, state, extras = {}) {
    const context = this.getContext();
    if (!context?.chatMetadata) return;
    const checkpoints = [...this.checkpoints().filter((checkpoint) => checkpoint.messageIndex !== messageIndex), {
      messageIndex,
      turnKey,
      before: deepClone(before),
      state: deepClone(state),
      proposal: extras.proposal ? deepClone(extras.proposal) : null,
      rerollCount: Math.max(0, Number(extras.rerollCount) || 0),
      savedAt: Date.now(),
    }].sort((a, b) => a.messageIndex - b.messageIndex).slice(-10);
    context.chatMetadata[CHECKPOINT_KEY] = checkpoints;
    context.chatMetadata[LAST_TURN_KEY] = turnKey;
    await context.saveMetadata?.();
    await this.idbSet(`${this.chatKey()}:checkpoint:${messageIndex}`, { messageIndex, turnKey, state: deepClone(state) });
  }

  lastTurn() {
    return this.getContext()?.chatMetadata?.[LAST_TURN_KEY] || '';
  }

  /** 撤销推演后让同一条消息可以重新自动推演。 */
  async forgetLastTurn() {
    const context = this.getContext();
    if (!context?.chatMetadata) return;
    delete context.chatMetadata[LAST_TURN_KEY];
    await context.saveMetadata?.();
  }

  /** 丢掉最近一个检查点（边缘回合被撤销时用）。 */
  async dropCheckpoint(messageIndex) {
    const context = this.getContext();
    if (!context?.chatMetadata) return;
    context.chatMetadata[CHECKPOINT_KEY] = this.checkpoints().filter((checkpoint) => checkpoint.messageIndex !== messageIndex);
    await context.saveMetadata?.();
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
