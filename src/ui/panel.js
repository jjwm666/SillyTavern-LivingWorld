import { DEFAULT_SETTINGS, PROMPT_PRESETS } from '../engine/constants.js';
import { byId, escapeHtml } from '../engine/utils.js';
import { icon } from './icons.js';
import {
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
    this.mapZoom = 1;
    this.mapPath = [];
    this.diceFilter = 'all';
    this.pointerGesture = null;
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
          <header class="lw-header"><div class="lw-header-world"><button class="lw-icon-button lw-mobile-menu" data-lw-action="toggle-nav" aria-label="切换导航">${icon('menu')}</button><div><span class="lw-kicker">WORLD OBSERVATORY</span><h1 id="lw-world-title">尚未初始化世界</h1></div></div><div class="lw-header-actions"><span id="lw-run-status" class="lw-run-status"><i></i><span>待命</span></span><button class="lw-icon-button" data-lw-action="evolve" title="立即推演一轮">${icon('play')}</button><button class="lw-icon-button" data-lw-action="close" aria-label="关闭">${icon('close')}</button></div></header>
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
    document.addEventListener('keydown', this.handleKeydown);
    this.applyAppearance();
    this.render();
    return this;
  }

  setData({ world, settings, status } = {}) {
    if (world !== undefined) this.world = world;
    if (settings) this.settings = { ...this.settings, ...settings };
    if (status) this.status = status;
    if (!this.selectedRegionId && this.world) this.selectedRegionId = this.world.player.regionId;
    if (!this.selectedFactionId && this.world) this.selectedFactionId = this.world.factions[0]?.id || null;
    this.applyAppearance();
    this.render();
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
    this.renderHeader();
    const content = this.root.querySelector('#lw-content');
    if (!this.world && this.activeTab !== 'settings') {
      content.innerHTML = renderEmpty(this.status);
    } else {
      switch (this.activeTab) {
        case 'player': content.innerHTML = renderPlayer(this.world); break;
        case 'people': content.innerHTML = renderPeople(this.world, this.peopleSearch); break;
        case 'map': content.innerHTML = renderMap(this.world, this.selectedRegionId, this.mapZoom, this.getMapScope()); break;
        case 'factions': content.innerHTML = renderFactions(this.world, this.selectedFactionId); break;
        case 'events': content.innerHTML = renderEvents(this.world); break;
        case 'dice': content.innerHTML = renderDice(this.world, this.diceFilter); break;
        case 'settings': content.innerHTML = renderSettings(this.settings, this.status, this.world); break;
        default: content.innerHTML = renderOverview(this.world);
      }
    }
    this.renderInspector();
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
    this.root.dataset.theme = this.settings.theme === 'light' ? 'light' : 'dark';
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
    const target = event.target.closest('[data-lw-action]');
    if (!target || !this.root.contains(target)) return;
    const action = target.dataset.lwAction;
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
        this.mapZoom = 1;
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
    if (action === 'save-world-editor') {
      const raw = this.root.querySelector('[data-lw-world-editor]')?.value || '';
      await this.callbacks.onEditWorld?.(raw);
      return;
    }
    if (action === 'faction-select') {
      this.selectedFactionId = target.dataset.id;
      this.render();
      return;
    }
    if (action === 'map-zoom-in' || action === 'map-zoom-out') {
      this.mapZoom = Math.max(0.8, Math.min(2, this.mapZoom + (action === 'map-zoom-in' ? 0.2 : -0.2)));
      this.render();
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
    if (action === 'initialize' && this.world && !window.confirm('重新初始化会替换当前聊天的世界。建议先导出存档，是否继续？')) return;
    if (action === 'reset' && !window.confirm('确定清除当前聊天的世界、骰点和检查点吗？此操作不可撤销。')) return;
    const callback = {
      initialize: this.callbacks.onInitialize,
      evolve: this.callbacks.onEvolve,
      export: this.callbacks.onExport,
      reset: this.callbacks.onReset,
      'test-api': this.callbacks.onTestApi,
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
      coreNpcLimit: Number(data.get('coreNpcLimit')),
      injectMaxChars: Number(data.get('injectMaxChars')),
      maxTokens: Number(data.get('maxTokens')),
      requestTimeout: Number(data.get('requestTimeout')),
    };
    this.settings = { ...this.settings, ...settings };
    await this.callbacks.onSettingsChange?.(settings);
  }

  handlePointerDown(event) {
    if (event.button !== 0) return;
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
    const gesture = this.pointerGesture;
    if (!gesture || gesture.id !== event.pointerId) return;
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
    const gesture = this.pointerGesture;
    if (!gesture || gesture.id !== event.pointerId) return;
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

  handleKeydown(event) {
    if (!this.root) return;
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
    this.root?.remove();
    this.root = null;
  }
}
