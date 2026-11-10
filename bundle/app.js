/**
 * SlideCraft AI — bundle 入口（阶段 4）。
 *
 * 启动顺序：连接 Runtime → 读草稿 → 渲染 UI。
 * 关键约束：页面初始化只读 storage，绝不发起任何 AI 调用；刷新、热更新、普通编辑
 * 都不可能产生 CU 消耗。只有用户明确点击生成按钮才会走 Provider。
 *
 * AI 模式：
 * - 生产（非 localhost）默认真实 AnnaAIProvider；
 * - 本地 dev / 独立预览默认 Mock，配合 anna-app dev --no-llm 做到零 CU；
 * - 显式 ?ai=anna / ?aiReal=1 才在本地启用真实 Provider，且本地环境硬性 maxCalls=1
 *   （阶段 4 验收闸门，生产不限制）。
 */
import { connectPlatform } from './core/platform.js';
import { createStore } from './core/store.js';
import { createLogbook } from './ai/logbook.js';
import { createAiAdapter, resolveAiMode } from './ai/adapter.js';
import { createAnnaProvider } from './ai/anna-provider.js';
import { readableAiError } from './ai/errors.js';
import { createActions } from './core/actions.js';
import {
  DECK_STORAGE_KEY, UNDO_STORAGE_KEY, validateDeck, normalizeDeck, normalizeTheme, defaultMeta,
} from './core/deck.js';
import { renderApp } from './ui/views.js';
import { refreshVisuals } from './ui/workspace.js';
import { overlayHTML, patchStatus, fitSlides } from './ui/common.js';

const VIEW_TITLES = {
  home: 'SlideCraft AI',
  create: '创建演示文稿 · SlideCraft AI',
  outline: '编辑大纲 · SlideCraft AI',
  workspace: '编辑工作区 · SlideCraft AI',
};

async function boot() {
  const appEl = document.getElementById('app');
  const overlayEl = document.getElementById('overlay-root');

  const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
  // harness dashboard 会自行生成 iframe URL；iframe 与 dashboard 同源，
  // 因此父页面查询参数同样可用于切换模式与设置本次验证的调用上限。
  let parentSearch = '';
  try { parentSearch = window.parent !== window ? window.parent.location.search : ''; }
  catch { /* 跨源时忽略 */ }
  const allParams = new URLSearchParams(
    [location.search, parentSearch].filter(Boolean).map((s) => String(s).replace(/^\?/, '')).join('&'),
  );

  const platform = await connectPlatform();
  const store = createStore();
  const logbook = createLogbook(platform.storage);

  const requestedMode = resolveAiMode({
    hostname: location.hostname, search: location.search, parentSearch,
  });
  // 本地默认严格 1 次（防止误烧额度）；只有显式 aiMaxCalls=N 才放开，上限 50 次。
  // 生产环境不限制正常业务使用。
  const cap = Number(allParams.get('aiMaxCalls'));
  const maxCalls = Number.isFinite(cap) && cap >= 1
    ? Math.min(50, Math.floor(cap))
    : (isLocal ? 1 : Infinity);
  let savedModel = '';
  try { savedModel = window.localStorage.getItem('slidecraft:ai-model') || ''; }
  catch { /* 隐私模式下忽略 */ }
  let aiMode = requestedMode;
  let aiModeNote = '';
  let ai;
  try {
    ai = createAiAdapter({
      mode: requestedMode,
      logbook,
      anna: platform.anna,
      maxCalls,
      modelName: savedModel,
      onCall: (record) => {
        // 只记录脱敏元数据：task / model / usage / quotaConsumed，绝无凭据。
        const prov = ai?.provider;
        store.set({
          lastAiCall: {
            task: record.task, model: record.model, provider: record.provider,
            usage: record.usage, quotaConsumed: record.quotaConsumed,
            ok: record.ok, errorCode: record.errorCode, at: record.at,
            used: prov?.callCount ?? null,
            limit: Number.isFinite(prov?.maxCalls) ? prov.maxCalls : null,
          },
        }, 'status');
        // 每次真实调用后异步刷新余额（catalog 是能力发现，不产生推理、不扣 CU）。
        Promise.resolve(actions.refreshQuota()).catch(() => {});
      },
    });
  } catch (e) {
    // 初始化期没有宿主时明确告知并切到演示模式；这不是「调用失败后静默假装成功」。
    aiMode = 'mock';
    aiModeNote = `真实 AI 不可用，已切换演示模式：${readableAiError(e)}`;
    ai = createAiAdapter({ mode: 'mock', logbook });
  }

  const actions = createActions({ store, ai, platform, logbook });

  let lastView = null;

  function render(state) {
    appEl.innerHTML = renderApp(state);
    fitSlides();
    if (state.view !== lastView) {
      lastView = state.view;
      platform.setTitle(VIEW_TITLES[state.view] || VIEW_TITLES.home);
    }
  }
  function status(state) {
    overlayEl.innerHTML = overlayHTML(state);
    patchStatus(state);
  }
  function visual(state) {
    refreshVisuals(state);
  }

  store.on('render', render);
  store.on('status', status);
  store.on('visual', visual);

  // 只做 storage 读取来恢复草稿与撤销记录；旧版 Deck 会被 normalizeDeck 兼容升级。
  let saved = null;
  let undo = [];
  try { saved = await platform.storage.getJSON(DECK_STORAGE_KEY); }
  catch (e) { console.warn('[SlideCraft] 草稿读取失败：', e?.message || e); }
  try {
    const u = await platform.storage.getJSON(UNDO_STORAGE_KEY);
    if (Array.isArray(u)) undo = u.slice(-5);
  } catch { /* 没有撤销记录时忽略 */ }

  const candidate = saved?.deck;
  const check = candidate ? validateDeck(candidate) : { ok: false, errors: ['无草稿'] };
  const deck = check.ok ? normalizeDeck(candidate) : null;
  if (candidate && !check.ok) console.warn('[SlideCraft] 草稿结构无效，已忽略：', check.errors);

  store.set(
    {
      host: platform.kind,
      hostReason: platform.kind === 'host' ? '' : `未检测到 Anna 宿主，使用本地存储：${platform.reason}`,
      deck,
      hasDraft: !!deck,
      selectedSlideId: deck?.slides?.[0]?.id || null,
      view: 'home', // 总是先回首页，由用户点「继续上次草稿」进入工作区
      form: deck ? { ...defaultMeta(), ...deck.meta, theme: normalizeTheme(deck.theme).id } : store.get().form,
      saveState: deck ? 'saved' : 'idle',
      undoStack: deck ? undo : [],
      aiMode,
      aiModeNote,
      aiModel: aiMode === 'anna' ? savedModel : '',
      lastAiCall: null,
      aiError: null,
    },
    'render',
  );
  status(store.get());

  // 真实模式启动时拉一次模型目录 + 余额；失败只影响该区域显示，不阻断应用。
  if (aiMode === 'anna') Promise.resolve(actions.refreshQuota()).catch(() => {});

  function handleAction(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    const a = btn.dataset.action;
    switch (a) {
      case 'nav:home': return actions.goHome();
      case 'nav:create': return actions.startCreate();
      case 'draft:resume': return actions.resumeDraft();
      case 'draft:reset': return actions.askResetDraft();
      case 'draft:reset-confirm': return actions.resetDraft();
      case 'form:theme': return actions.setFormTheme(btn.dataset.theme);
      case 'form:demo': return actions.fillDemo();
      case 'form:submit': return actions.createAndGenerateOutline();
      case 'outline:regen': return actions.regenerateOutline();
      case 'outline:add': return actions.outlineAdd();
      case 'outline:del': return actions.outlineDel(btn.dataset.id);
      case 'outline:move': return actions.outlineMove(btn.dataset.id, btn.dataset.dir);
      case 'outline:slides': return actions.generateAllSlides();
      case 'ws:back': return actions.goOutline();
      case 'ws:select': return actions.selectSlide(btn.dataset.id);
      case 'ws:add': return actions.slideAdd();
      case 'ws:del': return actions.slideDel();
      case 'ws:move': return actions.slideMove(btn.dataset.dir);
      case 'ws:point-add': return actions.pointAdd();
      case 'ws:point-del': return actions.pointDel(btn.dataset.index);
      case 'ws:regen': return actions.regenerateSlide(store.get().selectedSlideId);
      case 'ws:export': return actions.exportPptx();
      // 阶段 2.5 新增
      case 'tab:set': return actions.setPropTab(btn.dataset.tab);
      case 'ai:suggestion': return actions.applySuggestion(btn.dataset.text);
      case 'ai:apply': return actions.applyAiEdit();
      case 'ai:cancel': return actions.cancelAiEdit();
      case 'add:open': return actions.openAddSlidePanel();
      case 'add:apply': return actions.applyAddSlide();
      case 'design:layout': return actions.applyLayout(btn.dataset.layout);
      case 'design:reorganize': {
        const s = store.get();
        const slide = s.deck?.slides.find((x) => x.id === s.selectedSlideId);
        return slide ? actions.applyLayout(slide.layout) : null;
      }
      case 'theme:open': return actions.openThemePanel();
      case 'theme:preset': return actions.setTheme(btn.dataset.id);
      case 'theme:example': return actions.applyThemeExample(btn.dataset.text);
      case 'theme:generate': return actions.applyThemeByInstruction();
      case 'theme:apply-draft': return actions.applyThemeDraft();
      case 'ai:refresh': return actions.refreshQuota();
      case 'undo:last': return actions.undo();
      case 'modal:close': return actions.closeModal();
      default: console.warn('[SlideCraft] 未处理的动作：', a);
    }
  }

  /** 弹窗/面板里的草稿输入：只同步内存，不重绘，保证输入焦点与光标位置不变。 */
  function handleDraft(bind, value) {
    const [scope, field] = bind.split('.');
    if (scope === 'add') actions.setAddDraft(field, value);
    else if (scope === 'theme') {
      if (field === 'prompt') actions.setThemePrompt(value);
      else actions.updateThemeDraft(field, value);
    }
  }

  function onInput(e) {
    const el = e.target;
    if (el.dataset.liveBind === 'aiDraft') { actions.setAiDraft(el.value); return; }
    if (el.dataset.draftBind) { handleDraft(el.dataset.draftBind, el.value); return; }
    const bind = el.dataset.bind;
    if (!bind) return;
    if (bind.startsWith('form:')) actions.editForm(bind.slice(5), el.value);
    else actions.editField(bind, el.value); // visual 通道：不重建 DOM
  }

  function onChange(e) {
    const el = e.target;
    if (!(el instanceof HTMLSelectElement)) return;
    if (el.dataset.action === 'ai:model') { actions.setModel(el.value); return; }
    if (el.dataset.draftBind) { handleDraft(el.dataset.draftBind, el.value); return; }
    const bind = el.dataset.bind;
    if (!bind) return;
    if (bind === 'theme') actions.setTheme(el.value);
    else if (bind.startsWith('form:')) actions.editForm(bind.slice(5), el.value);
    else actions.editField(bind, el.value, 'render'); // 结构性字段：重建视图
  }

  appEl.addEventListener('click', handleAction);
  appEl.addEventListener('input', onInput);
  appEl.addEventListener('change', onChange);
  overlayEl.addEventListener('click', handleAction);
  overlayEl.addEventListener('input', onInput);
  overlayEl.addEventListener('change', onChange);
  window.addEventListener('resize', () => fitSlides());
  window.addEventListener('unhandledrejection', (e) => {
    console.error('[SlideCraft] 未捕获的异步错误：', e.reason);
    actions.toast('error', `发生错误：${String(e.reason?.message || e.reason).slice(0, 120)}`);
  });

  // 本地调试钩子：仅在本机开发/本地 harness 暴露，Staging 域名下不存在。
  if (isLocal) {
    window.__SLIDECRAFT__ = {
      store, actions, ai, platform, logbook,
      aiMode, aiModeNote, requestedMode, maxCalls,
      // 供 E2E 用「注入的假 SDK」验证 Anna Provider，不产生任何真实 RPC。
      createAnnaProvider,
    };
  }
}

boot().catch((e) => {
  console.error('[SlideCraft] 启动失败：', e);
  const el = document.getElementById('app');
  if (el) el.innerHTML = `<div class="boot">启动失败：${String(e?.message || e)}</div>`;
});
