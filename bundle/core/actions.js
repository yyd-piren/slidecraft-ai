/**
 * 业务编排层：所有用户动作都经过这里。
 * UI 不直接改 Deck，也不直接碰 Anna API；AI 只通过注入的 adapter 访问。
 *
 * 阶段 2.5 的三个独立入口（互不复用业务逻辑）：
 *   A regenerateSlide      —— 按原始大纲与上下文重新生成当前页
 *   B applyAiEdit          —— 按用户自然语言描述修改当前页
 *   C applyAddSlide        —— 按描述创建新页面并插入指定位置
 *
 * 所有 AI 修改都：先存 before 快照 → adapter 返回结构化数据 → 校验 → 按 slide.id 局部写回
 * → 其他页面保持不变 → 记录前后对比与撤销点。主题修改只替换 deck.theme 字段。
 */
import * as D from './deck.js';
import { runMockExport } from '../export/exporter.js';

function themeSummary(t) {
  const x = D.normalizeTheme(t);
  return {
    name: x.name, background: x.background, primaryColor: x.primaryColor,
    titleColor: x.titleColor, titleSize: x.titleSize, bodySize: x.bodySize,
    spacing: x.spacing, decorationStyle: x.decorationStyle,
  };
}

function validateSlidePatch(patch, slideId) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('AI 返回的页面数据无效');
  if ('id' in patch && patch.id !== slideId) throw new Error('AI 返回值试图更换 slide.id，已拒绝');
  if ('points' in patch && !Array.isArray(patch.points)) throw new Error('AI 返回的要点不是数组');
  if ('elements' in patch && !Array.isArray(patch.elements)) throw new Error('AI 返回的页面元素不是数组');
  if ('layout' in patch && !D.LAYOUT_TYPES.includes(D.toLayout(patch.layout)) && !D.LAYOUT_TYPES.includes(patch.layout)) {
    throw new Error(`AI 返回了未知布局：${patch.layout}`);
  }
  return true;
}

export function createActions({ store, ai, platform, logbook }) {
  const storage = platform.storage;
  let saveTimer = null;
  let toastTimer = null;

  function toast(type, text) {
    store.set({ toast: { type, text } }, 'status');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => store.set({ toast: null }, 'status'), 4200);
  }

  async function persist() {
    const deck = store.get().deck;
    if (!deck) return;
    store.set({ saveState: 'saving' }, 'status');
    try {
      await storage.setJSON(D.DECK_STORAGE_KEY, { deck, savedAt: Date.now() });
      store.set({ saveState: 'saved' }, 'status');
    } catch (e) {
      store.set({ saveState: 'error' }, 'status');
      console.error('[SlideCraft] 草稿保存失败：', e);
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    store.set({ saveState: 'saving' }, 'status');
    saveTimer = setTimeout(persist, 650);
  }

  function applyDeck(next, channel = 'render') {
    store.set({ deck: next }, channel);
    scheduleSave();
  }

  async function run(label, fn) {
    if (store.get().busy) {
      toast('warning', '已有任务进行中，请稍候');
      return null;
    }
    store.set({ busy: label }, 'status');
    try {
      return await fn();
    } catch (e) {
      toast('error', e?.message || String(e));
      return null;
    } finally {
      store.set({ busy: null }, 'status');
    }
  }

  function op(fn, args = [], message = '') {
    const deck = store.get().deck;
    if (!deck) return;
    try {
      applyDeck(fn(deck, ...args));
      if (message) toast('success', message);
    } catch (e) {
      toast('error', e?.message || String(e));
    }
  }

  // ---------------- 撤销栈（页面修改 / 主题修改 / AI 新增页，最近 5 步） ----------------

  async function persistUndo(stack) {
    try {
      await storage.setJSON(D.UNDO_STORAGE_KEY, stack.slice(-5));
    } catch (e) {
      console.warn('[SlideCraft] 撤销记录保存失败：', e?.message || e);
    }
  }

  /** 同步记录撤销点；持久化放后台，避免 storage RPC 拖慢 UI 反馈。 */
  function pushUndo(entry) {
    const stack = [...store.get().undoStack, { ...entry, at: Date.now() }].slice(-5);
    store.set({ undoStack: stack }, 'status');
    Promise.resolve(persistUndo(stack)).catch(() => {});
  }

  async function undo() {
    const stack = store.get().undoStack;
    if (!stack.length) {
      toast('info', '目前没有可撤销的操作');
      return;
    }
    const item = stack[stack.length - 1];
    const deck = store.get().deck;
    if (!deck) return;
    let next;
    try {
      if (item.kind === 'slide') {
        if (!deck.slides.some((s) => s.id === item.slideId)) throw new Error('目标页面已不存在');
        next = D.applySlideSnapshot(deck, item.slideId, item.before);
      } else if (item.kind === 'theme') {
        next = { ...deck, theme: D.normalizeTheme(item.before), updatedAt: Date.now() };
      } else if (item.kind === 'newSlide') {
        next = deck.slides.some((s) => s.id === item.slideId)
          ? D.removeSlide(deck, item.slideId)
          : deck;
      } else throw new Error('未知的撤销类型');
    } catch (e) {
      toast('error', `撤销失败：${e?.message || e}`);
      return;
    }
    const selected = next.slides.some((s) => s.id === store.get().selectedSlideId)
      ? store.get().selectedSlideId
      : next.slides[0]?.id || null;
    const rest = stack.slice(0, -1);
    store.set({ deck: next, undoStack: rest, lastEdit: null, selectedSlideId: selected }, 'render');
    await persistUndo(rest);
    await persist();
    toast('success', `已撤销：${item.label}`);
  }

  function setUndoStack(stack) {
    store.set({ undoStack: Array.isArray(stack) ? stack.slice(-5) : [] }, 'status');
  }

  // ---------------- 视图导航 ----------------

  function goHome() { store.set({ view: 'home' }, 'render'); }
  function startCreate() {
    const state = store.get();
    const form = state.deck && !String(state.form.topic || '').trim()
      ? { ...D.defaultMeta(), ...state.deck.meta, theme: D.normalizeTheme(state.deck.theme).id }
      : state.form;
    store.set({ view: 'create', createError: '', form }, 'render');
  }
  function resumeDraft() {
    const d = store.get().deck;
    if (!d) return;
    const view = d.slides.length ? 'workspace' : d.outline.length ? 'outline' : 'create';
    store.set({ view, selectedSlideId: d.slides[0]?.id || null }, 'render');
  }
  function goOutline() { store.set({ view: 'outline' }, 'render'); }
  function setPropTab(tab) {
    if (!['content', 'ai', 'design'].includes(tab)) return;
    store.set({ propTab: tab }, 'render');
  }

  // ---------------- 创建页 ----------------

  function editForm(bind, value) {
    const form = { ...store.get().form };
    if (bind === 'theme') form.theme = value;
    else if (bind.startsWith('meta.')) {
      const key = bind.slice(5);
      form[key] = key === 'pageCount' ? Math.max(1, Number(value) || 1) : value;
    } else return;
    store.set({ form }, 'visual');
  }

  function setFormTheme(id) {
    if (!D.THEME_IDS.includes(id)) return;
    store.set({ form: { ...store.get().form, theme: id } }, 'render');
  }

  function fillDemo() {
    store.set(
      {
        form: {
          ...D.defaultMeta(),
          topic: '人工智能如何提升团队工作效率',
          audience: '部门负责人与项目团队',
          purpose: '工作汇报',
          pageCount: 8,
          extra: '请突出可落地的三步路径，并给出一个数据化成效示例。',
          theme: 'business',
        },
        createError: '',
      },
      'render',
    );
    toast('info', '已填入示例需求（演示数据）');
  }

  async function createAndGenerateOutline() {
    const form = store.get().form;
    if (!String(form.topic || '').trim()) {
      store.set({ createError: '请先填写 PPT 主题' }, 'status');
      return;
    }
    const { theme, ...meta } = form;
    meta.pageCount = Math.max(3, Math.min(20, Number(meta.pageCount) || 8));
    meta.topic = String(meta.topic).trim();
    const deck = D.createDeck(meta);
    deck.theme = D.normalizeTheme(theme);
    store.set({ deck, createError: '', hasDraft: true }, 'render');

    const res = await run('正在生成大纲（演示数据）', () => ai.generateOutline({ meta: deck.meta }));
    if (!res) return;
    const next = { ...deck, outline: res.outline, updatedAt: Date.now() };
    store.set({ deck: next, view: 'outline', selectedSlideId: null }, 'render');
    await persist();
    toast('success', `已生成 ${res.outline.length} 页大纲（演示数据）`);
  }

  async function regenerateOutline() {
    const deck = store.get().deck;
    if (!deck) return;
    const res = await run('正在重新生成大纲（演示数据）', () => ai.generateOutline({ meta: deck.meta }));
    if (!res) return;
    store.set({ deck: { ...deck, outline: res.outline, updatedAt: Date.now() } }, 'render');
    await persist();
    toast('success', '大纲已更新（演示数据）');
  }

  // ---------------- 大纲编辑 ----------------

  function outlineAdd() { op(D.addOutlineItem, [null], '已新增一页大纲'); }
  function outlineDel(id) { op(D.removeOutlineItem, [id], '已删除该页'); }
  function outlineMove(id, dir) { op(D.moveOutlineItem, [id, Number(dir)]); }

  // ---------------- A：重新生成当前页（按原始大纲） ----------------

  async function generateAllSlides() {
    const deck = store.get().deck;
    if (!deck || !deck.outline.length) {
      toast('error', '请先生成大纲');
      return;
    }
    const res = await run('正在生成全部页面内容（演示数据）', () =>
      ai.generateSlides({ meta: deck.meta, outline: deck.outline, existingSlides: deck.slides }),
    );
    if (!res) return;
    const next = D.mergeGeneratedSlides(deck, res.slides);
    store.set({ deck: next, view: 'workspace', selectedSlideId: next.slides[0]?.id || null, propTab: 'content' }, 'render');
    await persist();
    toast('success', `已生成 ${next.slides.length} 页内容（演示数据）`);
  }

  async function regenerateSlide(slideId) {
    const deck = store.get().deck;
    const slide = deck?.slides.find((s) => s.id === slideId);
    if (!deck || !slide) { toast('error', '找不到该页面'); return; }
    const res = await run('正在重新生成当前页（演示数据）', () =>
      ai.regenerateSlide({
        meta: deck.meta, slide: D.copy(slide),
        outlineItem: deck.outline.find((o) => o.id === slide.outlineId) || null,
      }),
    );
    if (!res) return;
    validateSlidePatch(res.patch, slideId);
    const before = D.copy(slide);
    const next = D.patchSlide(deck, slideId, res.patch);
    pushUndo({ kind: 'slide', slideId, before, label: '重新生成页面' });
    store.set({
      deck: next,
      lastEdit: { kind: 'slide', label: '重新生成页面', instruction: '按原始大纲重新生成', before: D.slideSummary(before), after: D.slideSummary(next.slides.find((s) => s.id === slideId)) },
    }, 'render');
    await persist();
    toast('success', '当前页已重新生成，其他页面保持不变');
  }

  // ---------------- B：按自然语言修改当前页 ----------------

  function setAiDraft(text) { store.setQuiet({ aiDraft: String(text) }); }
  function applySuggestion(text) {
    store.set({ aiDraft: String(text), propTab: 'ai' }, 'render');
  }
  function cancelAiEdit() {
    store.set({ aiDraft: '', propTab: 'content' }, 'render');
  }

  async function applyAiEdit() {
    const state = store.get();
    const deck = state.deck;
    const slideId = state.selectedSlideId;
    const instruction = String(state.aiDraft || '').trim();
    if (!deck || !slideId) { toast('error', '请先选择页面'); return; }
    if (!instruction) { toast('warning', '请先填写修改要求，或点击一条常用建议'); return; }
    const idx = deck.slides.findIndex((s) => s.id === slideId);
    const slide = deck.slides[idx];

    const res = await run('正在按描述修改当前页（演示数据）', () =>
      ai.editSlideByInstruction({
        instruction,
        slide: D.copy(slide),
        meta: D.copy(deck.meta),
        theme: D.normalizeTheme(deck.theme),
        prevSlide: idx > 0 ? D.slideSummary(deck.slides[idx - 1]) : null,
        nextSlide: idx < deck.slides.length - 1 ? D.slideSummary(deck.slides[idx + 1]) : null,
        outlineItem: deck.outline.find((o) => o.id === slide.outlineId) || null,
      }),
    );
    if (!res) return;
    try { validateSlidePatch(res.patch, slideId); }
    catch (e) { toast('error', `修改结果未通过校验：${e.message}`); return; }

    const before = D.copy(slide);
    const next = D.patchSlide(deck, slideId, res.patch);
    const after = next.slides.find((s) => s.id === slideId);
    if (after.id !== slideId) { toast('error', '页面 ID 被意外改变，已中止'); return; }
    pushUndo({ kind: 'slide', slideId, before, label: `按描述修改：${instruction.slice(0, 12)}` });
    store.set({
      deck: next,
      aiDraft: '',
      lastEdit: { kind: 'slide', label: '按描述修改', instruction, before: D.slideSummary(before), after: D.slideSummary(after) },
    }, 'render');
    await persist();
    toast('success', `已按描述修改第 ${idx + 1} 页（布局：${D.LAYOUT_LABELS[after.layout]}），其他页面未改动`);
  }

  // ---------------- C：按描述新增页面（可选插入位置） ----------------

  function openAddSlidePanel() {
    store.set({ modal: { type: 'add-slide' }, addDraft: { instruction: '', position: 'after' } }, 'status');
  }
  function setAddDraft(field, value) {
    const cur = store.get().addDraft;
    store.setQuiet({ addDraft: { ...cur, [field]: value } });
  }

  async function applyAddSlide() {
    const state = store.get();
    const deck = state.deck;
    const { instruction, position } = state.addDraft;
    if (!deck) return;
    if (!String(instruction || '').trim()) { toast('warning', '请描述要新增的页面内容'); return; }
    const idx = Math.max(0, deck.slides.findIndex((s) => s.id === state.selectedSlideId));
    const res = await run('正在按描述生成新页面（演示数据）', () =>
      ai.createSlideByInstruction({
        instruction,
        meta: D.copy(deck.meta),
        theme: D.normalizeTheme(deck.theme),
        prevSlide: deck.slides[idx] || null,
        nextSlide: deck.slides[idx + 1] || null,
      }),
    );
    if (!res) return;
    const at = position === 'start' ? 0 : position === 'end' ? deck.slides.length : Math.min(idx + 1, deck.slides.length);
    let next;
    try { next = D.insertSlideAt(deck, at, res.slide, res.outlineItem); }
    catch (e) { toast('error', `新增页面失败：${e.message}`); return; }
    const created = next.slides[at];
    pushUndo({ kind: 'newSlide', slideId: created.id, label: 'AI 新增页面' });
    store.set({
      deck: next,
      selectedSlideId: created.id,
      propTab: 'content',
      modal: null,
      addDraft: { instruction: '', position: 'after' },
      lastEdit: {
        kind: 'newSlide', label: 'AI 新增页面', instruction,
        before: { pages: deck.slides.length }, after: { pages: next.slides.length, layout: created.layout },
      },
    }, 'render');
    await persist();
    toast('success', `已在第 ${at + 1} 页位置新增「${created.title.slice(0, 16)}」`);
  }

  // ---------------- 页面设计 / 布局切换 ----------------

  async function applyLayout(layout) {
    const state = store.get();
    const deck = state.deck;
    const slideId = state.selectedSlideId;
    if (!deck || !slideId) return;
    const slide = deck.slides.find((s) => s.id === slideId);
    const res = await run('正在重新组织页面布局（演示数据）', () =>
      ai.changeSlideLayout({ slide: D.copy(slide), layout }),
    );
    if (!res) return;
    validateSlidePatch(res.patch, slideId);
    const before = D.copy(slide);
    const next = D.patchSlide(deck, slideId, res.patch);
    pushUndo({ kind: 'slide', slideId, before, label: '切换页面布局' });
    store.set({
      deck: next,
      lastEdit: { kind: 'slide', label: '切换页面布局', instruction: `切换为 ${D.LAYOUT_LABELS[D.toLayout(layout)]}`, before: D.slideSummary(before), after: D.slideSummary(next.slides.find((s) => s.id === slideId)) },
    }, 'render');
    await persist();
    toast('success', `已切换为「${D.LAYOUT_LABELS[D.toLayout(layout)]}」，原有文字与图表保留`);
  }

  // ---------------- 全局动态主题 ----------------

  function openThemePanel() {
    const deck = store.get().deck;
    if (!deck) { toast('warning', '请先创建演示文稿'); return; }
    store.set({ modal: { type: 'theme' }, themeDraft: D.normalizeTheme(deck.theme), themePrompt: '' }, 'status');
  }

  function setThemePrompt(text) { store.setQuiet({ themePrompt: String(text) }); }
  function applyThemeExample(text) {
    store.set({ themePrompt: String(text) }, 'status');
  }

  function updateThemeDraft(field, value) {
    const cur = store.get().themeDraft;
    let v = value;
    if (['titleSize', 'subtitleSize', 'bodySize', 'borderRadius'].includes(field)) v = Number(value) || 1;
    store.setQuiet({ themeDraft: D.normalizeTheme({ ...cur, [field]: v, id: 'custom' }) });
  }

  async function commitTheme(nextTheme, label, instruction = '') {
    const deck = store.get().deck;
    if (!deck) return;
    const before = D.normalizeTheme(deck.theme);
    const after = D.normalizeTheme(nextTheme);
    pushUndo({ kind: 'theme', before, label });
    // 关键：只替换 theme 字段，slides 数组引用完全不动，不重建任何页面数据。
    const next = { ...deck, theme: after, updatedAt: Date.now() };
    store.set({
      deck: next,
      lastEdit: { kind: 'theme', label, instruction, before: themeSummary(before), after: themeSummary(after) },
    }, 'render');
    await persist();
    toast('success', `已应用主题「${after.name}」，所有页面内容保持不变`);
  }

  function setTheme(id) {
    if (!D.THEME_IDS.includes(id)) return;
    return commitTheme(D.normalizeTheme(id), `切换预设主题：${D.THEME_PRESETS[id].name}`);
  }

  async function applyThemeByInstruction() {
    const state = store.get();
    const instruction = String(state.themePrompt || '').trim();
    if (!instruction) { toast('warning', '请先描述想要的视觉风格'); return; }
    const res = await run('正在生成主题设计（演示数据）', () =>
      ai.generateThemeByInstruction({ instruction, currentTheme: D.normalizeTheme(state.deck.theme) }),
    );
    if (!res) return;
    commitTheme(res.theme, `AI 主题设计：${res.theme.name}`, instruction);
  }

  function applyThemeDraft() {
    const draft = D.normalizeTheme(store.get().themeDraft);
    store.set({ modal: null }, 'status');
    return commitTheme(draft, `自定义主题：${draft.name}`);
  }

  // ---------------- 工作区编辑 ----------------

  function editField(bind, value, channel = 'visual') {
    const deck = store.get().deck;
    if (!deck) return;
    try { applyDeck(D.setFieldByBind(deck, bind, value), channel); }
    catch (e) { toast('error', e?.message || String(e)); }
  }

  function selectSlide(id) {
    const deck = store.get().deck;
    if (!deck || !deck.slides.some((s) => s.id === id)) return;
    store.set({ selectedSlideId: id }, 'render');
  }

  function slideAdd() {
    const state = store.get();
    if (!state.deck) return;
    try {
      const before = new Set(state.deck.slides.map((s) => s.id));
      const next = D.addSlide(state.deck, state.selectedSlideId);
      const fresh = next.slides.find((s) => !before.has(s.id));
      store.set({ deck: next, selectedSlideId: fresh?.id || state.selectedSlideId }, 'render');
      scheduleSave();
      toast('success', '已新增空白页面');
    } catch (e) { toast('error', e?.message || String(e)); }
  }

  function slideDel() {
    const state = store.get();
    const { deck, selectedSlideId: id } = state;
    if (!deck || !id) { toast('warning', '请先选择要删除的页面'); return; }
    try {
      const idx = deck.slides.findIndex((s) => s.id === id);
      const next = D.removeSlide(deck, id);
      const sel = next.slides[Math.min(idx, next.slides.length - 1)]?.id || null;
      store.set({ deck: next, selectedSlideId: sel }, 'render');
      scheduleSave();
      toast('success', '页面已删除');
    } catch (e) { toast('error', e?.message || String(e)); }
  }

  function slideMove(dir) {
    const state = store.get();
    if (!state.deck || !state.selectedSlideId) return;
    op(D.moveSlide, [state.selectedSlideId, Number(dir)]);
  }
  function pointAdd() {
    const state = store.get();
    if (!state.deck || !state.selectedSlideId) return;
    op(D.addPoint, [state.selectedSlideId]);
  }
  function pointDel(index) {
    const state = store.get();
    if (!state.deck || !state.selectedSlideId) return;
    op(D.removePoint, [state.selectedSlideId, Number(index)]);
  }

  // ---------------- 导出（仍为 Mock，阶段 3 才真实生成文件） ----------------

  async function exportPptx() {
    const deck = store.get().deck;
    if (!deck || !deck.slides.length) { toast('error', '请先生成页面内容再导出'); return; }
    if (store.get().busy) return;
    store.set({ modal: { type: 'export', stage: '准备中', percent: 0, steps: [], result: null } }, 'status');
    const result = await runMockExport({
      deck,
      onProgress: (p) => store.set({ modal: { type: 'export', ...p } }, 'status'),
    });
    store.set({ modal: { type: 'export', stage: '完成', percent: 100, steps: [], result } }, 'status');
    const next = { ...deck, exportInfo: { ...result, at: Date.now() }, updatedAt: Date.now() };
    store.set({ deck: next }, 'visual');
    await persist();
    await logbook?.write({
      mode: 'mock', action: 'export_pptx', model: null, quotaConsumed: 0,
      status: 'mock', outputChars: 0,
      note: '阶段 2.5 演示导出，未生成文件、未调用 upload.inline',
    });
  }

  function closeModal() { store.set({ modal: null }, 'status'); }
  function askResetDraft() { store.set({ modal: { type: 'confirm-reset' } }, 'status'); }

  async function resetDraft() {
    try { await storage.setJSON(D.DECK_STORAGE_KEY, { deck: null, savedAt: Date.now() }); }
    catch (e) { toast('error', `清除草稿失败：${e?.message || e}`); return; }
    store.set({
      deck: null, hasDraft: false, view: 'home', selectedSlideId: null,
      saveState: 'idle', modal: null, lastEdit: null, undoStack: [], propTab: 'content',
    }, 'render');
    await persistUndo([]);
    toast('info', '草稿已清除');
  }

  return {
    goHome, startCreate, resumeDraft, goOutline, setPropTab,
    editForm, setFormTheme, fillDemo, createAndGenerateOutline, regenerateOutline,
    outlineAdd, outlineDel, outlineMove,
    generateAllSlides, regenerateSlide,
    setAiDraft, applySuggestion, cancelAiEdit, applyAiEdit,
    openAddSlidePanel, setAddDraft, applyAddSlide,
    applyLayout,
    openThemePanel, setThemePrompt, applyThemeExample, updateThemeDraft,
    applyThemeByInstruction, applyThemeDraft, setTheme,
    undo, setUndoStack,
    editField, selectSlide, slideAdd, slideDel, slideMove, pointAdd, pointDel,
    exportPptx, closeModal, askResetDraft, resetDraft, persist, toast,
  };
}
