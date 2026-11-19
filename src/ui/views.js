import { ACTION_LABELS, CLAN_DEMANDS, FACTION_TIERS, PROMPT_PRESETS, RELATION_DIMENSIONS } from '../engine/constants.js';
import { clanStance, clanStanding, describeRelationTension } from '../engine/factions.js';
import { byId, escapeHtml, formatNumber, outcomeLabel, relationLabel } from '../engine/utils.js';
import { icon } from './icons.js';

const e = escapeHtml;

function sectionHeading(kicker, title, aside = '') {
  return `<div class="lw-section-heading"><div><span class="lw-kicker">${e(kicker)}</span><h2>${e(title)}</h2></div>${aside}</div>`;
}

function meter(value, className = '') {
  const safe = Math.max(0, Math.min(100, Number(value) || 0));
  return `<span class="lw-meter ${className}"><span style="width:${safe}%"></span></span>`;
}

function pill(value, tone = '') {
  return `<span class="lw-pill ${tone}">${e(value)}</span>`;
}

/** 可折叠区块：数值密集的面板默认收起，点开才展开细节。key 用于跨重绘记住展开状态。 */
function fold(title, body, options = {}) {
  const { open = false, hint = '', className = '', key = '' } = options || {};
  const foldKey = key || String(title).replace(/<[^>]*>/g, '').trim();
  return `<details class="lw-fold${className ? ` ${className}` : ''}" data-fold-key="${e(foldKey)}"${open ? ' open' : ''}><summary><span>${title}</span>${hint ? `<small>${hint}</small>` : ''}</summary><div class="lw-fold-body">${body}</div></details>`;
}

/** 缩放工具条：地图、关系图、势力图共用同一套视口逻辑。 */
function zoomBar(key, scale = 1) {
  const label = `${Math.round((Number(scale) || 1) * 100)}%`;
  return `<div class="lw-map-actions lw-zoom-actions"><button class="lw-icon-button" data-lw-action="view-zoom-out" data-key="${key}" title="缩小">${icon('zoomOut')}</button><span class="lw-map-zoom-value" data-lw-zoom-value>${label}</span><button class="lw-icon-button" data-lw-action="view-zoom-in" data-key="${key}" title="放大">${icon('zoomIn')}</button><button class="lw-icon-button" data-lw-action="view-zoom-reset" data-key="${key}" title="重置视图">${icon('refresh')}</button></div>`;
}

function zoomHint() {
  return '<div class="lw-map-hint" data-lw-map-hint>滚轮或双指缩放 · 按住空白处拖动平移 · 双击复位</div>';
}

function viewportTransform(view) {
  const safe = normalizeMapView(view || {});
  return `translate(${safe.x.toFixed(2)} ${safe.y.toFixed(2)}) scale(${safe.scale.toFixed(4)})`;
}

export function renderEmpty(status) {
  const busy = status?.kind === 'running';
  return `<section class="lw-empty lw-view-enter">
    <div class="lw-empty-orbit"><span></span><span></span><span></span>${icon('globe', 42)}</div>
    <span class="lw-kicker">A WORLD THAT DOES NOT WAIT FOR YOU</span>
    <h2>让世界在镜头之外继续生活</h2>
    <p>从当前角色卡与聊天设定生成地图、势力和核心人物。之后每次回复结束，人物会继续自己的计划，世界变化将在下一轮回到故事中。</p>
    <div class="lw-empty-features"><span>${icon('users')}独立认知</span><span>${icon('map')}路线地图</span><span>${icon('dice')}真实判定</span></div>
    <button class="lw-button lw-primary lw-large" data-lw-action="initialize" ${busy ? 'disabled' : ''}>${icon(busy ? 'clock' : 'plus')}${busy ? '正在初始化' : '从当前卡初始化世界'}</button>
    <small>初始化只创建当前聊天的独立世界，不会修改角色卡原文。</small>
  </section>`;
}

export function renderOverview(world) {
  const coreCount = world.npcs.filter((npc) => npc.core && npc.alive).length;
  const activeEvents = world.events.filter((event) => event.status === 'active');
  const recentLogs = [...world.logs].reverse().slice(0, 8);
  const lastDice = world.dice.filter((roll) => roll.round === world.round);
  const successCount = lastDice.filter((roll) => roll.outcome.includes('success')).length;
  const prosperity = Math.round(world.regions.reduce((sum, region) => sum + region.prosperity, 0) / world.regions.length);
  const chronicle = Array.isArray(world.chronicle) ? world.chronicle : [];
  const chronicleCount = (tier) => chronicle.filter((entry) => entry.tier === tier).length;
  const compressedTo = chronicle.reduce((max, entry) => Math.max(max, Number(entry.toRound) || 0), 0);
  const chronicleStrip = chronicle.length
    ? `<div class="lw-chronicle-strip"><span><strong>${chronicleCount(3)}</strong>纪年</span><span><strong>${chronicleCount(2)}</strong>辑要</span><span><strong>${chronicleCount(1)}</strong>近纪</span><small>第 ${compressedTo} 轮之前的旧事已压缩成条目，原始日志仍保存在存档里</small></div>`
    : '';
  const regionRows = [...world.regions].sort((a, b) => b.unrest - a.unrest).slice(0, 6).map((region) => {
    const faction = byId(world.factions, region.controlFactionId);
    return `<button class="lw-region-row" data-lw-action="region-select" data-id="${e(region.id)}">
      <span class="lw-region-swatch" style="--swatch:${e(faction?.color || '#65827c')}"></span>
      <span class="lw-region-row-name"><strong>${e(region.name)}</strong><small>${e(faction?.name || '无控制势力')}</small></span>
      <span class="lw-region-prosperity"><small>繁荣 ${region.prosperity}</small>${meter(region.prosperity)}</span>
      <span class="lw-unrest-value">${region.unrest}<small>动荡</small></span>
      ${icon('chevron', 15)}
    </button>`;
  }).join('');
  const timeline = recentLogs.map((log) => `<article class="lw-timeline-item">
    <span class="lw-timeline-marker lw-type-${e(log.type)}"></span>
    <div><div class="lw-timeline-meta"><span>ROUND ${String(log.round).padStart(3, '0')}</span><time>${e(log.type.toUpperCase())}</time></div><h3>${e(log.title)}</h3><p>${e(log.detail)}</p></div>
  </article>`).join('') || '<div class="lw-no-data">世界尚未留下第一轮记录。</div>';
  const eventCards = activeEvents.slice(0, 3).map((event) => `<article class="lw-event-mini">
    <div class="lw-event-mini-top">${pill(`Lv.${event.level}`, event.level >= 3 ? 'danger' : '')}<span>${e(event.stage)}</span></div>
    <h3>${e(event.name)}</h3><p>${e(event.description)}</p>
    <div class="lw-progress-label"><span>进程 ${event.progress}/${event.requiredProgress}</span><span>停滞 ${event.stalls}/3</span></div>${meter(event.progress / event.requiredProgress * 100, 'amber')}
  </article>`).join('') || '<div class="lw-no-data">当前没有持续事件。</div>';
  return `<div class="lw-overview lw-view-enter">
    <section class="lw-world-brief">
      <div class="lw-brief-copy"><span class="lw-kicker">WORLD PULSE / ${e(world.calendar.turnLabel)}</span><h2>${e(world.name)}</h2><p>${e(world.worldDigest)}</p>
        <div class="lw-trend-line">${world.trends.slice(0, 3).map((trend) => `<span>${icon('events', 13)}${e(trend.name)}<b>${trend.intensity}</b></span>`).join('')}</div>
      </div>
      <div class="lw-round-seal"><span>ROUND</span><strong>${String(world.round).padStart(3, '0')}</strong><small>${e(world.economy.climate)} · ${world.economy.priceIndex}</small></div>
    </section>
    <section class="lw-stat-grid">
      <button class="lw-stat" data-lw-action="tab" data-tab="people"><span class="lw-stat-icon">${icon('users')}</span><div><small>自主人物</small><strong>${coreCount}</strong><span>核心层逐人行动</span></div></button>
      <button class="lw-stat" data-lw-action="tab" data-tab="map"><span class="lw-stat-icon">${icon('map')}</span><div><small>世界区域</small><strong>${world.regions.length}</strong><span>${formatNumber(world.background.simulatedPeople)} 背景人口</span></div></button>
      <button class="lw-stat" data-lw-action="tab" data-tab="events"><span class="lw-stat-icon">${icon('events')}</span><div><small>持续事件</small><strong>${activeEvents.length}</strong><span>${world.rumors.filter((rumor) => rumor.active).length} 则风声传播中</span></div></button>
      <button class="lw-stat" data-lw-action="tab" data-tab="dice"><span class="lw-stat-icon">${icon('dice')}</span><div><small>本轮判定</small><strong>${lastDice.length}</strong><span>${lastDice.length ? Math.round(successCount / lastDice.length * 100) : 0}% 判定成功</span></div></button>
    </section>
    ${chronicleStrip}
    <div class="lw-dashboard-grid">
      ${fold(sectionHeading('LIVE CHRONICLE', '世界正在发生什么', `<button class="lw-text-button" data-lw-action="evolve">${icon('play', 14)}推进一轮</button>`), `<div class="lw-timeline">${timeline}</div>`, { open: true, className: 'lw-panel-span-2', key: 'overview-timeline' })}
      ${fold(sectionHeading('PRESSURE MAP', '地区压力', `<button class="lw-icon-button" data-lw-action="tab" data-tab="map" title="打开地图">${icon('map')}</button>`), `<div class="lw-region-list">${regionRows}</div>`, { open: false, key: 'overview-pressure', hint: `${world.regions.length} 个地区` })}
      ${fold(sectionHeading('UNFINISHED BUSINESS', '尚未结束的事件', `<button class="lw-text-button" data-lw-action="tab" data-tab="events">全部事件${icon('chevron', 13)}</button>`), `<div class="lw-event-mini-grid">${eventCards}</div>`, { open: true, className: 'lw-panel-span-2', key: 'overview-events' })}
      ${fold(sectionHeading('MACRO SIGNAL', '世界背景'), `<div class="lw-prosperity-ring" style="--value:${prosperity * 3.6}deg"><div><strong>${prosperity}</strong><span>平均繁荣</span></div></div>
        <p>${e(world.economy.lastSignal)}</p><small>${e(world.background.lastSettlement)}</small>`, { open: false, className: 'lw-economy-card', key: 'overview-macro', hint: `物价 ${world.economy.priceIndex}` })}
    </div>
  </div>`;
}

export function renderPlayer(world) {
  const playerRegion = byId(world.regions, world.player.regionId);
  const reputationMeta = [
    ['authority', '官方声誉', '权力机构与秩序维护者'],
    ['common', '民间声誉', '普通居民与地方社群'],
    ['shadow', '灰色声誉', '秘密网络与地下交易'],
    ['circuit', '行路声誉', '商旅、旅人与专业圈子'],
  ];
  const activeHooks = (world.storyHooks || []).filter((hook) => ['active', 'approaching'].includes(hook.status));
  const ledger = [...world.economy.ledger].reverse().slice(0, 14).map((entry) => `<div class="lw-ledger-row"><span><strong>${e(entry.reason)}</strong><small>第 ${entry.round} 轮 · ${e(byId(world.regions, entry.regionId)?.name || '未知地区')}</small></span><b class="${entry.amount >= 0 ? 'positive' : 'negative'}">${entry.amount >= 0 ? '+' : ''}${entry.amount}</b><span>余 ${entry.balance}</span></div>`).join('');
  const prices = [...world.regions].sort((a, b) => b.priceIndex - a.priceIndex).map((region) => `<button class="lw-price-row" data-lw-action="region-open" data-id="${e(region.id)}"><span>${e(region.name)}<small>${e(region.weather.type)} · 天气影响 ${region.weather.intensity}/3</small></span><b>${region.priceIndex}</b>${meter(Math.min(100, region.priceIndex / 2), region.priceIndex > 140 ? 'danger' : 'amber')}</button>`).join('');
  return `<section class="lw-career lw-view-enter">${sectionHeading('A LIFE INSIDE THE WORLD', '玩家生涯、声誉与经济', `<span class="lw-count-label">${e(playerRegion?.name || '未知所在地')}</span>`)}
    <div class="lw-career-hero"><div><span class="lw-kicker">CURRENT STANDING</span><h2>${e(world.player.name)}</h2><p>${e(playerRegion?.name || '未知')} · ${e(playerRegion?.weather.type || '未知天气')}</p></div><div class="lw-wallet"><small>可用资金</small><strong>${formatNumber(world.player.wealth)}</strong><span>累计收入 ${formatNumber(world.player.income)} · 累计支出 ${formatNumber(world.player.expenses)}</span></div></div>
    <div class="lw-career-grid">${fold(`<div class="lw-panel-heading"><h3>四维声誉</h3><span>实际影响玩家行动修正与势力态度</span></div>`, `<div class="lw-reputation-grid">${reputationMeta.map(([key, label, description]) => { const value = world.player.reputation[key]; return `<article><div><strong>${label}</strong><b class="${value < 0 ? 'negative' : 'positive'}">${value > 0 ? '+' : ''}${value}</b></div><p>${description}</p>${meter(value + 50, value < -20 ? 'danger' : 'teal')}</article>`; }).join('')}</div><h4>势力对玩家的态度</h4><div class="lw-player-factions">${world.factions.map((faction) => `<button data-lw-action="faction-open" data-id="${e(faction.id)}"><span><i style="background:${e(faction.color)}"></i>${e(faction.name)}</span><b>${faction.playerRelation > 0 ? '+' : ''}${faction.playerRelation}</b><small>${e(relationLabel(faction.playerRelation))}</small></button>`).join('')}</div>`, { open: true, key: 'player-reputation', hint: '声誉与势力态度' })}
    ${fold(`<div class="lw-panel-heading"><h3>主动剧情与转折</h3><span>${activeHooks.length} 条进行中</span></div>`, `<div class="lw-story-hooks">${activeHooks.map((hook) => `<article class="lw-hook-${e(hook.kind)}"><span>${hook.kind === 'npc' ? 'NPC 主动行动' : hook.kind === 'complication' ? '意外波折' : '意外机会'} · ${hook.status === 'active' ? '可进入当前剧情' : '正在接近'}</span><h4>${e(hook.title)}</h4><p>${e(hook.content)}</p><small>第 ${hook.createdRound} 轮触发 · 第 ${hook.expiresRound} 轮后自然过期</small></article>`).join('') || '<div class="lw-no-data">NPC 的主动接触与极端骰点转折会出现在这里。</div>'}</div>`, { open: true, key: 'player-hooks', hint: `${activeHooks.length} 条` })}
    ${fold(`<div class="lw-panel-heading"><h3>地区物价与天气</h3><span>世界平均 ${world.economy.priceIndex}</span></div>`, `<div class="lw-price-list">${prices}</div>`, { open: false, key: 'player-prices', hint: `${world.regions.length} 个地区` })}
    ${fold(`<div class="lw-panel-heading"><h3>资金流水</h3><span>最近 ${Math.min(14, world.economy.ledger.length)} 笔</span></div>`, `<div class="lw-ledger">${ledger || '<div class="lw-no-data">推演后会产生补给、交易与行动收支。</div>'}</div>`, { open: false, key: 'player-ledger' })}</div>
  </section>`;
}

function relationTone(value) {
  if (value >= 25) return 'warm';
  if (value <= -25) return 'hostile';
  return 'neutral';
}

function personCard(npc, world) {
  const region = byId(world.regions, npc.locationId);
  const faction = byId(world.factions, npc.factionId);
  const plan = npc.plan;
  return `<button class="lw-person-card" data-lw-action="npc-select" data-id="${e(npc.id)}">
      <span class="lw-person-top"><span class="lw-avatar" style="--faction-color:${e(faction?.color || '#6d8dff')}">${e(npc.name.slice(0, 1))}</span><span class="lw-person-title"><strong>${e(npc.name)}</strong><small>${e(npc.role)}</small></span>${pill(npc.core ? '核心' : '背景', npc.core ? 'teal' : '')}</span>
      <span class="lw-person-goal"><small>长期目标</small><strong>${e(npc.goals[0]?.description || '尚未形成目标')}</strong></span>
      <span class="lw-person-location">${icon('map', 13)}${e(region?.name || '未知')}<i></i>${e(faction?.name || '无所属')}</span>
      <span class="lw-person-state"><span><small>情绪</small>${e(npc.mood.label)}</span><span><small>当前计划</small>${e(plan?.stage || '酝酿中')}</span><span>${icon('chevron', 16)}</span></span>
    </button>`;
}

/** 人物关系图：节点是人，边是他们之间的信任/敌意。可随时切回文字卡片。 */
/** 人物关系图：点谁就以谁为中心重新放射，再点别人可以换中心。 */
export function renderPeopleGraph(world, focusNpcId = null, search = '', view = {}) {
  const query = String(search || '').trim().toLowerCase();
  const matches = (npc) => !query || `${npc.name}${npc.role}`.toLowerCase().includes(query);
  const center = focusNpcId ? world.npcs.find((npc) => npc.id === focusNpcId && npc.alive) || null : null;
  const ring = center
    ? Object.entries(center.relationships || {})
      .map(([otherId, relation]) => ({ npc: byId(world.npcs, otherId), relation }))
      .filter((item) => item.npc && item.npc.alive && item.npc.id !== center.id && matches(item.npc))
      .sort((a, b) => {
        const weightA = Math.abs(Number(a.relation?.trust) || 0) + Math.abs(Number(a.relation?.fear) || 0) + Math.abs(Number(a.relation?.affection) || 0);
        const weightB = Math.abs(Number(b.relation?.trust) || 0) + Math.abs(Number(b.relation?.fear) || 0) + Math.abs(Number(b.relation?.affection) || 0);
        return weightB - weightA;
      })
      .slice(0, 12)
      .map((item) => item.npc)
    : world.npcs.filter((npc) => npc.alive && npc.core && matches(npc)).slice(0, 24);
  if (!center && !ring.length) return `<div class="lw-no-data">没有符合条件的人物。</div>`;
  const cx = 500;
  const cy = 305;
  const radiusOf = (npc) => (center && npc.id === center.id ? 32 : 15 + Math.round((Number(npc.attributes?.influence) || 5) * 0.9));
  const nodes = new Map();
  if (center) nodes.set(center.id, { npc: center, x: cx, y: cy, r: radiusOf(center) });
  ring.forEach((npc, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / Math.max(1, ring.length);
    nodes.set(npc.id, { npc, x: cx + Math.cos(angle) * 360, y: cy + Math.sin(angle) * 245, r: radiusOf(npc) });
  });
  const pairs = new Map();
  for (const { npc } of nodes.values()) {
    for (const [otherId, relation] of Object.entries(npc.relationships || {})) {
      if (!nodes.has(otherId) || otherId === npc.id) continue;
      const key = [npc.id, otherId].sort().join(':');
      const entry = pairs.get(key) || { ids: key.split(':'), trust: 0, hits: 0 };
      entry.trust += Number(relation?.trust) || 0;
      entry.hits += 1;
      pairs.set(key, entry);
    }
  }
  const edges = [...pairs.values()].map((pair) => {
    const from = nodes.get(pair.ids[0]);
    const to = nodes.get(pair.ids[1]);
    const trust = Math.round(pair.trust / Math.max(1, pair.hits));
    const related = center && pair.ids.includes(center.id);
    return `<line class="lw-person-edge ${relationTone(trust)}${related ? ' is-focus' : ''}" x1="${from.x.toFixed(1)}" y1="${from.y.toFixed(1)}" x2="${to.x.toFixed(1)}" y2="${to.y.toFixed(1)}" stroke-width="${(0.8 + Math.abs(trust) / 22).toFixed(2)}"><title>${e(from.npc.name)} ⇄ ${e(to.npc.name)}｜信任 ${trust}</title></line>`;
  }).join('');
  const nodeMarkup = [...nodes.values()].map(({ npc, x, y, r }) => {
    const faction = byId(world.factions, npc.factionId);
    const isCenter = center && npc.id === center.id;
    const labelY = y + r + 15;
    return `<g class="lw-person-node${isCenter ? ' is-focus' : ''}" data-lw-action="npc-focus" data-id="${e(npc.id)}" role="button" tabindex="0" aria-label="${e(npc.name)}，点击以他为中心">
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${e(faction?.color || '#6d8dff')}" fill-opacity="${isCenter ? 0.95 : 0.5}" stroke="${e(faction?.color || '#6d8dff')}" stroke-width="${isCenter ? 2.6 : 1.3}"></circle>
      <text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" class="lw-person-node-initial">${e(npc.name.slice(0, 1))}</text>
      <text x="${x.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" class="lw-person-node-name">${e(npc.name)}</text>
      ${isCenter ? `<text x="${x.toFixed(1)}" y="${(labelY + 14).toFixed(1)}" text-anchor="middle" class="lw-person-node-role">${e(npc.role)}</text>` : ''}
    </g>`;
  }).join('');
  const relations = center
    ? Object.entries(center.relationships || {})
      .map(([otherId, relation]) => {
        const other = byId(world.npcs, otherId);
        if (!other) return null;
        const trust = Math.round(Number(relation?.trust) || 0);
        return `<article class="lw-relation-row ${relationTone(trust)}">
          <span class="lw-relation-who"><strong>${e(other.name)}</strong><small>${e(other.role)}</small></span>
          <span class="lw-relation-meters"><span>信任 ${trust}</span><span>好感 ${Math.round(Number(relation?.affection) || 0)}</span><span>畏惧 ${Math.round(Number(relation?.fear) || 0)}</span><span>人情 ${Math.round(Number(relation?.debt) || 0)}</span></span>
        </article>`;
      })
      .filter(Boolean)
      .join('')
    : '';
  const side = center
    ? `<div class="lw-graph-focus"><span class="lw-kicker">CENTER</span><h3>${e(center.name)}</h3><p>${e(center.role)} · ${e(byId(world.regions, center.locationId)?.name || '未知地区')}</p>${center.routine ? `<small>日常：${e(center.routine)}</small>` : ''}
        <div class="lw-graph-focus-actions"><button class="lw-button lw-ghost" data-lw-action="npc-card" data-id="${e(center.id)}">人物名片</button><button class="lw-button lw-ghost" data-lw-action="npc-focus-clear">回到全局</button></div></div>
      ${fold(`关系细节（${Math.max(0, relations ? relations.split('<article').length - 1 : 0)} 人）`, `<div class="lw-relation-list">${relations || '<div class="lw-no-data">他还没有建立起值得记录的关系。</div>'}</div>`, { open: true })}`
    : '<div class="lw-no-data">点任意一个人物，这张图就会以他为中心重新放射；点侧栏可以看名片。</div>';
  return `<div class="lw-people-graph-layout">
    <div class="lw-map-canvas lw-zoomable" data-lw-pan-zoom="people" tabindex="0" role="application" aria-label="可缩放、可平移的人物关系图">
      <svg viewBox="0 0 1000 610" role="img" aria-label="人物关系图">
        <defs><pattern id="lw-person-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" stroke-width="0.6"></path></pattern></defs>
        <g data-lw-viewport transform="${viewportTransform(view)}">
          <rect x="-1200" y="-1200" width="3400" height="3000" fill="url(#lw-person-grid)" opacity="0.5"></rect>
          ${edges}
          ${nodeMarkup}
        </g>
      </svg>
      ${zoomHint()}
      <div class="lw-graph-legend"><span class="warm">信任</span><span class="neutral">往来</span><span class="hostile">敌意</span><span>${center ? '点别人可以换中心' : edges ? '点人物以他为中心' : '点一个人物，以他为中心展开关系'}</span></div>
    </div>
    <aside class="lw-people-graph-side">${side}</aside>
  </div>`;
}

export function renderPeople(world, search = '', mode = 'list', focusNpcId = null, view = {}) {
  const query = search.trim().toLowerCase();
  const npcs = world.npcs.filter((npc) => !query || `${npc.name}${npc.role}${npc.goals.map((goal) => goal.description).join('')}`.toLowerCase().includes(query));
  const isGraph = mode === 'graph';
  const cards = npcs.map((npc) => personCard(npc, world)).join('');
  const body = isGraph
    ? renderPeopleGraph(world, focusNpcId, search, view)
    : `<div class="lw-people-grid">${cards || '<div class="lw-no-data">没有符合条件的人物。</div>'}</div>`;
  return `<section class="lw-view-enter">${sectionHeading('AUTONOMOUS AGENTS', '人物不是等待玩家的道具', `<span class="lw-count-label">${npcs.length} / ${world.npcs.length} 人</span>`)}
    <div class="lw-toolbar">
      <label class="lw-search">${icon('search', 16)}<input data-lw-input="people-search" value="${e(search)}" placeholder="搜索名字、身份或目标" aria-label="搜索人物"></label>
      <div class="lw-mode-switch" role="group" aria-label="人物视图切换">
        <button class="${isGraph ? '' : 'is-active'}" data-lw-action="people-mode" data-mode="list">${icon('users', 14)}卡片</button>
        <button class="${isGraph ? 'is-active' : ''}" data-lw-action="people-mode" data-mode="graph">${icon('route', 14)}关系图</button>
      </div>
      ${isGraph ? zoomBar('people', normalizeMapView(view).scale) : ''}
      <span class="lw-toolbar-note">每个人只依据自己的记忆与听闻行动</span>
    </div>
    ${body}
  </section>`;
}

export const MAP_MIN_SCALE = 0.4;
export const MAP_MAX_SCALE = 4;

export function normalizeMapView(view) {
  const source = view && typeof view === 'object' ? view : {};
  const scale = Math.min(MAP_MAX_SCALE, Math.max(MAP_MIN_SCALE, Number(source.scale) || 1));
  const x = Number.isFinite(Number(source.x)) ? Number(source.x) : 0;
  const y = Number.isFinite(Number(source.y)) ? Number(source.y) : 0;
  return { scale, x, y };
}

export function renderMap(world, selectedRegionId, view = {}, scope = {}) {
  const regions = scope.regions || world.regions;
  const path = scope.path || [];
  const parent = path.at(-1) || null;
  const selected = byId(regions, selectedRegionId);
  const mapView = normalizeMapView(view);
  const lines = [];
  const seen = new Set();
  for (const region of regions) {
    for (const edge of region.neighbors) {
      const target = byId(regions, edge.targetId);
      if (!target) continue;
      const key = [region.id, target.id].sort().join(':');
      if (seen.has(key)) continue;
      seen.add(key);
      const highlighted = selected && (region.id === selected.id || target.id === selected.id);
      lines.push(`<line class="lw-map-route ${highlighted ? 'highlighted' : ''}" x1="${region.x}" y1="${region.y}" x2="${target.x}" y2="${target.y}"><title>${e(region.name)} ↔ ${e(target.name)} · 距离 ${edge.distance}</title></line>`);
    }
  }
  const nodes = regions.map((region) => {
    const faction = byId(world.factions, region.controlFactionId);
    const active = selected?.id === region.id;
    const npcCount = world.npcs.filter((npc) => npc.alive && npc.locationId === region.id).length;
    const childCount = region.children?.length || 0;
    return `<g class="lw-map-node ${active ? 'active' : ''}" data-lw-action="region-select" data-id="${e(region.id)}" role="button" tabindex="0" aria-label="${e(region.name)}${childCount ? `，包含 ${childCount} 个次级区域` : ''}">
      <circle class="lw-map-node-halo" cx="${region.x}" cy="${region.y}" r="${active ? 34 : 28}"/>
      <circle class="lw-map-node-core" cx="${region.x}" cy="${region.y}" r="19" style="--region-color:${e(faction?.color || '#65827c')}"/>
      <text class="lw-map-node-symbol" x="${region.x}" y="${region.y + 4}" text-anchor="middle">${e(region.name.slice(0, 1))}</text>
      <text class="lw-map-node-label" x="${region.x}" y="${region.y + 42}" text-anchor="middle">${e(region.name)}</text>
      <text class="lw-map-node-meta" x="${region.x}" y="${region.y + 57}" text-anchor="middle">${childCount ? `${childCount} 个次级 · ` : `${npcCount} 人 · `}${e(region.weather.type)}</text>
      ${childCount ? `<text class="lw-map-node-children" x="${region.x + 24}" y="${region.y - 20}" text-anchor="middle">+${childCount}</text>` : ''}
    </g>`;
  }).join('');
  const breadcrumbs = `<nav class="lw-map-breadcrumbs" aria-label="地图层级"><button data-lw-action="map-root">世界</button>${path.map((region, index) => `<span>/</span><button data-lw-action="map-path" data-depth="${index}" class="${index === path.length - 1 ? 'current' : ''}">${e(region.name)}</button>`).join('')}</nav>`;
  return `<section class="lw-map-view lw-view-enter">${sectionHeading('GEOGRAPHY IS DESTINY', parent ? `${parent.name} · 次级地图` : '世界地图', zoomBar('map', mapView.scale))}
    ${breadcrumbs}<div class="lw-map-layout"><div class="lw-map-canvas lw-zoomable" data-lw-pan-zoom="map" tabindex="0" role="application" aria-label="可缩放、可拖动的区域地图">
      <svg viewBox="0 0 1000 560" role="img" aria-label="可点击的多级区域与路线图"><defs><pattern id="lw-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="currentColor" stroke-width=".5"/></pattern></defs>
        <g class="lw-map-viewport" data-lw-viewport transform="${viewportTransform(mapView)}">
          <rect class="lw-map-grid" x="-1200" y="-1200" width="3400" height="3000" fill="url(#lw-grid)"/>${lines.join('')}${nodes || '<text x="500" y="280" text-anchor="middle" class="lw-map-node-label">当前层级暂无区域</text>'}
        </g>
      </svg>
      ${zoomHint()}
      <div class="lw-map-legend"><span><i class="route"></i>同层可行路线</span><span><i class="node"></i>控制势力</span><span>选中含 +N 的区域后可进入下一级</span></div>
    </div>
    <aside class="lw-map-side">${selected ? renderRegionDetail(world, selected, regions) : '<div class="lw-side-placeholder">' + icon('map', 28) + `<p>当前为${parent ? `第 ${path.length + 1} 级区域` : '大区域'}。选择节点查看天气、路线与次级区域。</p>`}</aside></div>
  </section>`;
}

function renderRegionDetail(world, region, regions = world.regions) {
  const faction = byId(world.factions, region.controlFactionId);
  const people = world.npcs.filter((npc) => npc.locationId === region.id && npc.alive);
  const routes = region.neighbors.map((edge) => `<button data-lw-action="region-select" data-id="${e(edge.targetId)}"><span>${e(byId(regions, edge.targetId)?.name || edge.targetId)}</span><small>${e(edge.terrain)} · ${edge.distance}</small></button>`).join('');
  return `<div class="lw-region-detail"><span class="lw-kicker">REGION DOSSIER</span><h3>${e(region.name)}</h3><p>${e(region.description)}</p>
    ${region.children?.length ? `<button class="lw-button lw-primary lw-region-enter" data-lw-action="region-enter" data-id="${e(region.id)}">进入 ${region.children.length} 个次级区域${icon('chevron', 14)}</button>` : ''}
    ${fold('地区数值', `<div class="lw-detail-stats"><span><small>控制势力</small><strong style="color:${e(faction?.color || '#fff')}">${e(faction?.name || '无')}</strong></span><span><small>背景人口</small><strong>${formatNumber(region.population)}</strong></span><span><small>当地天气</small><strong>${e(region.weather.type)} · ${region.weather.intensity}/3</strong></span><span><small>地方物价</small><strong>${region.priceIndex}</strong></span></div>
    <div class="lw-detail-meter"><span>繁荣 <b>${region.prosperity}</b></span>${meter(region.prosperity)}</div><div class="lw-detail-meter"><span>动荡 <b>${region.unrest}</b></span>${meter(region.unrest, 'danger')}</div>`, { open: true, key: `region-stats-${region.id}`, hint: `繁荣 ${region.prosperity} · 动荡 ${region.unrest}` })}
    ${fold('同层连接路线', `<div class="lw-route-list">${routes || '<p>当前层级没有登记路线。</p>'}</div>`, { open: false, key: `region-routes-${region.id}`, hint: `${region.neighbors.length} 条` })}
    ${fold(`当前人物 · ${people.length}`, `<div class="lw-mini-people">${people.map((npc) => `<button data-lw-action="npc-select" data-id="${e(npc.id)}"><span class="lw-avatar small">${e(npc.name[0])}</span><span>${e(npc.name)}<small>${e(npc.role)}</small></span></button>`).join('') || '<p>暂无核心人物停留。</p>'}</div>`, { open: true, key: `region-people-${region.id}`, hint: `${people.length} 人` })}
  </div>`;
}

export function renderFactions(world, selectedFactionId, view = {}) {
  const selected = byId(world.factions, selectedFactionId) || world.factions[0];
  const factionView = normalizeMapView(view);
  const columns = [150, 385, 620, 855];
  const positions = new Map();
  const groups = FACTION_TIERS.map((tier, index) => {
    const members = world.factions.filter((faction) => faction.tier === tier.id);
    const count = Math.max(members.length, 1);
    members.forEach((faction, memberIndex) => {
      positions.set(faction.id, { x: columns[index] || 855, y: 195 + (memberIndex + 0.5) * (330 / count) });
    });
    return { tier, members, x: columns[index] || 855, count: members.length };
  });
  const edges = [];
  const seen = new Set();
  for (const faction of world.factions) {
    for (const [targetId, relation] of Object.entries(faction.relations)) {
      const key = [faction.id, targetId].sort().join(':');
      if (seen.has(key) || !positions.has(targetId)) continue;
      seen.add(key);
      const sourcePosition = positions.get(faction.id);
      const targetPosition = positions.get(targetId);
      const dimensions = relation.dimensions || {};
      const hostile = (dimensions.hostility ?? 0) > (dimensions.trust ?? 0);
      const tone = relation.value >= 15 ? 'positive' : relation.value <= -15 ? 'negative' : 'neutral';
      edges.push(`<line class="lw-relation-edge ${tone} ${hostile ? 'entangled' : ''}" x1="${sourcePosition.x}" y1="${sourcePosition.y}" x2="${targetPosition.x}" y2="${targetPosition.y}" stroke-width="${0.8 + Math.abs(relation.value) / 30 + (relation.tension || 0) / 60}"><title>${e(faction.name)} ↔ ${e(byId(world.factions, targetId)?.name)}：${e(relation.label)} (${relation.value})${relation.tension >= 40 ? ` · 矛盾张力 ${Math.round(relation.tension)}` : ''}</title></line>`);
    }
  }
  const tierLabels = groups.map((group) => `<text class="lw-tier-label" x="${group.x}" y="138" text-anchor="middle">${e(group.tier.label)}${group.count ? ` · ${group.count}` : ''}</text>`).join('');
  const nodes = world.factions.map((faction) => {
    const position = positions.get(faction.id);
    const clanCount = faction.clans?.length || 0;
    return `<g class="lw-faction-node ${selected?.id === faction.id ? 'active' : ''}" data-lw-action="faction-select" data-id="${e(faction.id)}" role="button" tabindex="0" aria-label="${e(faction.name)}，${e(faction.status)}"><circle cx="${position.x}" cy="${position.y}" r="35" style="--faction-color:${e(faction.color)}"/><text x="${position.x}" y="${position.y + 4}" text-anchor="middle">${e(faction.name.slice(0, 2))}</text><text class="label" x="${position.x}" y="${position.y + 53}" text-anchor="middle">${e(faction.name)}</text>${clanCount ? `<text class="lw-faction-clan-badge" x="${position.x}" y="${position.y - 45}" text-anchor="middle">${clanCount} 派系</text>` : ''}</g>`;
  }).join('');
  const relationRows = selected ? Object.entries(selected.relations).map(([id, relation]) => {
    const other = byId(world.factions, id);
    const dimensions = relation.dimensions || {};
    const bars = RELATION_DIMENSIONS.map((dimension) => {
      const score = Math.round(Number(dimensions[dimension.key]) || 0);
      return `<span class="lw-relation-dimension" title="${e(dimension.label)}：${e(dimension.description)}"><small>${e(dimension.label)}</small><i class="tone-${e(dimension.tone)}" style="--score:${score}"></i><b>${score}</b></span>`;
    }).join('');
    return `<article class="lw-faction-relation"><header><strong>${e(other?.name || id)}</strong>${pill(relation.label, relation.value < -14 ? 'danger' : relation.value > 14 ? 'teal' : '')}<b>${relation.value > 0 ? '+' : ''}${relation.value}</b></header>
      ${fold('五个维度', `<div class="lw-relation-dimensions">${bars}</div>${relation.tension >= 30 ? `<p class="lw-relation-tension">矛盾张力 ${Math.round(relation.tension)} · ${e(describeRelationTension(dimensions) || '关系内部存在未解的张力')}</p>` : ''}`, { hint: relation.tension >= 30 ? `矛盾张力 ${Math.round(relation.tension)}` : '信任·利益·文化·畏惧·敌意' })}
      <small>${e(relation.lastChange || '近期关系无明显变化')}</small></article>`;
  }).join('') : '';
  const clanRows = selected ? (selected.clans || []).slice().sort((a, b) => b.strength - a.strength).map((clan) => {
    const demand = CLAN_DEMANDS[clan.demand];
    const standing = clanStanding(selected, clan);
    const stance = clanStance(clan);
    const body = `<div class="lw-clan-meters"><span><small>人心</small>${meter(clan.satisfaction, clan.satisfaction < 40 ? 'danger' : '')}<b>${clan.satisfaction}</b></span><span><small>势力</small>${meter(clan.strength, 'amber')}<b>${clan.strength}</b></span><span><small>与其他派系</small><b class="lw-clan-standing ${standing.tone}">${standing.label}</b><small>${standing.partner ? `与「${e(standing.partner)}」` : ''}</small></span></div><small class="lw-clan-note">${e(clan.note || demand?.description || '暂无异动')}</small>`;
    return `<article class="lw-clan-row"><header><strong>${e(clan.name)}</strong><span class="lw-clan-demand">${e(stance)}</span></header>${fold('人心、势力与关系', body, { hint: `人心 ${clan.satisfaction}｜势力 ${clan.strength}｜${standing.label}` })}</article>`;
  }).join('') : '';
  const overlord = byId(world.factions, selected?.overlordId);
  const vassals = selected ? world.factions.filter((faction) => faction.overlordId === selected.id) : [];
  const resources = selected ? `<div class="lw-faction-resources"><span><small>稳定</small><b>${selected.stability}</b>${meter(selected.stability)}</span><span><small>权威</small><b>${selected.authority}</b>${meter(selected.authority)}</span><span><small>团结</small><b>${selected.cohesion}</b>${meter(selected.cohesion)}</span><span><small>暗涌</small><b>${selected.tension}</b>${meter(selected.tension, 'danger')}</span><span><small>财富</small><b>${selected.resources.wealth}</b>${meter(selected.resources.wealth, 'amber')}</span><span><small>影响</small><b>${selected.resources.influence}</b>${meter(selected.resources.influence)}</span><span><small>人力</small><b>${selected.resources.manpower}</b>${meter(selected.resources.manpower)}</span></div>` : '';
  const detail = selected ? `<span class="lw-kicker">FACTION DOSSIER</span><div class="lw-faction-title"><span style="background:${e(selected.color)}"></span><div><h3>${e(selected.name)}</h3><p>${e(selected.description)}</p></div></div>
    <div class="lw-faction-tier"><span>${e(tierLabelOf(selected))}</span><span>${overlord ? `附属于 ${e(overlord.name)}` : vassals.length ? `统辖 ${vassals.length} 个势力` : '独立势力'}</span></div>
    ${fold('数值面板', resources, { hint: `稳定 ${selected.stability}｜暗涌 ${selected.tension}` })}
    <div class="lw-faction-goal"><small>长期目标</small><strong>${e(selected.goal)}</strong></div>
    <h4>内部派系</h4><div class="lw-clan-list">${clanRows || '<p class="lw-no-data">该势力尚未形成明显的内部派系。</p>'}</div>
    <h4>对外关系</h4><div class="lw-faction-relations">${relationRows || '<p class="lw-no-data">暂无对外关系记录。</p>'}</div>` : '';

  return `<section class="lw-view-enter">${sectionHeading('NO FACTION STANDS ALONE', '势力格局与内部派系', zoomBar('factions', factionView.scale))}
    <div class="lw-faction-layout"><div class="lw-map-canvas lw-faction-canvas lw-zoomable" data-lw-pan-zoom="factions" tabindex="0" role="application" aria-label="可缩放、可按层级查看的势力关系图">
      <svg viewBox="0 0 1000 620" role="img" aria-label="按层级排列的势力关系图">
        <g data-lw-viewport transform="${viewportTransform(factionView)}">
          <rect x="-1200" y="-1200" width="3400" height="3000" fill="none"></rect>
          ${tierLabels}${edges.join('')}${nodes}
        </g>
      </svg>
      ${zoomHint()}
      <div class="lw-graph-legend"><span class="positive">合作</span><span class="neutral">中立</span><span class="negative">冲突</span><span class="entangled">利益与仇恨纠缠</span></div>
    </div>
    <aside class="lw-faction-detail">${detail}</aside></div>
  </section>`;
}

function tierLabelOf(faction) {
  const tier = FACTION_TIERS.find((item) => item.id === faction.tier);
  return tier ? tier.label : '四级';
}

export function renderEvents(world) {
  const events = [...world.events].sort((a, b) => (a.status === 'active' ? -1 : 1) - (b.status === 'active' ? -1 : 1) || b.lastRound - a.lastRound);
  const cards = events.map((event) => {
    const region = byId(world.regions, event.regionId);
    const terminal = event.status !== 'active';
    const statusLabel = { completed: '已终局', failed: '已失败', archived: '已归档' }[event.status];
    return `<article class="lw-event-card ${terminal ? 'terminal' : ''}"><div class="lw-event-card-head"><div>${pill(event.type === 'conflict' ? '冲突' : '发展', event.type === 'conflict' ? 'danger' : 'teal')}${pill(`Lv.${event.level}`)}</div><button class="lw-pin-button ${event.pinned ? 'active' : ''}" data-lw-action="toggle-pin" data-kind="event" data-id="${e(event.id)}">${event.pinned ? '★ 已保留' : '☆ 保留'}</button></div><h3>${e(event.name)}</h3><p>${e(event.description)}</p><div class="lw-event-location">${icon('map', 13)}${e(region?.name || '未知区域')}<span>${e(event.stage)}</span></div><div class="lw-stage-track">${[0, 1, 2, 3].map((index) => `<span class="${event.progress / event.requiredProgress * 4 > index ? 'reached' : ''}"><i></i><small>${e(event.type === 'conflict' ? ['萌芽', '发酵', '逼近', '爆发'][index] : ['筹备', '执行', '关键', '完成'][index])}</small></span>`).join('')}</div><div class="lw-event-card-foot"><span>进度 ${event.progress}/${event.requiredProgress}</span><span>连续停滞 ${event.stalls}/3</span>${terminal ? pill(statusLabel || event.status) : ''}</div><small class="lw-retention-note">${event.pinned ? '永久保留，不自动归档' : `终局后保留 ${event.retention} 轮，再自动归档`} · 第 ${event.createdRound} 轮形成</small></article>`;
  }).join('');
  const rumors = world.rumors.filter((rumor) => rumor.active || rumor.pinned).map((rumor) => `<article class="lw-rumor-card"><div>${pill(rumor.type)}<button class="lw-pin-button ${rumor.pinned ? 'active' : ''}" data-lw-action="toggle-pin" data-kind="rumor" data-id="${e(rumor.id)}">${rumor.pinned ? '★ 已保留' : '☆ 保留'}</button></div><p>${e(rumor.content)}</p><footer><span>${icon('route', 13)}已至 ${rumor.locations.length} 个地区</span><span>当前强度 ${rumor.locations.reduce((sum, location) => sum + location.strength, 0)}</span></footer><small>${rumor.pinned ? '已阻止自然消散' : rumor.active ? '传播停滞时强度逐步衰减，全部归零后消散' : '已消散，仅在保留期内留档'}</small></article>`).join('');
  return `<section class="lw-view-enter">${sectionHeading('CAUSE BEFORE EFFECT', '事件与风声', `<span class="lw-count-label">${world.events.filter((event) => event.status === 'active').length} 个活跃事件</span>`)}
    ${fold('持续事件', `<div class="lw-event-grid">${cards || '<div class="lw-no-data">暂无持续事件，下一轮会通过判定产生变化。</div>'}</div>`, { open: true, key: 'events-list', hint: `${world.events.length} 个` })}
    ${fold('风声传播、保留与消散', `<div class="lw-rumor-grid">${rumors || '<div class="lw-no-data">当前没有活跃或保留的风声。</div>'}</div>`, { open: true, key: 'events-rumors', hint: `${world.rumors.filter((rumor) => rumor.active || rumor.pinned).length} 则` })}
  </section>`;
}

export function renderDice(world, filter = 'all') {
  const classify = (roll) => {
    if (roll.actorId === 'player' || byId(world.npcs, roll.actorId)) return 'people';
    if (roll.action === 'regional_incident' || roll.action.startsWith('event_') || byId(world.events, roll.actorId)) return 'events';
    if (byId(world.factions, roll.actorId)) return 'factions';
    return 'world';
  };
  const counts = { all: world.dice.length, people: 0, events: 0, factions: 0, world: 0 };
  for (const roll of world.dice) counts[classify(roll)] += 1;
  const rolls = [...world.dice].reverse().filter((roll) => filter === 'all' || classify(roll) === filter);
  const rows = rolls.map((roll) => {
    const actor = byId(world.npcs, roll.actorId) || byId(world.factions, roll.actorId) || byId(world.regions, roll.actorId) || byId(world.events, roll.actorId);
    const base = roll.baseModifier ?? roll.modifier;
    const global = roll.globalModifier || 0;
    return `<article class="lw-dice-row"><div class="lw-die lw-${e(roll.outcome)}"><span>d20</span><strong>${roll.roll}</strong></div><div class="lw-dice-main"><div><strong>${e(actor?.name || (roll.actorId === 'world' ? '世界判定' : roll.actorId === 'player' ? '玩家' : roll.actorId))}</strong>${pill(ACTION_LABELS[roll.action] || roll.action)}<span class="lw-outcome lw-${e(roll.outcome)}">${e(outcomeLabel(roll.outcome))}</span></div><p>${e(roll.reason)}</p><small>ROUND ${roll.round} · ${e(roll.formula)} · 随机序列 #${roll.randomCall}</small><small class="lw-modifier-breakdown">情境修正 ${base >= 0 ? '+' : ''}${base} ${global ? `${global > 0 ? '+' : ''}${global}（用户全局修正）` : '＋ 全局修正 0'} ＝ 总修正 ${roll.modifier >= 0 ? '+' : ''}${roll.modifier}</small></div><div class="lw-dice-total"><strong>${roll.total}</strong><span>难度 ${roll.difficulty}</span></div></article>`;
  }).join('');
  const filters = [['all', '全部'], ['people', '人物与玩家'], ['events', '事件'], ['factions', '势力'], ['world', '天气/经济/地区']];
  return `<section class="lw-view-enter">${sectionHeading('THE MODEL PROPOSES, THE DICE DECIDE', '分类骰点判定档案', `<span class="lw-count-label">保留最近 ${world.dice.length} 次判定</span>`)}<div class="lw-dice-filters">${filters.map(([id, label]) => `<button class="${filter === id ? 'active' : ''}" data-lw-action="dice-filter" data-filter="${id}">${label}<span>${counts[id]}</span></button>`).join('')}</div>
    ${fold('判定规则说明', `<div class="lw-dice-explain">${icon('info', 16)}原值、情境修正、用户全局修正、难度与随机序列均独立记录。相同种子、设置和意图可以复现结果。</div>`, { open: false, key: 'dice-explain' })}
    ${fold('判定记录', `<div class="lw-dice-list">${rows || '<div class="lw-no-data">此分类暂时没有判定记录。</div>'}</div>`, { open: true, key: 'dice-list', hint: `${rows.length || 0} 条` })}
  </section>`;
}

export function renderSettings(settings, status, world) {
  const custom = settings.connectionMode === 'custom';
  const customPresets = Array.isArray(settings.customPromptPresets) ? settings.customPromptPresets : [];
  const presetOptions = [
    ...Object.entries(PROMPT_PRESETS).map(([id, preset]) => ({ id, name: preset.name })),
    ...customPresets.map((preset) => ({ id: preset.id, name: `${preset.name}（自定义）` })),
  ];
  return `<section class="lw-settings lw-view-enter">${sectionHeading('ENGINE CONTROL', '世界引擎设置', `<span class="lw-save-state">${e(status?.message || '设置自动保存在当前酒馆')}</span>`)}
    <form id="lw-settings-form" class="lw-settings-form">
      <details class="lw-fold lw-settings-section lw-fold-open" data-fold-key="设置·推演与判定" open><summary><h3>推演与判定</h3></summary><div class="lw-fold-body"><label class="lw-toggle-row"><span><strong>回复后自动记录与推演</strong><small>按下方间隔累计主 AI 回复，达到次数后推进一次世界</small></span><input type="checkbox" name="autoEvolve" ${settings.autoEvolve ? 'checked' : ''}><i></i></label><div class="lw-field-grid"><label>每 X 次回复推演一次<input type="number" name="evolutionInterval" min="1" max="20" value="${settings.evolutionInterval}"><small>1 表示每次回复；待推演进度会随聊天保存</small></label><label>用户全局骰点修正<input type="number" name="diceModifier" min="-10" max="10" value="${settings.diceModifier}"><small>-10 至 +10，叠加到每次本地判定并单独留档</small></label></div><label class="lw-toggle-row"><span><strong>无世界时自动初始化</strong><small>首次回复后根据当前角色卡建立世界</small></span><input type="checkbox" name="autoBootstrap" ${settings.autoBootstrap ? 'checked' : ''}><i></i></label><label class="lw-toggle-row"><span><strong>注入叙事者秘密</strong><small>默认关闭，避免主 AI 意外泄露 NPC 私人计划</small></span><input type="checkbox" name="includeSecrets" ${settings.includeSecrets ? 'checked' : ''}><i></i></label></div></details>
      <details class="lw-fold lw-settings-section lw-fold-open" data-fold-key="设置·外观与悬浮入口" open><summary><h3>外观与悬浮入口</h3></summary><div class="lw-fold-body"><div class="lw-field-grid"><label>面板主题<select name="theme"><option value="dark" ${settings.theme !== 'light' ? 'selected' : ''}>墨青深色</option><option value="light" ${settings.theme === 'light' ? 'selected' : ''}>纸墨浅色</option></select></label><label>悬浮按钮大小<input type="number" name="floatingSize" min="42" max="88" value="${settings.floatingSize}"><small>也可拖动悬浮球右下角调整</small></label></div><label class="lw-toggle-row"><span><strong>显示悬浮按钮</strong><small>关闭后仍可通过酒馆右上角菜单中的“万象世界引擎”打开</small></span><input type="checkbox" name="floatingButton" ${settings.floatingButton ? 'checked' : ''}><i></i></label></div></details>
      <details class="lw-fold lw-settings-section lw-prompt-section" data-fold-key="设置·提示词与自定义预设"><summary><h3>提示词与自定义预设</h3></summary><div class="lw-fold-body"><div class="lw-preset-row"><label>世界预设<select name="promptPreset">${presetOptions.map((preset) => `<option value="${e(preset.id)}" ${settings.promptPreset === preset.id ? 'selected' : ''}>${e(preset.name)}</option>`).join('')}</select></label><button type="button" class="lw-button" data-lw-action="apply-prompt-preset">载入预设</button><button type="button" class="lw-button" data-lw-action="delete-prompt-preset">删除自定义预设</button></div><div class="lw-preset-save"><input name="newPromptPresetName" maxlength="60" placeholder="新预设名称"><button type="button" class="lw-button" data-lw-action="save-prompt-preset">${icon('plus')}将当前内容另存为预设</button></div><div class="lw-prompt-grid"><label>初始化提示词<textarea name="bootstrapPrompt" rows="4" maxlength="6000" placeholder="控制地图、人物、势力和题材如何生成">${e(settings.bootstrapPrompt)}</textarea></label><label>每轮推演提示词<textarea name="evolutionPrompt" rows="4" maxlength="6000" placeholder="控制 NPC 行动偏好、事件密度和世界演化方向">${e(settings.evolutionPrompt)}</textarea></label><label class="lw-prompt-wide">自定义破限词<textarea name="jailbreakPrompt" rows="3" maxlength="6000" placeholder="填写需要同时附加到初始化与推演请求的自定义创作指令">${e(settings.jailbreakPrompt)}</textarea></label></div><p class="lw-field-help">自定义预设保存初始化、推演和破限词三项内容，只发送给后台世界模型，不修改酒馆全局预设或聊天记录。</p></div></details>
      <details class="lw-fold lw-settings-section" data-fold-key="设置·后台 API"><summary><h3>后台 API</h3></summary><div class="lw-fold-body"><div class="lw-segmented"><label><input type="radio" name="connectionMode" value="st" ${!custom ? 'checked' : ''}><span>酒馆当前连接</span></label><label><input type="radio" name="connectionMode" value="custom" ${custom ? 'checked' : ''}><span>独立兼容接口</span></label></div><div class="lw-custom-api ${custom ? '' : 'muted'}"><label>Base URL<input name="customBaseUrl" value="${e(settings.customBaseUrl)}" placeholder="https://provider.example/v1" autocomplete="off"></label><label>API Key<input type="password" name="customApiKey" value="${e(settings.customApiKey)}" placeholder="不会写入世界存档" autocomplete="off"></label><label>模型名<input name="customModel" list="lw-model-list" value="${e(settings.customModel)}" placeholder="model-name" autocomplete="off"></label><datalist id="lw-model-list"></datalist><div class="lw-custom-api-actions"><button type="button" class="lw-button" data-lw-action="fetch-models">${icon('refresh')}拉取模型列表</button><button type="button" class="lw-button" data-lw-action="test-api">${icon('check')}测试连接</button></div></div><p class="lw-field-help">Base URL 填到 /v1 或完整 /chat/completions。“拉取模型列表”会请求 /models 验证连通性并填入模型名下拉框；“测试连接”会真实生成一次 JSON 验证推演链路。酒馆连接模式使用 generateRaw 后台调用，模型跟随酒馆主 API。</p></div></details>
      <details class="lw-fold lw-settings-section lw-focus-section" data-fold-key="设置·派系、风声与相关性注入"><summary><h3>派系、风声与相关性注入</h3></summary><div class="lw-fold-body"><label class="lw-toggle-row"><span><strong>让世界模型自造内部派系</strong><small>开启后每轮可依据角色卡与局势提出新的内部派系，而不是只用内置名单</small></span><input type="checkbox" name="aiClans" ${settings.aiClans !== false ? 'checked' : ''}><i></i></label><label class="lw-toggle-row"><span><strong>按正文焦点注入</strong><small>世界仍然全量运转，但只把玩家所在地区、正文提到的人与其势力注入主 API</small></span><input type="checkbox" name="focusInjection" ${settings.focusInjection !== false ? 'checked' : ''}><i></i></label><div class="lw-field-grid"><label>焦点人物上限<input type="number" name="focusNpcLimit" min="3" max="16" value="${settings.focusNpcLimit}"></label><label>焦点势力上限<input type="number" name="focusFactionLimit" min="2" max="10" value="${settings.focusFactionLimit}"></label></div><p class="lw-field-help">风声分四层：官方通告传得最快也最可信，区域消息基本出不了本地，小道消息真假难辨，密闻几乎不扩散。层级与传播范围由推演决定，也可以在世界编辑器里逐个修改。</p></div></details>
      <details class="lw-fold lw-settings-section" data-fold-key="设置·日常、节令与存档压缩"><summary><h3>日常、节令与存档压缩</h3></summary><div class="lw-fold-body"><label class="lw-toggle-row"><span><strong>日常生活</strong><small>每轮让部分人物过自己的日子，产出不掷骰的生活细节</small></span><input type="checkbox" name="dailyLife" ${settings.dailyLife !== false ? 'checked' : ''}><i></i></label><div class="lw-field-grid"><label>每轮日常人物<input type="number" name="dailyActors" min="1" max="6" value="${settings.dailyActors}"></label><label>压缩间隔（成功推演次数）<input type="number" name="compressEvery" min="3" max="100" value="${settings.compressEvery}"><small>达到次数后把这段轮次压成一条纪要</small></label><label>一级合并为二级<input type="number" name="compressTier2Every" min="2" max="20" value="${settings.compressTier2Every}"><small>几条一级纪要合成一条辑要</small></label><label>二级合并为三级<input type="number" name="compressTier3Every" min="2" max="20" value="${settings.compressTier3Every}"><small>几条辑要合成一条纪年</small></label><label>未压缩保留轮次<input type="number" name="compressKeepRounds" min="0" max="40" value="${settings.compressKeepRounds}"><small>最近这些轮保持原样，保证细节不丢</small></label></div><label class="lw-toggle-row"><span><strong>启用存档压缩</strong><small>只用成功推演的轮次计数，重 roll 不会推动压缩</small></span><input type="checkbox" name="compressionEnabled" ${settings.compressionEnabled !== false ? 'checked' : ''}><i></i></label><label class="lw-toggle-row"><span><strong>节庆</strong><small>本地节日到日子会改变繁荣、动荡与物价</small></span><input type="checkbox" name="festivals" ${settings.festivals !== false ? 'checked' : ''}><i></i></label><label class="lw-prompt-wide">自定义节庆<textarea name="customFestivals" rows="3" maxlength="2000" placeholder="每行一个：名称|月-日|描述，例如&#10;灯河夜|7-15|全城放灯，河上挤满小船">${e(settings.customFestivals || '')}</textarea></label><p class="lw-field-help">节庆来源分三类：本地推演生成的、从角色卡世界书读到的、以及这里手写自定义的。压缩只处理已经写完的轮次，检查点与重 roll 逻辑不受影响。</p></div></details>
      <details class="lw-fold lw-settings-section" data-fold-key="设置·规模与上下文"><summary><h3>规模与上下文</h3></summary><div class="lw-fold-body"><div class="lw-field-grid"><label>核心 NPC 上限<input type="number" name="coreNpcLimit" min="1" max="100" value="${settings.coreNpcLimit}"></label><label>注入字符上限<input type="number" name="injectMaxChars" min="1000" max="30000" step="500" value="${settings.injectMaxChars}"></label><label>生成 Token 上限<input type="number" name="maxTokens" min="1000" max="64000" step="1000" value="${settings.maxTokens}"></label><label>请求超时（秒）<input type="number" name="requestTimeout" min="10" max="600" value="${settings.requestTimeout}"></label></div></div></details>
      <details class="lw-fold lw-settings-section lw-inject-section" data-fold-key="设置·注入主 API 的方式"><summary><h3>注入主 API 的方式</h3></summary><div class="lw-fold-body"><div class="lw-field-grid"><label>注入深度（距最新消息条数）<input type="number" name="injectDepth" min="0" max="8" value="${settings.injectDepth}"></label><label class="lw-inline-check"><input type="checkbox" name="injectGuide" ${settings.injectGuide !== false ? 'checked' : ''}><span>附带「世界档案｜既定事实 + 写作要求」结构</span></label></div><label class="lw-prompt-wide">附加写作要求<textarea name="injectGuideText" rows="3" maxlength="2000" placeholder="例如：请在正文中体现势力之间的试探与暗流，但不要直接点明数字与派系名称">${e(settings.injectGuideText || '')}</textarea></label><p class="lw-field-help">结构开启时，注入内容会以 system 身份、用 &lt;living_world&gt; 标签包裹，并附带「当作既定事实写进正文、不复述数字」等写作要求；深度 0 表示紧贴本轮输入，主 API 最不容易忽略。若你的主模型仍然大量复述条目，把深度调到 0 并关闭「附带写作要求」试一次，再对比效果。</p></div></details>
      <details class="lw-fold lw-settings-section" data-fold-key="设置·用户世界编辑器"><summary><h3>用户世界编辑器</h3></summary><div class="lw-fold-body"><details class="lw-world-editor" ${world ? '' : 'disabled'}><summary>直接修改当前世界 JSON</summary><p>可修改人物目标与位置、区域层级和天气、势力关系、事件进度、风声、玩家资金与声誉等全部内容。保存时会校验 ID、数值范围和地图连接。</p><textarea data-lw-world-editor spellcheck="false" rows="18" placeholder="初始化或导入世界后可编辑">${world ? e(JSON.stringify(world, null, 2)) : ''}</textarea><button type="button" class="lw-button lw-primary" data-lw-action="save-world-editor" ${world ? '' : 'disabled'}>${icon('check')}校验并保存世界修改</button></details></div></details>
      <details class="lw-fold lw-settings-section" data-fold-key="设置·存档与维护"><summary><h3>存档与维护</h3></summary><div class="lw-fold-body"><div class="lw-settings-actions"><button type="button" class="lw-button" data-lw-action="export">${icon('download')}导出世界</button><button type="button" class="lw-button" data-lw-action="import">${icon('upload')}导入世界</button><button type="button" class="lw-button" data-lw-action="cancel-evolve">${icon('stop')}取消后台推演</button><button type="button" class="lw-button lw-danger-button" data-lw-action="reset">${icon('alert')}重建世界</button></div><p class="lw-field-help">世界按聊天保存；导出文件不包含 API Key。重建会清除当前聊天的世界与检查点。推演进行中可点击“取消后台推演”或面板顶部的停止按钮立即中止，本轮不会写入世界。</p></div></details>
      <div class="lw-settings-footer"><button type="submit" class="lw-button lw-primary">${icon('check')}保存设置</button></div>
    </form>
  </section>`;
}

export function renderNpcInspector(world, npc) {
  const region = byId(world.regions, npc.locationId);
  const faction = byId(world.factions, npc.factionId);
  const relations = Object.entries(npc.relationships).map(([id, relation]) => {
    const other = byId(world.npcs, id);
    return `<div><span>${e(other?.name || id)}</span><strong>${relation.trust > 0 ? '+' : ''}${relation.trust}</strong><small>信任</small></div>`;
  }).join('');
  return `<div class="lw-inspector-content"><div class="lw-inspector-person"><span class="lw-avatar large" style="--faction-color:${e(faction?.color || '#6d8dff')}">${e(npc.name[0])}</span><div><span class="lw-kicker">PRIVATE DOSSIER</span><h2>${e(npc.name)}</h2><p>${e(npc.role)} · ${e(region?.name || '未知')}</p></div></div><p class="lw-inspector-description">${e(npc.description)}</p>
    ${fold('目标与计划', `${npc.goals.map((goal) => `<div class="lw-goal-row"><span>${e(goal.description)}</span><b>优先级 ${goal.priority}</b>${meter(goal.progress)}</div>`).join('')}<div class="lw-current-plan"><small>当前私人计划 · 主持人可见</small><strong>${e(npc.plan?.goal || '尚未形成')}</strong><span>${e(npc.plan?.stage || '酝酿中')} ${npc.plan ? `${npc.plan.progress}/${npc.plan.requiredProgress}` : ''}</span></div>`, { open: true, key: `npc-goals-${npc.id}`, hint: `${npc.goals.length} 条` })}
    ${fold('性格与需求', `<div class="lw-trait-grid">${Object.entries(npc.personality).map(([key, value]) => `<span><small>${e({ ambition: '野心', empathy: '共情', caution: '谨慎', loyalty: '忠诚' }[key] || key)}</small><b>${value}</b>${meter(value * 10)}</span>`).join('')}</div><div class="lw-needs-row"><span>安全 ${npc.needs.safety}/10</span><span>资源 ${npc.needs.wealth}/10</span><span>归属 ${npc.needs.belonging}/10</span></div>`, { open: false, key: `npc-traits-${npc.id}` })}
    ${fold('人物关系', `<div class="lw-relationship-grid">${relations || '<p>尚未建立重要私人关系。</p>'}</div>`, { open: true, key: `npc-relations-${npc.id}`, hint: `${Object.keys(npc.relationships).length} 人` })}
    ${fold('私人记忆', `<div class="lw-memory-list">${[...npc.memories].reverse().slice(0, 8).map((memory) => `<article><span>R${memory.round}</span><p>${e(memory.content)}</p></article>`).join('') || '<p>暂无私人记忆。</p>'}</div>`, { open: false, key: `npc-memories-${npc.id}`, hint: `${npc.memories.length} 条` })}
    ${fold('秘密', `<p class="lw-secret">${npc.secrets.map((secret) => e(secret)).join('<br>') || '没有已登记秘密'}</p>`, { open: false, key: `npc-secrets-${npc.id}`, hint: `${npc.secrets.length} 条` })}
  </div>`;
}
