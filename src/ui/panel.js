import { DEFAULT_SETTINGS } from '../engine/constants.js';
import { byId, escapeHtml } from '../engine/utils.js';
import { icon } from './icons.js';
import {
  renderDice, renderEmpty, renderEvents, renderFactions, renderMap,
  renderNpcInspector, renderOverview, renderPeople, renderSettings,
} from './views.js';

const tabs = [
  ['overview', '总览', 'globe'],
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
    this.root = null;
    this.opened = false;
    this.handleClick = this.handleClick.bind(this);
    this.handleInput = this.handleInput.bind(this);
    this.handleChange = this.handleChange.bind(this);
    this.handleSubmit = this.handleSubmit.bind(this);
    this.handleKeydown = this.handleKeydown.bind(this);
  }

  mount() {
    if (this.root) return this;
    this.root = document.createElement('div');
    this.root.id = 'living-world-root';
    this.root.innerHTML = `
      <button class="lw-floating" data-lw-action="toggle" aria-label="打开万象世界引擎" title="万象世界引擎"><span class="lw-floating-orbit"></span>${icon('globe', 25)}<i class="lw-floating-status"></i></button>
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
    document.addEventListener('keydown', this.handleKeydown);
    this.render();
    return this;
  }

  setData({ world, settings, status } = {}) {
    if (world !== undefined) this.world = world;
    if (settings) this.settings = { ...this.settings, ...settings };
    if (status) this.status = status;
    if (!this.selectedRegionId && this.world) this.selectedRegionId = this.world.player.regionId;
    if (!this.selectedFactionId && this.world) this.selectedFactionId = this.world.factions[0]?.id || null;
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
        case 'people': content.innerHTML = renderPeople(this.world, this.peopleSearch); break;
        case 'map': content.innerHTML = renderMap(this.world, this.selectedRegionId, this.mapZoom); break;
        case 'factions': content.innerHTML = renderFactions(this.world, this.selectedFactionId); break;
        case 'events': content.innerHTML = renderEvents(this.world); break;
        case 'dice': content.innerHTML = renderDice(this.world); break;
        case 'settings': content.innerHTML = renderSettings(this.settings, this.status); break;
        default: content.innerHTML = renderOverview(this.world);
      }
    }
    this.renderInspector();
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
    if (action === 'toggle') return this.toggle();
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
      if (this.activeTab !== 'map') this.activeTab = 'map';
      this.render();
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
      autoBootstrap: data.has('autoBootstrap'),
      includeSecrets: data.has('includeSecrets'),
      coreNpcLimit: Number(data.get('coreNpcLimit')),
      injectMaxChars: Number(data.get('injectMaxChars')),
      maxTokens: Number(data.get('maxTokens')),
      requestTimeout: Number(data.get('requestTimeout')),
    };
    this.settings = { ...this.settings, ...settings };
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
    this.root?.remove();
    this.root = null;
  }
}
