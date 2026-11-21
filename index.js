import { CHECKPOINT_KEY, DEFAULT_SETTINGS, SETTINGS_KEY, PROMPT_KEY } from './src/engine/constants.js';
import { buildBootstrapPrompt, buildEvolutionPrompt } from './src/engine/director.js';
import { createWorldFromBootstrap, normalizeWorld, addLog } from './src/engine/state.js';
import { isNewerThanSupported, migrateWorld } from './src/engine/migrations.js';
import { applyWorldEdit } from './src/engine/edits.js';
import { evolveWorld } from './src/engine/simulation.js';
import { deepClone, downloadJson, hashString, safeJsonParse } from './src/engine/utils.js';
import { WorldAPI } from './src/integration/api.js';
import { buildWorldContext, extractRecentConversation, lastChatSource, readChat, rememberChat } from './src/integration/context.js';
import { compileLoreDigest, createLoreCatalog, dailyPromptOf, festivalPromptOf, loadLoreCatalog } from './src/integration/lore.js';
import { selectBaseline, selectRollback, WorldStore } from './src/integration/storage.js';
import { LivingWorldPanel } from './src/ui/panel.js';

let controller = null;

/** 世界书摘要：派系名、节庆与地方称呼往往只写在世界书里，必须让世界模型看到。 */
function worldbookDigest(context, maxChars = 6000) {
  const names = context?.worldInfo || context?.world_info;
  const entries = Array.isArray(names)
    ? names
    : Object.values(names || {});
  const chunks = [];
  for (const entry of entries) {
    if (!entry || entry.disable) continue;
    const content = String(entry.content || entry.value || '').replace(/\s+/g, ' ').trim();
    if (!content) continue;
    const label = String(entry.comment || entry.key || entry.keys?.join('/') || '');
    chunks.push(label ? `${label}：${content}` : content);
    if (chunks.join('\n').length > maxChars) break;
  }
  return chunks.join('\n').slice(0, maxChars);
}

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
    this.chatReadWarningShown = false;
    this.loreCatalog = createLoreCatalog();
    this.loreTask = null;
    this.diagnostics = [];
    this.panel = new LivingWorldPanel({
      onInitialize: () => this.initializeWorld(),
      onEvolve: () => this.world ? this.evolve({ manual: true }) : this.initializeWorld(),
      onSettingsChange: (settings) => this.updateSettings(settings),
      onExport: () => this.exportWorld(),
      onImport: (raw) => this.importWorld(raw),
      onEditWorld: (raw) => this.editWorld(raw),
      onEditField: (payload) => this.editWorldField(payload),
      onRerollTurn: (mode) => this.rerollTurn(mode),
      onDiscardEvolution: () => this.discardEvolution(),
      onRollbackTurn: () => this.rollbackTurn(),
      onTogglePin: (kind, id) => this.togglePinned(kind, id),
      onReset: () => this.resetWorld(),
      onTestApi: () => this.testApi(),
      onCancelEvolution: () => this.cancelEvolution(),
      onFetchModels: (patch) => this.fetchModels(patch),
      onLoadLore: () => this.loadLore(),
      onLoreSettingsChange: (patch) => this.updateSettings(patch),
      onGenerateLorePrompt: (payload) => this.generateLorePrompt(payload),
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
    this.installMenuEntry();
    this.panel.setData({ settings: this.getSettings(), status: this.status });
    const { eventSource, event_types } = this.context();
    eventSource.on(event_types.GENERATION_ENDED, () => this.handleGenerationEnded());
    // CHAT_CHANGED 与 CHAT_LOADED 都要挂：酒馆不同版本只会触发其中一个，
    // 用 `a || b` 只会挂上先存在的那个。两次触发时靠 50ms 合并 + token 去重。
    let reloadTimer = null;
    const reloadChat = () => {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => this.loadChat(), 50);
    };
    for (const name of ['CHAT_CHANGED', 'CHAT_LOADED']) {
      if (event_types[name]) eventSource.on(event_types[name], reloadChat);
    }
    eventSource.on(event_types.MESSAGE_DELETED, () => setTimeout(() => this.handleMessageDeleted(), 0));
    eventSource.on(event_types.MESSAGE_SWIPED, () => { this.generationBaseline = null; });
    await this.loadChat();
  }

  installMenuEntry() {
    if (document.querySelector('#living_world_menu_button')) return;
    const menu = document.querySelector('#options .options-content') || document.querySelector('#options');
    if (!menu) return;
    const entry = document.createElement('a');
    entry.id = 'living_world_menu_button';
    entry.href = '#';
    entry.innerHTML = '<i class="fa-solid fa-earth-asia"></i><span>万象世界引擎</span>';
    entry.addEventListener('click', (event) => {
      event.preventDefault();
      const options = document.querySelector('#options');
      if (options) options.style.display = 'none';
      this.panel.open();
    });
    menu.appendChild(entry);
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
    const migration = this.store.lastMigration;
    this.store.lastMigration = null;
    if (world && migration) {
      this.status = { kind: 'ready', message: `旧存档已从 v${migration.from} 迁移到 v${migration.to}` };
    }
    this.panel.setData({ world: this.world, settings: this.getSettings(), status: this.status });
    this.panel.setDiagnostics?.(this.diagnostics);
    if (this.store.lastStorageError) this.recordDiagnostic('storage', this.store.lastStorageError);
    this.refreshInjection();
    // 世界书条目是异步的（可能要向后端按名字取），先注入现有内容，读完再补一次。
    this.loadLore().then(() => this.refreshInjection()).catch(() => {});
    if (world && migration) this.announce(`旧存档已自动迁移到 v${migration.to}，原数据保持不变`, 'info');
  }

  setStatus(kind, message) {
    this.status = { kind, message };
    this.panel.setStatus(this.status);
    if (kind === 'error') this.recordDiagnostic('error', message);
  }

  /** 最近 20 条错误与异常来源，设置页的「运行诊断」直接读它。 */
  recordDiagnostic(kind, message) {
    this.diagnostics = [
      { kind, message: String(message || '').slice(0, 300), at: Date.now() },
      ...this.diagnostics,
    ].slice(0, 20);
    this.panel?.setDiagnostics?.(this.diagnostics);
  }

  announce(message, tone = 'info') {
    this.panel.notify(message, tone);
    const toastr = this.context()?.toastr || globalThis.toastr;
    if (!toastr) return;
    const method = ['success', 'error', 'warning', 'info'].includes(tone) ? tone : 'info';
    toastr[method]?.(String(message), '万象世界引擎');
  }

  cancelEvolution() {
    if (!this.evolutionPromise) {
      this.panel.notify('当前没有正在进行的后台推演');
      return;
    }
    this.abortController?.abort();
    this.setStatus(this.world ? 'ready' : 'idle', '已取消后台推演，世界保持原状');
    this.announce('已取消本次后台推演，未写入新世界状态', 'info');
  }

  async fetchModels(patch = {}) {
    if (patch && typeof patch === 'object') {
      Object.assign(this.getSettings(), patch);
      await this.context().saveSettingsDebounced?.();
      // 不重绘：重绘会丢掉刚填的表单和滚动位置，看起来像整页刷新
      this.panel.setData({ settings: this.getSettings(), rerender: false });
    }
    this.setStatus('running', '正在拉取模型列表');
    try {
      const models = await this.api.listModels();
      this.setStatus('ready', `连接成功，发现 ${models.length} 个模型`);
      this.announce(`连接成功，发现 ${models.length} 个模型，已填入“模型名”下拉列表`, 'success');
      return models;
    } catch (error) {
      this.setStatus('error', error.message);
      this.announce(`拉取模型失败：${error.message}`, 'error');
      return null;
    }
  }

  refreshInjection() {
    const context = this.context();
    if (!context.setExtensionPrompt) return;
    const settings = this.getSettings();
    const depth = Math.max(0, Math.min(8, Number(settings.injectDepth) || 0));
    // 预算同时看字符和 token：字符上限防止一次塞爆上下文，token 上限让人能按
    // 主模型的实际上下文来表达（中文按 1 token ≈ 1.6 字折算）。
    const tokenBudget = Math.max(200, Math.min(32000, Number(settings.injectMaxTokens) || 2600));
    const charBudget = Math.max(500, Math.min(40000, Number(settings.injectMaxChars) || 9000));
    const maxChars = Math.max(500, Math.min(charBudget, Math.round(tokenBudget * 1.6)));
    // 焦点注入依赖最近对话：正文写在哪儿，就注入哪儿。
    const conversation = extractRecentConversation(readChat(context), 6, 6000);
    const value = this.world ? buildWorldContext(this.world, {
      maxChars,
      includeSecrets: settings.includeSecrets,
      preset: settings.promptPreset,
      guide: settings.injectGuide !== false,
      injectGuide: typeof settings.injectGuideText === 'string' ? settings.injectGuideText : '',
      conversation,
      focusInjection: settings.focusInjection !== false,
      focusNpcLimit: settings.focusNpcLimit,
      focusFactionLimit: settings.focusFactionLimit,
      dailyPrompt: settings.dailyPrompt,
      festivalPrompt: settings.festivalPrompt,
    }) : '';
    // position 1 = 插在聊天记录中；depth 0 = 紧贴本轮输入，主 API 最不容易忽略。
    // role 0 = system，避免被当成用户发言的一部分。
    context.setExtensionPrompt(PROMPT_KEY, value, 1, depth, false, 0);
  }

  /** 当前勾选的世界书条目，拼成给世界模型看的摘要。 */
  loreDigest(maxChars = 6000) {
    return compileLoreDigest(this.loreCatalog, this.getSettings(), maxChars);
  }

  /** 读「角色卡书 + 全局书 + 额外添加的书」，读完通知面板刷新条目列表。 */
  async loadLore() {
    const token = this.chatToken;
    // promise 必须和聊天 token 绑在一起：切到新聊天时，上一聊天在飞的请求
    // 会被直接返回（内部 token 不符只剩旧目录），导致新聊天的书永远读不到。
    if (this.loreTask && this.loreTask.token === token) return this.loreTask.promise;
    let promise;
    promise = (async () => {
      try {
        const catalog = await loadLoreCatalog(this.context(), this.getSettings());
        if (token !== this.chatToken) return this.loreCatalog;
        this.loreCatalog = catalog;
        this.panel.setLoreCatalog(catalog);
        return catalog;
      } catch (error) {
        this.recordDiagnostic('lore', error.message);
        this.panel.notify(`读取世界书失败：${error.message}`, 'error');
        return this.loreCatalog;
      } finally {
        if (this.loreTask?.promise === promise) this.loreTask = null;
      }
    })();
    this.loreTask = { token, promise };
    return promise;
  }

  /** 用接入的 API 生成新的日常 / 节庆提示词，交给面板填进编辑框。 */
  async generateLorePrompt({ kind = 'daily', instruction = '' } = {}) {
    const settings = this.getSettings();
    const base = kind === 'festival' ? festivalPromptOf(settings) : dailyPromptOf(settings);
    const world = this.world;
    const brief = world
      ? [
        `世界：${world.name}`,
        `核心设定：${world.premise || ''}`,
        `基调：${world.tone || ''}`,
        `区域：${(world.regions || []).slice(0, 10).map((region) => region.name).join('、')}`,
      ].join('\n')
      : '';
    const prompt = [
      base,
      brief,
      instruction ? `额外要求：${instruction}` : '',
      '输出：可直接使用的提示词正文，不要解释、不要编号标题、不要代码块。',
    ].filter(Boolean).join('\n\n');
    const generated = await this.api.completeText(prompt, {
      systemPrompt: '你是叙事设定编辑，只输出提示词文本。',
    });
    if (!generated) throw new Error('接口没有返回内容');
    return generated.slice(0, 4000);
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
      worldInfo: this.loreDigest(6000) || worldbookDigest(context),
      recentConversation: extractRecentConversation(readChat(context), 14, 18000),
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
        // 节庆来源要可追溯：世界书里写过的算 worldbook，其余是本地推断。
        const digest = worldbookDigest(this.context());
        for (const festival of world.festivals || []) {
          if (digest && digest.includes(festival.name)) festival.origin = 'worldbook';
        }
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
        this.announce('世界初始化完成，可以开始正常扮演', 'success');
        return world;
      } catch (error) {
        if (token === this.chatToken && error?.name !== 'AbortError') {
          this.setStatus('error', error.message);
          this.announce(`初始化失败：${error.message}`, 'error');
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

  async prepareGeneration(chat, _contextSize, _abort, type) {
    // 生成拦截器手里的 chat 是最权威的一份，先留底再读，避免 context.chat 尚为空时误判「没有正文」。
    rememberChat(chat);
    if (type === 'quiet') return;
    if (this.evolutionPromise) {
      // 后台推演可能卡在 API 上很久；最多等 1.5 秒，别让正文回复跟着一起等。
      try {
        await Promise.race([
          this.evolutionPromise.catch(() => null),
          new Promise((resolve) => setTimeout(resolve, 1500)),
        ]);
      } catch { /* 状态栏已显示错误 */ }
    }
    const chatMessages = readChat(this.context());
    let baseline = selectBaseline(this.store.checkpoints(), chatMessages);
    if (!baseline) baseline = this.world;
    // 读不到正文时明确报出来，否则注入会变成一份和故事无关的世界档案。
    if (this.world && !this.chatReadWarningShown && !chatMessages.length) {
      this.chatReadWarningShown = true;
      this.setStatus('error', `没有读到当前聊天记录（已尝试 context.chat、生成拦截器、聊天 DOM，最后来源：${lastChatSource()}），注入将只包含世界设定`);
    }
    // 读到正文后清掉一次性警告，下一次真的读不到时还能再提示。
    if (chatMessages.length) this.chatReadWarningShown = false;
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
    const chat = readChat(context);
    // DOM 兜底拿到的是渲染出来的子集，楼层号会跟真实聊天错位：
    // 宁可不写检查点，也不要写一个回退时会把世界带到别处的楼层。
    if (lastChatSource() === 'dom') {
      this.recordDiagnostic('chat', '当前聊天记录只从 DOM 读到，跳过本轮检查点以避免楼层错位');
      return;
    }
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
    const interval = Math.max(1, Math.min(20, Number(settings.evolutionInterval) || 1));
    const pendingTurns = Math.max(baseline.pendingTurns || 0, this.world?.pendingTurns || 0) + 1;
    baseline.pendingTurns = pendingTurns;
    if (pendingTurns < interval) {
      // 用当前世界而不是生成前的快照：生成这段时间里用户可能在面板上改过字段。
      this.world = this.world ? this.world : deepClone(baseline);
      this.world.pendingTurns = pendingTurns;
      await this.store.save(this.world);
      this.setStatus('ready', `已记录第 ${pendingTurns}/${interval} 次回复，达到设定次数后自动推演`);
      this.panel.setData({ world: this.world, settings, status: this.status });
      return;
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
        const conversation = extractRecentConversation(readChat(this.context()));
        proposal = await this.api.completeJson(buildEvolutionPrompt(before, conversation, this.getSettings()), {
          signal: this.abortController.signal,
          systemPrompt: '你是多主体世界的意图导演。只输出合法 JSON，不判定行动结果。',
        });
      } catch (error) {
        if (error?.name === 'AbortError' || token !== this.chatToken) return null;
        proposal = {};
        warning = `API 未完成，本轮使用本地意图：${error.message}`;
      }
      if (token !== this.chatToken || chatKey !== this.store.chatKey()) return null;
      // 手动推进没有 messageIndex，用当前末条消息补上：否则手动推演不留检查点，
      // 顶栏的「重 roll 本轮」会退到上一次自动推演的位置。
      const index = Number.isInteger(messageIndex)
        ? messageIndex
        : readChat(this.context()).length - 1;
      const existing = Number.isInteger(index)
        ? this.store.checkpoints().find((checkpoint) => checkpoint.messageIndex === index)
        : null;
      // 同一层消息被重新生成（swipe）时，轮次号不变、种子不变，结果会一模一样；
      // 所以这里把重掷序数拌进种子，让重新生成真的能换一种走法。
      const reroll = existing ? (Number(existing.rerollCount) || 0) + 1 : 0;
      const world = evolveWorld(before, proposal, { ...this.getSettings(), reroll });
      world.lastEvolution.turnKey = turnKey || `manual_${Date.now()}`;
      world.lastEvolution.messageIndex = Number.isInteger(index) ? index : readChat(this.context()).length - 1;
      world.lastEvolution.manual = Boolean(manual);
      this.world = world;
      await this.store.save(world);
      if (Number.isInteger(index) && index >= 0 && lastChatSource() !== 'dom') {
        await this.store.saveCheckpoint(index, world.lastEvolution.turnKey, before, world, { proposal, rerollCount: reroll });
      }
      this.setStatus(warning ? 'error' : 'ready', warning || `第 ${world.round} 轮完成：${world.lastEvolution.diceRolls} 次判定`);
      this.panel.setData({ world, settings: this.getSettings(), status: this.status });
      this.refreshInjection();
      this.announce(warning || `第 ${world.round} 轮世界推演完成：${world.lastEvolution.diceRolls} 次判定`, warning ? 'error' : 'success');
      return world;
    })();
    this.evolutionPromise = task;
    try {
      return await task;
    } catch (error) {
      if (token === this.chatToken) {
        this.setStatus('error', error.message);
        this.announce(`推演失败：${error.message}`, 'error');
      }
      return null;
    } finally {
      this.abortController = null;
      this.evolutionPromise = null;
      this.generationBaseline = null;
    }
  }

  async handleMessageDeleted() {
    const rollback = selectRollback(this.store.checkpoints(), readChat(this.context()));
    if (!rollback) return;
    const count = readChat(this.context()).length;
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

  /** 就地修改的唯一落点：校验 → 写入 → 归一化 → 存档 → 重新注入。 */
  async editWorldField(payload) {
    if (!this.world) {
      this.panel.notify('当前还没有世界可以修改', 'error');
      return false;
    }
    const result = applyWorldEdit(this.world, payload);
    if (!result.ok) {
      this.panel.notify(result.error || '这次修改没有生效', 'error');
      return false;
    }
    this.world = normalizeWorld(this.world);
    await this.store.save(this.world);
    this.refreshInjection();
    this.panel.setData({
      world: this.world,
      settings: this.getSettings(),
      status: { kind: this.status.kind, message: `${result.label || '内容'}已更新` },
    });
    return true;
  }

  /**
   * 重掷一轮：复用检查点里的意图，只重掷骰子；mode='full' 时重新问一次模型。
   * 轮次号不变，靠 reroll 序数把随机种子拌开，所以同一条消息也能走出不同的结果。
   */
  async rerollTurn(mode = 'dice') {
    if (this.evolutionPromise) {
      this.panel.notify('正在推演中，等这一轮结束再重掷', 'error');
      return null;
    }
    // 占住推演闸门：快速连点不会并发改世界、并发写检查点。
    const task = this.performReroll(mode);
    this.evolutionPromise = task;
    try {
      return await task;
    } finally {
      if (this.evolutionPromise === task) this.evolutionPromise = null;
    }
  }

  async performReroll(mode = 'dice') {
    const checkpoint = this.store.latestCheckpoint();
    if (!checkpoint?.before) {
      this.panel.notify('没有找到这一轮之前的存档，无法重掷', 'error');
      return null;
    }
    const settings = this.getSettings();
    const round = checkpoint.before.round + 1;
    const reroll = (Number(checkpoint.rerollCount) || 0) + 1;
    this.setStatus('running', `正在重掷第 ${round} 轮${reroll > 1 ? `（第 ${reroll} 次）` : ''}`);
    let proposal = mode === 'full' ? null : checkpoint.proposal || null;
    let warning = '';
    if (!proposal) {
      try {
        this.abortController = new AbortController();
        const conversation = extractRecentConversation(readChat(this.context()));
        proposal = await this.api.completeJson(buildEvolutionPrompt(checkpoint.before, conversation, settings), {
          signal: this.abortController.signal,
          systemPrompt: '你是一个多主体世界的意图导演。只输出合法 JSON，不要判定行动结果。',
        });
      } catch (error) {
        if (error?.name === 'AbortError') {
          this.setStatus('ready', '已取消重掷');
          return null;
        }
        proposal = {};
        warning = `后台模型没有返回意图，改用本地意图重掷：${error.message}`;
      } finally {
        this.abortController = null;
      }
    }
    const before = deepClone(checkpoint.before);
    const world = evolveWorld(before, proposal || {}, { ...settings, reroll });
    world.lastEvolution.turnKey = checkpoint.turnKey || world.lastEvolution.turnKey;
    world.lastEvolution.messageIndex = checkpoint.messageIndex;
    world.lastEvolution.manual = Boolean(checkpoint.state?.lastEvolution?.manual);
    this.world = world;
    await this.store.save(world);
    await this.store.saveCheckpoint(checkpoint.messageIndex, checkpoint.turnKey, before, world, { proposal, rerollCount: reroll });
    this.setStatus(warning ? 'error' : 'ready', warning || `第 ${round} 轮已重掷（第 ${reroll} 次）：${world.lastEvolution.diceRolls} 次判定`);
    this.panel.setData({ world, settings: this.getSettings(), status: this.status });
    this.refreshInjection();
    this.announce(warning || `第 ${round} 轮已重掷，换了一种走法`, warning ? 'error' : 'success');
    return world;
  }

  /** 删除本次推演：世界退回这一轮之前，并让同一条消息可以重新自动推演。 */
  async discardEvolution() {
    if (this.evolutionPromise) {
      this.panel.notify('正在推演中，先等它结束', 'error');
      return null;
    }
    const task = this.performDiscardEvolution();
    this.evolutionPromise = task;
    try {
      return await task;
    } finally {
      if (this.evolutionPromise === task) this.evolutionPromise = null;
    }
  }

  async performDiscardEvolution() {
    const checkpoint = this.store.latestCheckpoint();
    if (!checkpoint?.before) {
      this.panel.notify('没有可以撤销的推演', 'error');
      return null;
    }
    const removedRound = Number(checkpoint.state?.round) || (Number(checkpoint.before.round) || 0) + 1;
    this.world = normalizeWorld(deepClone(checkpoint.before));
    await this.store.save(this.world);
    await this.store.dropCheckpoint(checkpoint.messageIndex);
    await this.store.forgetLastTurn();
    this.refreshInjection();
    this.panel.setData({
      world: this.world,
      settings: this.getSettings(),
      status: { kind: 'ready', message: `已删除第 ${removedRound} 轮推演，世界回到推演之前` },
    });
    this.panel.notify('本次推演已删除，重新生成这条回复会重新推演', 'success');
    return this.world;
  }

  /** 回退一轮：世界退到上一轮结束时的状态，再往上退一步。 */
  async rollbackTurn() {
    if (this.evolutionPromise) {
      this.panel.notify('正在推演中，先等它结束', 'error');
      return null;
    }
    const task = this.performRollbackTurn();
    this.evolutionPromise = task;
    try {
      return await task;
    } finally {
      if (this.evolutionPromise === task) this.evolutionPromise = null;
    }
  }

  async performRollbackTurn() {
    const list = this.store.checkpoints();
    if (list.length < 2) {
      this.panel.notify('没有更早的一轮可以回退', 'error');
      return null;
    }
    const latest = list.at(-1);
    const previous = list.at(-2);
    this.world = normalizeWorld(deepClone(previous.state || previous.before));
    await this.store.save(this.world);
    await this.store.dropCheckpoint(latest.messageIndex);
    this.refreshInjection();
    this.panel.setData({
      world: this.world,
      settings: this.getSettings(),
      status: { kind: 'ready', message: `已回退到第 ${this.world.round} 轮结束时的世界` },
    });
    this.panel.notify(`已回退到第 ${this.world.round} 轮`, 'success');
    return this.world;
  }

  async exportWorld() {
    if (!this.world) return this.panel.notify('当前没有可导出的世界', 'error');
    downloadJson(`LivingWorld-${this.world.name}-R${this.world.round}.json`, this.world);
    this.panel.notify('世界存档已导出，不包含 API Key', 'success');
  }

  async importWorld(raw) {
    try {
      const parsed = safeJsonParse(raw);
      if (isNewerThanSupported(parsed)) throw new Error('该存档由更新版本的插件生成，请先升级插件');
      const migration = migrateWorld(parsed);
      const world = normalizeWorld(migration.world, { coreNpcLimit: this.getSettings().coreNpcLimit });
      await this.store.clear();
      this.world = world;
      await this.store.save(world);
      const message = migration.migrated ? `世界导入完成（已从 v${migration.fromVersion} 迁移到 v${migration.toVersion}）` : '世界导入完成';
      this.panel.setData({ world, settings: this.getSettings(), status: { kind: 'ready', message } });
      this.refreshInjection();
      this.panel.notify(message, 'success');
    } catch (error) {
      this.panel.notify(`导入失败：${error.message}`, 'error');
    }
  }

  async editWorld(raw) {
    try {
      const parsed = typeof raw === 'string' ? safeJsonParse(raw) : raw;
      if (isNewerThanSupported(parsed)) throw new Error('该存档结构比当前插件更新');
      const world = normalizeWorld(migrateWorld(parsed).world, { coreNpcLimit: this.getSettings().coreNpcLimit });
      addLog(world, { type: 'world', title: '用户修订世界内容', detail: '用户通过世界编辑器保存了一次修订。', public: false });
      this.world = world;
      await this.store.save(world);
      this.panel.setData({ world, settings: this.getSettings(), status: { kind: 'ready', message: '世界修订已保存' } });
      this.refreshInjection();
      this.panel.notify('世界内容已修改并保存', 'success');
      return world;
    } catch (error) {
      this.panel.notify(`保存失败：${error.message}`, 'error');
      return null;
    }
  }

  async togglePinned(kind, id) {
    const collection = kind === 'rumor' ? this.world?.rumors : this.world?.events;
    const item = collection?.find((entry) => entry.id === id);
    if (!item) return;
    item.pinned = !item.pinned;
    if (item.pinned && kind === 'event' && item.status === 'archived') item.status = item.resolvedRound ? 'completed' : 'active';
    await this.store.save(this.world);
    this.panel.setData({ world: this.world, settings: this.getSettings(), status: this.status });
    this.refreshInjection();
    this.panel.notify(item.pinned ? '已保留，不会被自动归档或消散' : '已取消保留，恢复自然生命周期', 'success');
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
      this.announce('API 连接与 JSON 返回正常', 'success');
    } catch (error) {
      this.setStatus('error', error.message);
      this.announce(`API 测试失败：${error.message}`, 'error');
    }
  }
}

function boot() {
  if (!controller) controller = new LivingWorldController();
  controller.initialize();
}

const context = SillyTavern.getContext();
context.eventSource.on(context.event_types.APP_READY, boot);
