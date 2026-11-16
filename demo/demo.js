import { DEFAULT_SETTINGS } from '../src/engine/constants.js';
import { createDemoWorld } from '../src/engine/demo-world.js';
import { heuristicProposal } from '../src/engine/director.js';
import { evolveWorld } from '../src/engine/simulation.js';
import { normalizeWorld } from '../src/engine/state.js';
import { downloadJson, safeJsonParse } from '../src/engine/utils.js';
import { LivingWorldPanel } from '../src/ui/panel.js';

let world = createDemoWorld();
world = evolveWorld(world, heuristicProposal(world));
const settings = { ...DEFAULT_SETTINGS };
const panel = new LivingWorldPanel({
  onEvolve: () => {
    world = evolveWorld(world, heuristicProposal(world), settings);
    panel.setData({ world, status: { kind: 'ready', message: `第 ${world.round} 轮本地演示完成` } });
    panel.notify(`第 ${world.round} 轮推演完成`, 'success');
  },
  onInitialize: () => {
    world = createDemoWorld();
    panel.setData({ world, status: { kind: 'ready', message: '演示世界已重建' } });
  },
  onSettingsChange: (next) => {
    Object.assign(settings, next);
    panel.setData({ world, settings, status: { kind: 'ready', message: '演示设置已保存' } });
  },
  onExport: () => downloadJson('LivingWorld-demo.json', world),
  onImport: (raw) => {
    try {
      world = normalizeWorld(safeJsonParse(raw));
      panel.setData({ world });
      panel.notify('导入成功', 'success');
    } catch (error) {
      panel.notify(error.message, 'error');
    }
  },
  onEditWorld: (raw) => {
    try {
      world = normalizeWorld(safeJsonParse(raw));
      panel.setData({ world });
      panel.notify('世界修改已保存', 'success');
    } catch (error) {
      panel.notify(`保存失败：${error.message}`, 'error');
    }
  },
  onTogglePin: (kind, id) => {
    const item = (kind === 'rumor' ? world.rumors : world.events).find((entry) => entry.id === id);
    if (item) item.pinned = !item.pinned;
    panel.setData({ world });
  },
  onReset: () => {
    world = null;
    panel.setData({ world: null, status: { kind: 'idle', message: '演示世界已清除' } });
  },
  onTestApi: () => panel.notify('演示模式不会发起真实 API 请求'),
  onCancelEvolution: () => panel.notify('演示模式没有进行中的后台推演'),
  onFetchModels: async () => {
    panel.notify('演示模式不会请求模型列表');
    return [];
  },
});

panel.mount();
panel.setData({ world, settings, status: { kind: 'ready', message: '本地演示数据，不会调用 API' } });
panel.open();
