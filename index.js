import { CHECKPOINT_KEY, DEFAULT_SETTINGS, SETTINGS_KEY, PROMPT_KEY } from './src/engine/constants.js';
import { buildBootstrapPrompt, buildEvolutionPrompt } from './src/engine/director.js';
import { createWorldFromBootstrap, normalizeWorld, addLog } from './src/engine/state.js';
import { evolveWorld } from './src/engine/simulation.js';
import { deepClone, downloadJson, hashString, safeJsonParse } from './src/engine/utils.js';
import { WorldAPI } from './src/integration/api.js';
import { buildWorldContext, extractRecentConversation } from './src/integration/context.js';
import { selectBaseline, selectRollback, WorldStore } from './src/integration/storage.js';
import { LivingWorldPanel } from './src/ui/panel.js';

let controller = null;

globalThis.livingWorldGenerateInterceptor = async function(chat, contextSize, abort, type) {
  return controller?.prepareGeneration(chat, contextSize, abort, type);
};

class LivingWorldController {
  constructor() {
    this.context = () => SillyTavern.getContext();
    this.store = new WorldStore(this.context);
    this.api = new WorldAPI({ getContext: this.context, getSettings: () => this.getSettings() });
    this.world = null;
    this.status = { kind: 'idle', message: '等待世界初始化' };
    this.generationBaseline = null;
    this.evolutionPromise = null;
    this.abortController = null;
    this.chatToken = 0;
    this.initialized = false;
    this.panel = new LivingWorldPanel({
      onInitialize: () => this.initializeWorld(),
      onEvolve: () => this.world ? this.evolve({ manual: true }) : this.initializeWorld(),
      onSettingsChange: (settings) => this.updateSettings(settings),
      onExport: () => this.exportWorld(),
      onImport: (raw) => this.importWorld(raw),
      onReset: () => this.resetWorld(),
      onTestApi: () => this.testApi(),
    });
  }

  getSettings() {
    const context = this.context();
    if (!context.extensionSettings[SETTINGS_KEY]) context.extensionSettings[SETTINGS_KEY] = {};
    const settings = context.extensionSettings[SETTINGS_KEY];
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      if (!Object.hasOwn(settings, key)) settings[key] = value;
    }
    return settings;
  }

  async initialize() {
    if (this.initialized) return;
    this.initialized = true;
    this.getSettings();
    await this.store.hydrate();
    this.panel.mount();
    this.panel.setData({ settings: this.getSettings(), status: this.status });
    const { eventSource, event_types } = this.context();
    eventSource.on(event_types.GENERATION_ENDED, () => this.handleGenerationEnded());
    eventSource.on(event_types.CHAT_CHANGED || event_types.CHAT_LOADED, () => this.loadChat());
    eventSource.on(event_types.MESSAGE_DELETED, () => setTimeout(() => this.handleMessageDeleted(), 0));
    eventSource.on(event_types.MESSAGE_SWIPED, () => { this.generationBaseline = null; });
    await this.loadChat();
  }

  async loadChat() {
    const token = ++this.chatToken;
    this.abortController?.abort();
    this.abortController = null;
    this.evolutionPromise = null;
    this.generationBaseline = null;
    const world = await this.store.load();
    if (token !== this.chatToken) return;
    this.world = world;
    this.status = { kind: 'idle', message: world ? '已载入当前聊天世界' : '当前聊天尚未建立世界' };
    this.panel.setData({ world: this.world, settings: this.getSettings(), status: this.status });
    this.refreshInjection();
  }

  setStatus(kind, message) {
    this.status = { kind, message };
    this.panel.setStatus(this.status);
  }

  refreshInjection() {
    const context = this.context();
    if (!context.setExtensionPrompt) return;
    const settings = this.getSettings();
    const value = this.world ? buildWorldContext(this.world, {
      maxChars: settings.injectMaxChars,
      includeSecrets: settings.includeSecrets,
    }) : '';
    context.setExtensionPrompt(PROMPT_KEY, value, 1, 2, false, 0);
  }

  buildMaterial() {
    const context = this.context();
    const character = context.characters?.[context.characterId];
    const data = character?.data || character || {};
    return JSON.stringify({
      character: {
        name: data.name || character?.name || '',
        description: data.description || '',
        personality: data.personality || '',
        scenario: data.scenario || '',
        firstMessage: data.first_mes || '',
        creatorNotes: data.creator_notes || '',
      },
      group: context.groups?.[context.groupId]?.name || '',
      recentConversation: extractRecentConversation(context.chat, 14, 18000),
    }, null, 2);
  }

  async initializeWorld() {
    if (this.evolutionPromise) return this.evolutionPromise;
    const token = this.chatToken;
    const task = (async () => {
      this.setStatus('running', '正在从角色卡建立地图、势力与人物');
      try {
        this.abortController = new AbortController();
        const bootstrap = await this.api.completeJson(buildBootstrapPrompt(this.buildMaterial(), this.getSettings()), {
          signal: this.abortController.signal,
          systemPrompt: '你是通用世界设定架构师。只输出符合要求的合法 JSON，不写正文。',
        });
        if (token !== this.chatToken) return null;
        const world = createWorldFromBootstrap(bootstrap, {
          coreNpcLimit: this.getSettings().coreNpcLimit,
          seed: hashString(`${this.store.chatKey()}:${Date.now()}`),
        });
        addLog(world, { type: 'world', title: '世界模拟开始', detail: '地图、势力与核心人物已经建立，后续行动将由意图与骰子共同结算。' });
        await this.store.clear();
        this.world = world;
        await this.store.save(world);
        this.panel.activeTab = 'overview';
        this.panel.selectedRegionId = world.player.regionId;
        this.panel.selectedFactionId = world.factions[0]?.id;
        this.setStatus('ready', `已建立 ${world.npcs.length} 名人物与 ${world.regions.length} 个区域`);
        this.panel.setData({ world, settings: this.getSettings(), status: this.status });
        this.refreshInjection();
        this.panel.notify('世界初始化完成，可以开始正常扮演', 'success');
        return world;
      } catch (error) {
        if (token === this.chatToken && error?.name !== 'AbortError') {
          this.setStatus('error', error.message);
          this.panel.notify(`初始化失败：${error.message}`, 'error');
        }
        return null;
      } finally {
        this.abortController = null;
      }
    })();
    this.evolutionPromise = task;
    try {
      return await task;
    } finally {
      this.evolutionPromise = null;
    }
  }

  async prepareGeneration(_chat, _contextSize, _abort, type) {
    if (type === 'quiet') return;
    if (this.evolutionPromise) {
      try { await this.evolutionPromise; } catch { /* 状态栏已显示错误 */ }
    }
    let baseline = selectBaseline(this.store.checkpoints(), this.context().chat);
    if (!baseline) baseline = this.world;
    this.generationBaseline = {
      chatKey: this.store.chatKey(),
      world: deepClone(baseline),
      type: type || 'normal',
    };
    this.refreshInjection();
  }

  async handleGenerationEnded() {
    const settings = this.getSettings();
    if (!settings.autoEvolve || this.generationBaseline?.type === 'continue') return;
    const context = this.context();
    const chat = context.chat || [];
    const last = chat.at(-1);
    if (!last || last.is_user) return;
    const messageIndex = chat.length - 1;
    const turnKey = hashString(`${this.store.chatKey()}:${messageIndex}:${last.swipe_id || 0}:${last.mes || ''}`);
    if (this.store.lastTurn() === turnKey) return;
    let baseline = this.generationBaseline?.chatKey === this.store.chatKey()
      ? this.generationBaseline.world
      : selectBaseline(this.store.checkpoints(), chat) || this.world;
    if (!baseline) {
      if (!settings.autoBootstrap) return;
      baseline = await this.initializeWorld();
      if (!baseline) return;
    }
    await this.evolve({ baseline, turnKey, messageIndex, manual: false });
  }

  async evolve({ baseline, turnKey, messageIndex, manual }) {
    if (this.evolutionPromise) return this.evolutionPromise;
    const token = this.chatToken;
    const chatKey = this.store.chatKey();
    const before = deepClone(baseline || this.world);
    if (!before) return null;
    const task = (async () => {
      this.setStatus('running', `正在推演第 ${before.round + 1} 轮世界`);
      let proposal;
      let warning = '';
      try {
        this.abortController = new AbortController();
        const conversation = extractRecentConversation(this.context().chat);
        proposal = await this.api.completeJson(buildEvolutionPrompt(before, conversation), {
          signal: this.abortController.signal,
          systemPrompt: '你是多主体世界的意图导演。只输出合法 JSON，不判定行动结果。',
        });
      } catch (error) {
        if (error?.name === 'AbortError' || token !== this.chatToken) return null;
        proposal = {};
        warning = `API 未完成，本轮使用本地意图：${error.message}`;
      }
      if (token !== this.chatToken || chatKey !== this.store.chatKey()) return null;
      const world = evolveWorld(before, proposal, this.getSettings());
      world.lastEvolution.turnKey = turnKey || `manual_${Date.now()}`;
      world.lastEvolution.messageIndex = Number.isInteger(messageIndex) ? messageIndex : (this.context().chat || []).length - 1;
      world.lastEvolution.manual = Boolean(manual);
      this.world = world;
      await this.store.save(world);
      if (!manual && Number.isInteger(messageIndex)) {
        await this.store.saveCheckpoint(messageIndex, turnKey, before, world);
      }
      this.setStatus(warning ? 'error' : 'ready', warning || `第 ${world.round} 轮完成：${world.lastEvolution.diceRolls} 次判定`);
      this.panel.setData({ world, settings: this.getSettings(), status: this.status });
      this.refreshInjection();
      this.panel.notify(warning || `第 ${world.round} 轮世界推演完成`, warning ? 'error' : 'success');
      return world;
    })();
    this.evolutionPromise = task;
    try {
      return await task;
    } catch (error) {
      if (token === this.chatToken) {
        this.setStatus('error', error.message);
        this.panel.notify(`推演失败：${error.message}`, 'error');
      }
      return null;
    } finally {
      this.abortController = null;
      this.evolutionPromise = null;
      this.generationBaseline = null;
    }
  }

  async handleMessageDeleted() {
    const rollback = selectRollback(this.store.checkpoints(), this.context().chat || []);
    if (!rollback) return;
    const count = (this.context().chat || []).length;
    const metadata = this.context().chatMetadata;
    metadata[CHECKPOINT_KEY] = this.store.checkpoints().filter((checkpoint) => checkpoint.messageIndex < count);
    await this.context().saveMetadata?.();
    this.world = rollback;
    await this.store.save(rollback);
    this.panel.setData({ world: rollback, settings: this.getSettings(), status: { kind: 'ready', message: '已回滚到可见楼层对应的世界' } });
    this.refreshInjection();
    this.panel.notify('已恢复删除楼层之前的世界状态', 'success');
  }

  async updateSettings(settings) {
    Object.assign(this.getSettings(), settings);
    await this.context().saveSettingsDebounced?.();
    this.panel.setData({ world: this.world, settings: this.getSettings(), status: { kind: this.status.kind, message: '设置已保存' } });
    this.refreshInjection();
    this.panel.notify('设置已保存', 'success');
  }

  async exportWorld() {
    if (!this.world) return this.panel.notify('当前没有可导出的世界', 'error');
    downloadJson(`LivingWorld-${this.world.name}-R${this.world.round}.json`, this.world);
    this.panel.notify('世界存档已导出，不包含 API Key', 'success');
  }

  async importWorld(raw) {
    try {
      const parsed = safeJsonParse(raw);
      const world = normalizeWorld(parsed, { coreNpcLimit: this.getSettings().coreNpcLimit });
      await this.store.clear();
      this.world = world;
      await this.store.save(world);
      this.panel.setData({ world, settings: this.getSettings(), status: { kind: 'ready', message: '世界导入完成' } });
      this.refreshInjection();
      this.panel.notify('世界存档导入完成', 'success');
    } catch (error) {
      this.panel.notify(`导入失败：${error.message}`, 'error');
    }
  }

  async resetWorld() {
    this.chatToken += 1;
    this.abortController?.abort();
    this.evolutionPromise = null;
    await this.store.clear();
    this.world = null;
    this.generationBaseline = null;
    this.refreshInjection();
    this.panel.setData({ world: null, settings: this.getSettings(), status: { kind: 'idle', message: '世界已清除' } });
    this.panel.notify('当前聊天的世界已清除', 'success');
  }

  async testApi() {
    this.setStatus('running', '正在测试后台 API');
    try {
      await this.api.testConnection();
      this.setStatus('ready', 'API 连接正常');
      this.panel.notify('API 连接与 JSON 返回正常', 'success');
    } catch (error) {
      this.setStatus('error', error.message);
      this.panel.notify(`API 测试失败：${error.message}`, 'error');
    }
  }
}

function boot() {
  if (!controller) controller = new LivingWorldController();
  controller.initialize();
}

const context = SillyTavern.getContext();
context.eventSource.on(context.event_types.APP_READY, boot);
