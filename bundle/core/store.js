/**
 * 极简状态容器（阶段 2.5 仅增字段，不改变三条更新通道的机制）。
 *
 *  - render  ：重建 #app（结构性操作：切视图、增删、排序、生成完成、切标签）
 *  - visual  ：只替换预览画布与当前缩略图内容，不重建任何输入框
 *  - status  ：只更新 #overlay-root 与顶栏状态文案
 *  - setQuiet：只改内存，不触发任何重绘 —— 供弹窗里的表单实时同步，避免打断输入焦点
 */
import { defaultMeta, normalizeTheme } from './deck.js';

const STATUS_KEYS = [
  'busy', 'toast', 'modal', 'saveState', 'host', 'hostReason', 'createError',
  'hasDraft', 'undoStack', 'lastEdit',
  // 阶段 4：AI 模式与真实调用反馈（只影响顶栏/浮层，不重建输入区）
  'aiMode', 'aiModeNote', 'lastAiCall', 'aiError',
  'aiModels', 'aiModel', 'aiQuota', 'aiQuotaAt', 'aiCatalogError',
];

export function createStore() {
  let state = {
    host: 'connecting',
    hostReason: '',
    view: 'home',
    form: { ...defaultMeta(), theme: 'business' },
    deck: null,
    hasDraft: false,
    selectedSlideId: null,
    busy: null,
    saveState: 'idle',
    toast: null,
    modal: null,
    createError: '',
    // 阶段 2.5
    propTab: 'content',          // content | ai | design
    aiDraft: '',                 // AI 修改指令
    addDraft: { instruction: '', position: 'after' },
    themeDraft: normalizeTheme('business'),
    themePrompt: '',             // 主题自然语言描述
    lastEdit: null,              // 修改前后对比快照
    undoStack: [],               // 最近 5 条可撤销记录
    // 阶段 4
    aiMode: 'mock',              // mock | anna
    aiModeNote: '',              // 真实 Provider 不可用时的明确说明（绝不静默降级）
    lastAiCall: null,            // 最近一次真实 llm.complete 的 model / usage / quotaConsumed
    aiError: null,               // 细粒度错误态 {code, message}
    aiModels: [],                // llm.catalog 返回的 text 模型列表
    aiModel: '',                 // 用户选择的模型（'' = 平台默认路由）
    aiQuota: null,               // 剩余 CU（number | null）
    aiQuotaAt: null,             // 上次刷新时间
    aiCatalogError: '',          // 目录/额度不可用时的可读说明
  };

  const listeners = { render: new Set(), visual: new Set(), status: new Set() };

  function emit(channel) {
    for (const fn of listeners[channel]) {
      try {
        fn(state);
      } catch (e) {
        console.error(`[SlideCraft] ${channel} 订阅者异常：`, e);
      }
    }
  }

  return {
    get: () => state,
    on(channel, fn) {
      if (!listeners[channel]) throw new Error(`未知事件通道：${channel}`);
      listeners[channel].add(fn);
      return () => listeners[channel].delete(fn);
    },
    set(patch, channel = 'render') {
      state = { ...state, ...patch };
      if (Object.keys(patch).some((k) => STATUS_KEYS.includes(k))) emit('status');
      if (channel === 'render') emit('render');
      else if (channel === 'visual') emit('visual');
    },
    /** 只同步内存，不重绘（弹窗输入框边打边存，焦点与光标保持不动）。 */
    setQuiet(patch) {
      state = { ...state, ...patch };
    },
  };
}
