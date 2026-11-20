import { DEFAULT_SETTINGS, PROMPT_PRESETS } from '../engine/constants.js';
import { byId, escapeHtml } from '../engine/utils.js';
import { parseEditSpec } from '../engine/edits.js';
import { icon } from './icons.js';
import {
  MAP_MAX_SCALE, MAP_MIN_SCALE, normalizeMapView,
  renderDice, renderEmpty, renderEvents, renderFactions, renderMap,
  renderNpcInspector, renderOverview, renderPeople, renderPlayer, renderSettings,
} from './views.js';

const tabs = [
  ['overview', '总览', 'globe'],
  ['player', '生涯', 'target'],
  ['people', '人物', 'users'],
  ['map', '地图', 'map'],
  ['factions', '势力', 'factions'],
  ['events', '事件', 'events'],
  ['dice', '骰点', 'dice'],
  ['settings', '设置', 'settings'],
];

export class LivingWorldPanel {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.world = null;
    this.settings = { ...DEFAULT_SETTINGS };
    this.status = { kind: 'idle', message: '等待世界初始化' };
    this.activeTab = 'overview';
    this.selectedNpcId = null;
    this.selectedRegionId = null;
    this.selectedFactionId = null;
    this.peopleSearch = '';
    this.peopleMode = 'list';
    this.peopleFocusId = null;
    this.viewStates = {
      map: normalizeMapView({}),
      people: normalizeMapView({}),
      factions: normalizeMapView({}),
    };
    this.mapPath = [];
    this.diceFilter = 'all';
    this.pointerGesture = null;
    this.pointers = new Map();
    this.pinchGesture = null;
    this.folds = new Map();
    this.inlineEdit = null;
    this.models = [];
    this.mapStyleMode = 'auto';
    this.root = null;
    this.opened = false;
    this.handleClick = this.handleClick.bind(this);
    this.handleInput = this.handleInput.bind(this);
    this.handleChange = this.handleChange.bind(this);
    this.handleSubmit = this.handleSubmit.bind(this);
    this.handleKeydown = this.handleKeydown.bind(this);
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handleWheel = this.handleWheel.bind(this);
    this.handleDoubleClick = this.handleDoubleClick.bind(this);
  }

  mount() {
    if (this.root) return this;
    this.root = document.createElement('div');
    this.root.id = 'living-world-root';
    this.root.innerHTML = `
      <div class="lw-floating-dock"><button class="lw-floating" data-lw-action="toggle" aria-label="打开万象世界引擎；拖动可移动" title="拖动移动 · 右下角调整大小">${icon('globe', 25)}<span class="lw-floating-orbit"></span><i class="lw-floating-status"></i></button><button class="lw-floating-hide" data-lw-action="hide-floating" aria-label="隐藏悬浮按钮" title="隐藏，可从酒馆菜单重新打开">×</button><span class="lw-floating-resize" data-lw-resize aria-label="拖动调整悬浮按钮大小"></span></div>
      <div class="lw-backdrop" data-lw-action="close"></div>
      <section class="lw-shell" role="dialog" aria-modal="true" aria-label="Living World 万象世界引擎">
        <aside class="lw-sidebar">
          <div class="lw-brand"><span class="lw-brand-mark">${icon('globe', 24)}</span><div><strong>LIVING WORLD</strong><small>万象世界引擎</small></div></div>
          <nav class="lw-nav" aria-label="世界面板">${tabs.map(([id, label, iconName]) => `<button data-lw-action="tab" data-tab="${id}" class="${id === this.activeTab ? 'active' : ''}">${icon(iconName, 17)}<span>${label}</span><i></i></button>`).join('')}</nav>
          <div class="lw-sidebar-foot"><span class="lw-engine-pulse"></span><div><strong>LOCAL RULE ENGINE</strong><small>意图由模型提出 · 结果由规则判定</small></div></div>
        </aside>
        <div class="lw-workspace">
          <header class="lw-header"><div class="lw-header-world"><button class="lw-icon-button lw-mobile-menu" data-lw-action="toggle-nav" aria-label="切换导航">${icon('menu')}</button><div><span class="lw-kicker">WORLD OBSERVATORY</span><h1 id="lw-world-title">尚未初始化世界</h1></div></div><div class="lw-header-actions"><span id="lw-run-status" class="lw-run-status"><i></i><span>待命</span></span><button class="lw-icon-button" data-lw-action="evolve" title="立即推演一轮">${icon('play')}</button><button class="lw-icon-button" data-lw-action="cancel-evolve" title="取消后台推演" disabled>${icon('stop')}</button><button class="lw-icon-button" data-lw-action="close" aria-label="关闭">${icon('close')}</button></div></header>
          <main id="lw-content" class="lw-content"></main>
        </div>
        <aside id="lw-inspector" class="lw-inspector" aria-label="人物详情"><button class="lw-icon-button lw-inspector-close" data-lw-action="close-inspector" aria-label="关闭详情">${icon('close')}</button><div id="lw-inspector-body"></div></aside>
        <div id="lw-toast" class="lw-toast" role="status"></div>
        <input id="lw-import-file" type="file" accept="application/json,.json" hidden>
      </section>`;
    document.body.appendChild(this.root);
    this.root.addEventListener('click', this.handleClick);
    this.root.addEventListener('input', this.handleInput);
    this.root.addEventListener('change', this.handleChange);
    this.root.addEventListener('submit', this.handleSubmit);
    this.root.addEventListener('pointerdown', this.handlePointerDown);
    this.root.addEventListener('pointermove', this.handlePointerMove);
    this.root.addEventListener('pointerup', this.handlePointerUp);
    this.root.addEventListener('pointercancel', this.handlePointerUp);
    this.root.addEventListener('wheel', this.handleWheel, { passive: false });
    this.root.addEventListener('dblclick', this.handleDoubleClick);
    this.root.addEventListener('toggle', this.handleFoldToggle, true);
    document.addEventListener('keydown', this.handleKeydown);
    this.applyAppearance();
    this.render();
    return this;
  }

  setData({ world, settings, status, rerender = true } = {}) {
    if (world !== undefined) this.world = world;
    if (settings) this.settings = { ...this.settings, ...settings };
    if (status) this.status = status;
    if (!this.selectedRegionId && this.world) this.selectedRegionId = this.world.player.regionId;
    if (!this.selectedFactionId && this.world) this.selectedFactionId = this.world.factions[0]?.id || null;
    this.applyAppearance();
    // rerender: false 用于拉取模型列表这类「不该重载表单」的场景
    if (rerender) this.render();
  }

  setStatus(status) {
    this.status = status;
    this.renderHeader();
    const initialize = this.root?.querySelector('[data-lw-action="initialize"]');
    if (initialize) initialize.disabled = status.kind === 'running';
  }

  open() {
    if (!this.root) this.mount();
    this.opened = true;
    this.root.classList.add('lw-open');
    this.render();
  }

  close() {
    this.opened = false;
    this.root?.classList.remove('lw-open');
  }

  toggle() {
    this.opened ? this.close() : this.open();
  }

  notify(message, tone = 'info') {
    const toast = this.root?.querySelector('#lw-toast');
    if (!toast) return;
    toast.textContent = String(message);
    toast.className = `lw-toast visible ${tone}`;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => toast.classList.remove('visible'), 3600);
  }

  render() {
    if (!this.root) return;
    this.cancelInlineEdit();
    this.renderHeader();
    const content = this.root.querySelector('#lw-content');
    if (!this.world && this.activeTab !== 'settings') {
      content.innerHTML = renderEmpty(this.status);
    } else {
      switch (this.activeTab) {
        case 'player': content.innerHTML = renderPlayer(this.world); break;
        case 'people': content.innerHTML = renderPeople(this.world, this.peopleSearch, this.peopleMode, this.peopleFocusId, this.viewStates.people); break;
        case 'map': content.innerHTML = renderMap(this.world, this.selectedRegionId, this.viewStates.map, this.getMapScope(), this.mapStyleMode === 'auto' ? (this.settings.mapStyle || 'auto') : this.mapStyleMode); break;
        case 'factions': content.innerHTML = renderFactions(this.world, this.selectedFactionId, this.viewStates.factions); break;
        case 'events': content.innerHTML = renderEvents(this.world); break;
        case 'dice': content.innerHTML = renderDice(this.world, this.diceFilter); break;
        case 'settings': content.innerHTML = renderSettings(this.settings, this.status, this.world, this.models); break;
        default: content.innerHTML = renderOverview(this.world);
      }
    }
    this.renderInspector();
    this.applyFoldState();
  }

  /** 拉取到的模型直接展开在输入框下方，不重载表单、不重置滚动位置。 */
  applyModels() {
    if (!this.root) return;
    const models = Array.isArray(this.models) ? this.models : [];
    const count = this.root.querySelector('[data-lw-model-count]');
    if (count) count.textContent = models.length ? `${models.length} 个` : '尚未拉取';
    const list = this.root.querySelector('[data-lw-model-list]');
    if (list) {
      list.innerHTML = models.length
        ? models.map((id) => `<button type="button" class="lw-model-chip" data-lw-action="pick-model" data-model="${escapeHtml(id)}">${escapeHtml(id)}</button>`).join('')
        : '<small>没有可用的模型，检查 Base URL 与密钥后重试。</small>';
      list.classList.add('is-fresh');
      setTimeout(() => list.classList.remove('is-fresh'), 900);
    }
    const datalist = this.root.querySelector('#lw-model-list');
    if (datalist) datalist.innerHTML = models.map((id) => `<option value="${escapeHtml(id)}"></option>`).join('');
    const input = this.root.querySelector('[name="customModel"]');
    if (input && !input.value.trim() && models.length) input.value = models[0];
    list?.querySelector('.lw-model-chip')?.scrollIntoView?.({ block: 'nearest' });
  }

  /** 折叠状态存在面板实例上，重绘后按 key 还原，切页签也不会被重置。 */
  applyFoldState() {
    if (!this.root) return;
    for (const node of this.root.querySelectorAll('[data-fold-key]')) {
      const key = node.dataset.foldKey;
      if (!key || !this.folds.has(key)) continue;
      node.open = this.folds.get(key);
    }
  }

  handleFoldToggle(event) {
    const node = event.target;
    if (!node?.dataset?.foldKey) return;
    this.folds.set(node.dataset.foldKey, node.open);
  }

  getMapScope() {
    let regions = this.world?.regions || [];
    const path = [];
    for (const id of this.mapPath) {
      const region = byId(regions, id);
      if (!region) break;
      path.push(region);
      regions = region.children || [];
    }
    this.mapPath = path.map((region) => region.id);
    return { regions, path };
  }

  applyAppearance() {
    if (!this.root) return;
    const theme = ['light', 'glass'].includes(this.settings.theme) ? this.settings.theme : 'dark';
    this.root.dataset.theme = theme;
    const glass = Math.max(0.15, Math.min(0.95, Number(this.settings.glassOpacity) || 0.55));
    this.root.style.setProperty('--lw-glass-alpha', glass.toFixed(2));
    this.root.style.setProperty('--lw-glass-strong', Math.min(0.96, glass + 0.18).toFixed(2));
    this.root.style.setProperty('--lw-glass-soft', Math.max(0.12, glass * 0.55).toFixed(2));
    this.root.style.setProperty('--lw-glass-blur', `${Math.round(10 + glass * 26)}px`);
    this.root.classList.toggle('lw-floating-hidden', this.settings.floatingButton === false);
    const dock = this.root.querySelector('.lw-floating-dock');
    if (!dock) return;
    const size = Math.max(42, Math.min(88, Number(this.settings.floatingSize) || 58));
    dock.style.width = `${size}px`;
    dock.style.height = `${size}px`;
    if (Number.isFinite(this.settings.floatingX) && Number.isFinite(this.settings.floatingY)) {
      const x = Math.max(0, Math.min(window.innerWidth - size, this.settings.floatingX));
      const y = Math.max(0, Math.min(window.innerHeight - size, this.settings.floatingY));
      dock.style.left = `${x}px`;
      dock.style.top = `${y}px`;
      dock.style.right = 'auto';
      dock.style.bottom = 'auto';
    }
  }

  renderHeader() {
    if (!this.root) return;
    const title = this.root.querySelector('#lw-world-title');
    if (title) title.textContent = this.world ? `${this.world.name} · 第 ${this.world.round} 轮` : '尚未初始化世界';
    const status = this.root.querySelector('#lw-run-status');
    if (status) {
      status.className = `lw-run-status ${this.status.kind}`;
      status.querySelector('span').textContent = this.status.kind === 'running' ? '推演中' : this.status.kind === 'error' ? '异常' : this.world ? '已同步' : '待命';
      status.title = this.status.message || '';
    }
    for (const button of this.root.querySelectorAll('.lw-nav button')) {
      button.classList.toggle('active', button.dataset.tab === this.activeTab);
    }
    this.root.querySelector('.lw-floating')?.classList.toggle('running', this.status.kind === 'running');
    const cancel = this.root.querySelector('.lw-header-actions [data-lw-action="cancel-evolve"]');
    if (cancel) cancel.disabled = this.status.kind !== 'running';
  }

  renderInspector() {
    const inspector = this.root?.querySelector('#lw-inspector');
    const body = this.root?.querySelector('#lw-inspector-body');
    const npc = byId(this.world?.npcs, this.selectedNpcId);
    if (!inspector || !body) return;
    inspector.classList.toggle('visible', Boolean(npc));
    if (npc) body.innerHTML = renderNpcInspector(this.world, npc);
  }

  async handleClick(event) {
    const editable = event.target.closest?.('[data-lw-edit]');
    if (editable && this.root?.contains(editable)) {
      event.preventDefault();
      // 刚提交完的那一下点击会冒泡回来，不要把它当成“又要改一次”。
      const settledAt = Number(editable.dataset.editSettled || 0);
      if (settledAt && Date.now() - settledAt < 400) return;
      this.beginInlineEdit(editable);
      return;
    }
    this.cancelInlineEdit();
    const target = event.target.closest('[data-lw-action]');
    if (!target || !this.root.contains(target)) return;
    const action = target.dataset.lwAction;
    // 折叠块标题里的按钮只执行自身动作，不要连带收起面板。
    if (target.closest('summary')) event.preventDefault();
    if (action === 'toggle') {
      if (this.suppressFloatingClick) { this.suppressFloatingClick = false; return; }
      return this.toggle();
    }
    if (action === 'hide-floating') {
      await this.callbacks.onSettingsChange?.({ floatingButton: false });
      this.notify('悬浮按钮已隐藏，可在设置或酒馆菜单中重新打开');
      return;
    }
    if (action === 'close') return this.close();
    if (action === 'close-inspector') {
      this.selectedNpcId = null;
      this.renderInspector();
      return;
    }
    if (action === 'toggle-nav') {
      this.root.classList.toggle('lw-nav-open');
      return;
    }
    if (action === 'tab') {
      if (target.dataset.tab !== 'people') this.peopleFocusId = null;
      this.activeTab = target.dataset.tab;
      this.selectedNpcId = null;
      this.root.classList.remove('lw-nav-open');
      this.render();
      return;
    }
    if (action === 'npc-select') {
      this.selectedNpcId = target.dataset.id;
      this.renderInspector();
      return;
    }
    if (action === 'people-mode') {
      this.peopleMode = target.dataset.mode === 'graph' ? 'graph' : 'list';
      if (this.peopleMode === 'list') this.peopleFocusId = null;
      this.render();
      return;
    }
    if (action === 'npc-focus') {
      const id = target.dataset.id;
      this.peopleFocusId = this.peopleFocusId === id ? null : id;
      this.viewStates.people = normalizeMapView({});
      this.render();
      return;
    }
    if (action === 'npc-focus-clear') {
      this.peopleFocusId = null;
      this.viewStates.people = normalizeMapView({});
      this.render();
      return;
    }
    if (action === 'npc-card') {
      this.selectedNpcId = target.dataset.id;
      this.renderInspector();
      return;
    }
    if (action === 'region-select') {
      this.selectedRegionId = target.dataset.id;
      if (this.activeTab !== 'map') { this.activeTab = 'map'; this.mapPath = []; }
      this.render();
      return;
    }
    if (action === 'region-open') {
      this.activeTab = 'map';
      this.mapPath = [];
      this.selectedRegionId = target.dataset.id;
      this.render();
      return;
    }
    if (action === 'region-enter') {
      const { regions } = this.getMapScope();
      const region = byId(regions, target.dataset.id);
      if (region?.children?.length) {
        this.mapPath.push(region.id);
        this.selectedRegionId = region.children[0].id;
        this.viewStates.map = normalizeMapView({});
        this.render();
      }
      return;
    }
    if (action === 'map-root' || action === 'map-path') {
      this.mapPath = action === 'map-root' ? [] : this.mapPath.slice(0, Number(target.dataset.depth) + 1);
      const scope = this.getMapScope();
      this.selectedRegionId = scope.regions[0]?.id || scope.path.at(-1)?.id || null;
      this.render();
      return;
    }
    if (action === 'faction-open') {
      this.activeTab = 'factions';
      this.selectedFactionId = target.dataset.id;
      this.render();
      return;
    }
    if (action === 'dice-filter') {
      this.diceFilter = target.dataset.filter || 'all';
      this.render();
      return;
    }
    if (action === 'toggle-pin') {
      await this.callbacks.onTogglePin?.(target.dataset.kind, target.dataset.id);
      return;
    }
    if (action === 'faction-select') {
      this.selectedFactionId = target.dataset.id;
      this.render();
      return;
    }
    if (action === 'view-zoom-in' || action === 'view-zoom-out') {
      const key = target.dataset.key || 'map';
      this.zoomView(key, action === 'view-zoom-in' ? 1.25 : 0.8);
      return;
    }
    if (action === 'view-zoom-reset') {
      this.resetView(target.dataset.key || 'map');
      return;
    }
    if (action === 'apply-prompt-preset') {
      const presetId = this.root.querySelector('[name="promptPreset"]')?.value || 'balanced';
      const customPresets = Array.isArray(this.settings.customPromptPresets) ? this.settings.customPromptPresets : [];
      const preset = PROMPT_PRESETS[presetId] || customPresets.find((item) => item.id === presetId) || PROMPT_PRESETS.balanced;
      this.root.querySelector('[name="bootstrapPrompt"]').value = preset.bootstrapPrompt || '';
      this.root.querySelector('[name="evolutionPrompt"]').value = preset.evolutionPrompt || '';
      this.root.querySelector('[name="jailbreakPrompt"]').value = preset.jailbreakPrompt || '';
      this.notify(`已载入“${preset.name}”，保存设置后生效`);
      return;
    }
    if (action === 'save-prompt-preset') {
      const nameInput = this.root.querySelector('[name="newPromptPresetName"]');
      const name = String(nameInput?.value || '').trim();
      if (!name) { this.notify('请先填写新预设名称', 'error'); return; }
      const customPresets = Array.isArray(this.settings.customPromptPresets) ? this.settings.customPromptPresets : [];
      const id = `custom_${Date.now()}`;
      const preset = {
        id, name,
        bootstrapPrompt: this.root.querySelector('[name="bootstrapPrompt"]')?.value || '',
        evolutionPrompt: this.root.querySelector('[name="evolutionPrompt"]')?.value || '',
        jailbreakPrompt: this.root.querySelector('[name="jailbreakPrompt"]')?.value || '',
      };
      await this.callbacks.onSettingsChange?.({ customPromptPresets: [...customPresets.filter((item) => item.name !== name), preset], promptPreset: id });
      this.notify(`自定义预设“${name}”已保存`, 'success');
      return;
    }
    if (action === 'delete-prompt-preset') {
      const presetId = this.root.querySelector('[name="promptPreset"]')?.value;
      const customPresets = Array.isArray(this.settings.customPromptPresets) ? this.settings.customPromptPresets : [];
      if (!customPresets.some((item) => item.id === presetId)) { this.notify('请先在预设列表中选择一个自定义预设', 'error'); return; }
      await this.callbacks.onSettingsChange?.({ customPromptPresets: customPresets.filter((item) => item.id !== presetId), promptPreset: 'balanced' });
      this.notify('自定义预设已删除', 'success');
      return;
    }
    if (action === 'import') {
      this.root.querySelector('#lw-import-file').click();
      return;
    }
    if (action === 'pick-model') {
      const model = target.dataset.model || '';
      const input = this.root.querySelector('[name="customModel"]');
      if (input && model) {
        input.value = model;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        this.notify(`已选择模型 ${model}`, 'success');
      }
      return;
    }
    if (action === 'map-style') {
      const current = this.mapStyleMode === 'auto' ? (this.settings.mapStyle || 'auto') : this.mapStyleMode;
      const depth = (this.getMapScope().path || []).length;
      const inAtlas = current === 'atlas' || (current !== 'dark' && depth > 0);
      this.mapStyleMode = inAtlas ? 'dark' : 'atlas';
      this.render();
      return;
    }
    if (action === 'fetch-models') {
      const form = this.root.querySelector('#lw-settings-form');
      const data = form ? new FormData(form) : new FormData();
      const models = await this.callbacks.onFetchModels?.({
        customBaseUrl: String(data.get('customBaseUrl') || '').trim(),
        customApiKey: String(data.get('customApiKey') || ''),
        customModel: String(data.get('customModel') || '').trim(),
      });
      if (Array.isArray(models) && models.length) {
        this.models = models.slice();
        this.applyModels();
      } else {
        this.notify('没有拿到模型列表，请检查 Base URL 与密钥', 'error');
      }
      return;
    }
    if (action === 'initialize' && this.world && !window.confirm('重新初始化会替换当前聊天的世界。建议先导出存档，是否继续？')) return;
    if (action === 'reset' && !window.confirm('确定清除当前聊天的世界、骰点和检查点吗？此操作不可撤销。')) return;
    const callback = {
      initialize: this.callbacks.onInitialize,
      evolve: this.callbacks.onEvolve,
      export: this.callbacks.onExport,
      reset: this.callbacks.onReset,
      'test-api': this.callbacks.onTestApi,
      'cancel-evolve': this.callbacks.onCancelEvolution,
    }[action];
    if (callback) await callback();
  }

  handleInput(event) {
    if (event.target.dataset.lwInput !== 'people-search') return;
    this.peopleSearch = event.target.value;
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.render();
      const input = this.root.querySelector('[data-lw-input="people-search"]');
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    }, 120);
  }

  async handleChange(event) {
    if (event.target.id === 'lw-import-file') {
      const file = event.target.files?.[0];
      if (file && this.callbacks.onImport) await this.callbacks.onImport(await file.text());
      event.target.value = '';
      return;
    }
    if (event.target.name === 'connectionMode') {
      this.root.querySelector('.lw-custom-api')?.classList.toggle('muted', event.target.value !== 'custom');
    }
  }

  async handleSubmit(event) {
    if (event.target.id !== 'lw-settings-form') return;
    event.preventDefault();
    const data = new FormData(event.target);
    const settings = {
      connectionMode: data.get('connectionMode') === 'custom' ? 'custom' : 'st',
      customBaseUrl: String(data.get('customBaseUrl') || '').trim(),
      customApiKey: String(data.get('customApiKey') || ''),
      customModel: String(data.get('customModel') || '').trim(),
      autoEvolve: data.has('autoEvolve'),
      evolutionInterval: Math.max(1, Math.min(20, Number(data.get('evolutionInterval')) || 1)),
      diceModifier: Math.max(-10, Math.min(10, Number(data.get('diceModifier')) || 0)),
      theme: data.get('theme') === 'light' ? 'light' : 'dark',
      floatingButton: data.has('floatingButton'),
      floatingSize: Math.max(42, Math.min(88, Number(data.get('floatingSize')) || 58)),
      autoBootstrap: data.has('autoBootstrap'),
      includeSecrets: data.has('includeSecrets'),
      promptPreset: String(data.get('promptPreset') || 'balanced'),
      bootstrapPrompt: String(data.get('bootstrapPrompt') || '').trim(),
      evolutionPrompt: String(data.get('evolutionPrompt') || '').trim(),
      jailbreakPrompt: String(data.get('jailbreakPrompt') || '').trim(),
      coreNpcLimit: Math.max(1, Math.min(400, Number(data.get('coreNpcLimit')) || 24)),
      briefNpcLimit: Math.max(8, Math.min(240, Number(data.get('briefNpcLimit')) || 48)),
      injectMaxChars: Number(data.get('injectMaxChars')),
      injectDepth: Math.max(0, Math.min(8, Number(data.get('injectDepth')) || 0)),
      injectGuide: data.has('injectGuide'),
      injectGuideText: String(data.get('injectGuideText') || '').trim(),
      glassOpacity: Math.max(0.15, Math.min(0.95, (Number(data.get('glassOpacity')) || 55) / 100)),
      mapStyle: ['auto', 'atlas', 'dark'].includes(String(data.get('mapStyle'))) ? String(data.get('mapStyle')) : 'auto',
      aiClans: data.has('aiClans'),
      focusInjection: data.has('focusInjection'),
      focusNpcLimit: Math.max(3, Math.min(16, Number(data.get('focusNpcLimit')) || 8)),
      focusFactionLimit: Math.max(2, Math.min(10, Number(data.get('focusFactionLimit')) || 4)),
      dailyLife: data.has('dailyLife'),
      dailyActors: Math.max(1, Math.min(6, Number(data.get('dailyActors')) || 2)),
      festivals: data.has('festivals'),
      customFestivals: String(data.get('customFestivals') || '').trim(),
      compressionEnabled: data.has('compressionEnabled'),
      compressEvery: Math.max(3, Math.min(100, Number(data.get('compressEvery')) || 12)),
      compressTier2Every: Math.max(2, Math.min(20, Number(data.get('compressTier2Every')) || 5)),
      compressTier3Every: Math.max(2, Math.min(20, Number(data.get('compressTier3Every')) || 5)),
      compressKeepRounds: Math.max(0, Math.min(40, Number(data.get('compressKeepRounds')) || 4)),
      maxTokens: Number(data.get('maxTokens')),
      requestTimeout: Number(data.get('requestTimeout')),
    };
    this.settings = { ...this.settings, ...settings };
    await this.callbacks.onSettingsChange?.(settings);
  }

  viewCanvas(key) {
    return this.root?.querySelector(`[data-lw-pan-zoom="${key}"]`) || null;
  }

  viewSvg(key) {
    return this.viewCanvas(key)?.querySelector('svg') || null;
  }

  viewKeyOf(target) {
    const canvas = target?.closest?.('[data-lw-pan-zoom]');
    return canvas?.getAttribute('data-lw-pan-zoom') || null;
  }

  viewState(key) {
    return normalizeMapView(this.viewStates[key] || {});
  }

  pointInView(key, clientX, clientY) {
    const svg = this.viewSvg(key);
    if (!svg) return null;
    if (svg.getScreenCTM && typeof DOMPoint === 'function') {
      const matrix = svg.getScreenCTM();
      if (matrix) {
        const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
        if (Number.isFinite(point.x) && Number.isFinite(point.y)) return { x: point.x, y: point.y };
      }
    }
    const rect = svg.getBoundingClientRect?.();
    if (!rect || !rect.width || !rect.height) return null;
    const box = String(svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
    const [vx, vy, vw, vh] = box.length === 4 && box.every((value) => Number.isFinite(value)) ? box : [0, 0, 1000, 560];
    return { x: vx + (clientX - rect.left) / rect.width * vw, y: vy + (clientY - rect.top) / rect.height * vh };
  }

  viewCenter(key) {
    const svg = this.viewSvg(key);
    const box = String(svg?.getAttribute('viewBox') || '').split(/\s+/).map(Number);
    if (box.length === 4 && box.every((value) => Number.isFinite(value))) {
      return { x: box[0] + box[2] / 2, y: box[1] + box[3] / 2 };
    }
    return { x: 500, y: 280 };
  }

  applyViewport(key) {
    const canvas = this.viewCanvas(key);
    if (!canvas) return;
    const { scale, x, y } = this.viewState(key);
    const group = canvas.querySelector('[data-lw-viewport]');
    if (group) group.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale.toFixed(4)})`);
    const label = canvas.querySelector('[data-lw-zoom-value]');
    if (label) label.textContent = `${Math.round(scale * 100)}%`;
  }

  setViewScale(key, nextScale, anchor = null) {
    const current = this.viewState(key);
    const target = Math.min(MAP_MAX_SCALE, Math.max(MAP_MIN_SCALE, Number(nextScale) || 1));
    if (Math.abs(target - current.scale) < 0.0001) return;
    const center = anchor || this.viewCenter(key);
    const ratio = target / current.scale;
    this.viewStates[key] = {
      scale: target,
      x: center.x - (center.x - current.x) * ratio,
      y: center.y - (center.y - current.y) * ratio,
    };
    this.applyViewport(key);
  }

  zoomView(key, factor, clientX, clientY) {
    const anchor = Number.isFinite(clientX) && Number.isFinite(clientY) ? this.pointInView(key, clientX, clientY) : null;
    this.setViewScale(key, this.viewState(key).scale * factor, anchor);
  }

  resetView(key) {
    this.viewStates[key] = normalizeMapView({});
    this.applyViewport(key);
  }

  handleWheel(event) {
    const key = this.viewKeyOf(event.target);
    if (!key) return;
    event.preventDefault();
    const step = event.deltaMode === 1 ? 0.05 : 0.0015;
    this.zoomView(key, Math.exp(-event.deltaY * step), event.clientX, event.clientY);
  }

  handleDoubleClick(event) {
    const key = this.viewKeyOf(event.target);
    if (!key || event.target.closest('.lw-map-node, .lw-faction-node, .lw-person-node')) return;
    this.resetView(key);
  }

  /** 记录按在某张图上的指针，用于单指平移与双指缩放。 */
  trackPointer(event) {
    const key = this.viewKeyOf(event.target);
    if (!key) return null;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, key });
    return key;
  }

  startPinch(key) {
    const points = [...this.pointers.values()].filter((pointer) => pointer.key === key);
    if (points.length < 2) return false;
    const [a, b] = points;
    const middle = this.pointInView(key, (a.x + b.x) / 2, (a.y + b.y) / 2);
    if (!middle) return false;
    const view = this.viewState(key);
    this.pinchGesture = {
      key,
      startDistance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      startScale: view.scale,
      world: { x: (middle.x - view.x) / view.scale, y: (middle.y - view.y) / view.scale },
    };
    this.pointerGesture = null;
    this.viewCanvas(key)?.classList.add('is-panning');
    return true;
  }

  updatePinch() {
    const gesture = this.pinchGesture;
    if (!gesture) return false;
    const points = [...this.pointers.values()].filter((pointer) => pointer.key === gesture.key);
    if (points.length < 2) return false;
    const [a, b] = points;
    const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const middle = this.pointInView(gesture.key, (a.x + b.x) / 2, (a.y + b.y) / 2);
    if (!middle) return false;
    const scale = Math.min(MAP_MAX_SCALE, Math.max(MAP_MIN_SCALE, gesture.startScale * (distance / gesture.startDistance)));
    this.viewStates[gesture.key] = {
      scale,
      x: middle.x - gesture.world.x * scale,
      y: middle.y - gesture.world.y * scale,
    };
    this.applyViewport(gesture.key);
    return true;
  }

  endPinchIfNeeded() {
    const gesture = this.pinchGesture;
    if (!gesture) return;
    const remaining = [...this.pointers.values()].filter((pointer) => pointer.key === gesture.key).length;
    if (remaining >= 2) return;
    this.pinchGesture = null;
    this.viewCanvas(gesture.key)?.classList.remove('is-panning');
  }

  handlePointerDown(event) {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    const viewKey = this.trackPointer(event);
    if (viewKey) {
      if (this.startPinch(viewKey)) {
        event.preventDefault();
        return;
      }
      const canvas = this.viewCanvas(viewKey);
      const onNode = event.target.closest?.('.lw-map-node, .lw-faction-node, .lw-person-node, button');
      if (canvas && !onNode) {
        const view = this.viewState(viewKey);
        this.pointerGesture = {
          id: event.pointerId,
          type: 'pan',
          key: viewKey,
          startX: event.clientX,
          startY: event.clientY,
          originX: view.x,
          originY: view.y,
          startPoint: this.pointInView(viewKey, event.clientX, event.clientY),
          moved: false,
        };
        canvas.classList.add('is-panning');
        event.target.setPointerCapture?.(event.pointerId);
        event.preventDefault();
        return;
      }
    }
    const resize = event.target.closest('[data-lw-resize]');
    const floating = event.target.closest('.lw-floating');
    if (!resize && !floating) return;
    const dock = this.root.querySelector('.lw-floating-dock');
    const rect = dock.getBoundingClientRect();
    this.pointerGesture = {
      id: event.pointerId,
      type: resize ? 'resize' : 'drag',
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      size: rect.width,
      moved: false,
    };
    event.target.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  handlePointerMove(event) {
    const tracked = this.pointers.get(event.pointerId);
    if (tracked) {
      this.pointers.set(event.pointerId, { ...tracked, x: event.clientX, y: event.clientY });
      if (this.updatePinch()) {
        event.preventDefault();
        return;
      }
    }
    const gesture = this.pointerGesture;
    if (!gesture || gesture.id !== event.pointerId) return;
    if (gesture.type === 'pan') {
      const dx = event.clientX - gesture.startX;
      const dy = event.clientY - gesture.startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) gesture.moved = true;
      if (!gesture.moved) return;
      const current = this.pointInView(gesture.key, event.clientX, event.clientY);
      const view = this.viewState(gesture.key);
      if (gesture.startPoint && current) {
        this.viewStates[gesture.key] = {
          scale: view.scale,
          x: gesture.originX + (current.x - gesture.startPoint.x),
          y: gesture.originY + (current.y - gesture.startPoint.y),
        };
      } else {
        const rect = this.viewSvg(gesture.key)?.getBoundingClientRect?.();
        const unitsPerPixel = rect?.width ? 1000 / rect.width : 1;
        this.viewStates[gesture.key] = { scale: view.scale, x: gesture.originX + dx * unitsPerPixel, y: gesture.originY + dy * unitsPerPixel };
      }
      this.applyViewport(gesture.key);
      return;
    }
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (Math.abs(dx) + Math.abs(dy) > 4) gesture.moved = true;
    const dock = this.root.querySelector('.lw-floating-dock');
    if (gesture.type === 'resize') {
      const size = Math.max(42, Math.min(88, gesture.size + (dx + dy) / 2));
      const x = Math.max(0, Math.min(gesture.left, window.innerWidth - size));
      const y = Math.max(0, Math.min(gesture.top, window.innerHeight - size));
      dock.style.width = `${size}px`;
      dock.style.height = `${size}px`;
      dock.style.left = `${x}px`;
      dock.style.top = `${y}px`;
      dock.style.right = 'auto';
      dock.style.bottom = 'auto';
      gesture.currentSize = size;
      gesture.currentX = x;
      gesture.currentY = y;
    } else {
      const x = Math.max(0, Math.min(window.innerWidth - gesture.size, gesture.left + dx));
      const y = Math.max(0, Math.min(window.innerHeight - gesture.size, gesture.top + dy));
      dock.style.left = `${x}px`;
      dock.style.top = `${y}px`;
      dock.style.right = 'auto';
      dock.style.bottom = 'auto';
      gesture.currentX = x;
      gesture.currentY = y;
    }
  }

  async handlePointerUp(event) {
    this.pointers.delete(event.pointerId);
    this.endPinchIfNeeded();
    const gesture = this.pointerGesture;
    if (!gesture || gesture.id !== event.pointerId) return;
    if (gesture.type === 'pan') {
      this.pointerGesture = null;
      this.viewCanvas(gesture.key)?.classList.remove('is-panning');
      return;
    }
    this.pointerGesture = null;
    if (!gesture.moved) return;
    this.suppressFloatingClick = true;
    const settings = gesture.type === 'resize'
      ? {
        floatingSize: Math.round(gesture.currentSize || gesture.size),
        floatingX: Math.round(gesture.currentX ?? gesture.left),
        floatingY: Math.round(gesture.currentY ?? gesture.top),
      }
      : { floatingX: Math.round(gesture.currentX ?? gesture.left), floatingY: Math.round(gesture.currentY ?? gesture.top) };
    await this.callbacks.onSettingsChange?.(settings);
  }

  /** 点一下就改：把被点的文字原地换成输入框，回车/失焦保存，Esc 取消。 */
  beginInlineEdit(node) {
    const spec = parseEditSpec(node.dataset.lwEdit);
    if (!spec) return;
    if (node.classList.contains('is-editing')) {
      node.querySelector('input, textarea')?.focus();
      return;
    }
    this.cancelInlineEdit();
    const multiline = spec.type === 'textarea';
    const rawValue = node.dataset.lwValue ?? (node.textContent || '').trim();
    const original = node.innerHTML;
    const field = document.createElement(multiline ? 'textarea' : 'input');
    field.className = 'lw-inline-input';
    field.value = rawValue;
    if (spec.type === 'number') {
      field.type = 'number';
      field.step = 'any';
      field.inputMode = 'decimal';
    } else {
      field.type = 'text';
    }
    if (multiline) field.rows = 3;
    node.classList.add('is-editing');
    if (multiline) node.classList.add('is-multiline');
    node.replaceChildren(field);
    field.focus();
    if (typeof field.select === 'function') field.select();

    let settled = false;
    const finish = async (commit) => {
      if (settled) return;
      settled = true;
      node.dataset.editSettled = String(Date.now());
      node.classList.remove('is-editing', 'is-multiline');
      node.innerHTML = original;
      if (this.inlineEdit?.node === node) this.inlineEdit = null;
      if (!commit) return;
      const value = spec.type === 'number' ? field.value : field.value.trim();
      const accepted = await this.callbacks.onEditField?.({ ...spec, value });
      if (accepted === false) {
        this.notify('这次修改没有生效，已保留原值', 'error');
        return;
      }
      this.notify(`${spec.type === 'number' ? '数值' : '内容'}已更新`, 'success');
    };
    this.inlineEdit = { node, finish };

    field.addEventListener('pointerdown', (event) => event.stopPropagation());
    field.addEventListener('click', (event) => event.stopPropagation());
    field.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
        return;
      }
      if (event.key === 'Enter' && (!multiline || event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        finish(true);
      }
    });
    // 单行框失焦即保存；多行框留给“保存/取消”，避免点滚动条时误提交。
    field.addEventListener('blur', () => { if (!multiline) finish(true); });

    if (multiline) {
      const actions = document.createElement('span');
      actions.className = 'lw-inline-actions';
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'lw-inline-save';
      save.textContent = '保存';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'lw-inline-cancel';
      cancel.textContent = '取消';
      save.addEventListener('pointerdown', (event) => event.stopPropagation());
      cancel.addEventListener('pointerdown', (event) => event.stopPropagation());
      save.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        finish(true);
      });
      cancel.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      });
      actions.append(save, cancel);
      node.append(actions);
    }
  }

  cancelInlineEdit() {
    if (this.inlineEdit) this.inlineEdit.finish(false);
    this.inlineEdit = null;
  }

  handleKeydown(event) {
    if (!this.root) return;
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches?.('[data-lw-edit]')) {
      event.preventDefault();
      this.beginInlineEdit(event.target);
      return;
    }
    if (event.key === 'Escape' && this.opened) {
      if (this.selectedNpcId) {
        this.selectedNpcId = null;
        this.renderInspector();
      } else this.close();
    }
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('g[data-lw-action]')) {
      event.preventDefault();
      event.target.dispatchEvent(new Event('click', { bubbles: true }));
    }
  }

  destroy() {
    clearTimeout(this.toastTimer);
    clearTimeout(this.searchTimer);
    document.removeEventListener('keydown', this.handleKeydown);
    this.root?.removeEventListener('pointerdown', this.handlePointerDown);
    this.root?.removeEventListener('pointermove', this.handlePointerMove);
    this.root?.removeEventListener('pointerup', this.handlePointerUp);
    this.root?.removeEventListener('pointercancel', this.handlePointerUp);
    this.root?.removeEventListener('wheel', this.handleWheel);
    this.root?.removeEventListener('dblclick', this.handleDoubleClick);
    this.root?.removeEventListener('toggle', this.handleFoldToggle, true);
    this.root?.remove();
    this.root = null;
  }
}
