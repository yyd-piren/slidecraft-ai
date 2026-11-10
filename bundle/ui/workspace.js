/**
 * 三栏 PPT 编辑工作区（阶段 2.5 增强）：
 * 左缩略图 / 中预览 / 右属性（内容编辑 · AI 修改 · 页面设计 三个标签）。
 * 文本编辑走 refreshVisuals（只替换画布与缩略图内容），不重建右侧输入框，焦点不丢。
 */
import { esc, renderSlideHTML } from '../render/layouts.js';
import { getTheme } from '../render/themes.js';
import { SLIDE_EDIT_SUGGESTIONS } from '../ai/mock.js';
import {
  LAYOUT_TYPES, LAYOUT_LABELS, EMPHASIS_STYLES, DECORATION_STYLES, DENSITY_STYLES,
} from '../core/deck.js';
import { selectHTML, fitSlides, compareTable } from './common.js';

const QUICK_LAYOUTS = ['flowchart', 'architecture', 'timeline', 'comparison', 'two-column', 'dashboard', 'chart', 'content'];

function currentIndex(state) {
  const idx = state.deck?.slides.findIndex((s) => s.id === state.selectedSlideId) ?? -1;
  return idx < 0 ? 0 : idx;
}

function thumbsHTML(state) {
  const deck = state.deck;
  return deck.slides
    .map((s, i) => {
      const active = s.id === state.selectedSlideId;
      return `<button class="thumb${active ? ' thumb--active' : ''}" data-action="ws:select" data-id="${s.id}" title="${esc(s.title)}">
        <div class="slide-frame" data-thumb-frame="${s.id}">${renderSlideHTML(s, deck.theme, { pageNo: i + 1 })}</div>
        <div class="thumb__meta">
          <b>${String(i + 1).padStart(2, '0')} · ${esc(LAYOUT_LABELS[s.layout] || s.layout)}</b>
          <span data-thumb-title="${s.id}">${esc(String(s.title || '').slice(0, 8))}</span>
        </div>
      </button>`;
    })
    .join('');
}

function pointsHTML(slide) {
  if (!slide.points.length) return '<div class="tiny" style="padding:6px 0">这一页还没有要点，点击下方按钮添加。</div>';
  return slide.points
    .map(
      (p, i) => `<div class="point-row">
        <span class="point-row__num">${i + 1}</span>
        <div class="point-row__fields">
          <input class="input" aria-label="要点 ${i + 1}" data-bind="slide:${slide.id}:points:${i}:text" value="${esc(p.text)}" />
          <textarea class="textarea" aria-label="要点 ${i + 1} 补充说明" data-bind="slide:${slide.id}:points:${i}:detail" placeholder="补充说明（可选）">${esc(p.detail)}</textarea>
        </div>
        <button class="icon-btn icon-btn--danger" data-action="ws:point-del" data-index="${i}" title="删除要点">×</button>
      </div>`,
    )
    .join('');
}

// ---------------- 标签一：内容编辑（阶段 2 的属性面板） ----------------

function contentTabHTML(state, slide) {
  const sid = slide.id;
  const themeId = state.deck.theme?.id || 'business';
  return `<div class="props">
    <div class="prop-section">
      <div class="prop-title">页面设置</div>
      <div class="field">
        <label class="field__label">页面类型</label>
        ${selectHTML(LAYOUT_TYPES.map((t) => ({ value: t, label: LAYOUT_LABELS[t] })), slide.type, `slide:${sid}:type`)}
      </div>
      <div class="field">
        <label class="field__label">全局主题</label>
        ${selectHTML(['business', 'academic'].map((id) => ({ value: id, label: getTheme(id).name })), themeId, 'theme')}
        <span class="field__hint">此处仅切预设；完整主题设计请用顶部「全局主题」</span>
      </div>
      <span class="tiny">页面 ID：${esc(sid)}</span>
    </div>

    <div class="prop-section">
      <div class="prop-title">文字内容</div>
      <div class="field"><label class="field__label">页面标题</label>
        <input class="input" data-bind="slide:${sid}:title" value="${esc(slide.title)}" /></div>
      <div class="field"><label class="field__label">副标题 / 眉标</label>
        <input class="input" data-bind="slide:${sid}:subtitle" value="${esc(slide.subtitle)}" /></div>
      <div class="field"><label class="field__label">核心要点</label>
        <div class="stack">${pointsHTML(slide)}</div>
        <button class="btn btn--secondary btn--sm btn--block" data-action="ws:point-add">+ 添加要点</button></div>
    </div>

    <div class="prop-section">
      <div class="prop-title">辅助内容</div>
      <div class="field"><label class="field__label">数据 / 案例</label>
        <textarea class="textarea" data-bind="slide:${sid}:evidence">${esc(slide.evidence)}</textarea></div>
      <div class="field"><label class="field__label">图片 / 图表建议</label>
        <input class="input" data-bind="slide:${sid}:visualHint" value="${esc(slide.visualHint)}" /></div>
      <div class="field"><label class="field__label">演讲者备注</label>
        <textarea class="textarea" data-bind="slide:${sid}:notes">${esc(slide.notes)}</textarea></div>
    </div>
    ${compareTable(state)}
  </div>`;
}

// ---------------- 标签二：AI 修改（按自然语言修改当前页） ----------------

function aiTabHTML(state, slide, idx) {
  const canUndo = state.undoStack.length > 0;
  return `<div class="props">
    <div class="hint-box">
      <b>修改范围</b>：仅第 ${idx + 1} 页（ID ${esc(slide.id.slice(0, 14))}…）。其他页面、全局主题与大纲保持不变；修改后 <code>slide.id</code> 不变。
    </div>
    <div class="prop-section">
      <div class="prop-title">描述你想要的修改</div>
      <textarea class="textarea" data-live-bind="aiDraft" placeholder="例如：把这一页改成三层技术架构图，突出前端、业务服务和数据存储之间的调用关系。">${esc(state.aiDraft || '')}</textarea>
      <span class="field__hint">会连同前后页上下文、大纲条目与当前主题一起传给 AI Adapter（本阶段为本地 Mock）</span>
    </div>
    <div class="prop-section">
      <div class="prop-title">常用修改建议</div>
      <div class="chips">${SLIDE_EDIT_SUGGESTIONS.map(
        (s) => `<button class="chip" data-action="ai:suggestion" data-text="${esc(s)}">${esc(s)}</button>`,
      ).join('')}</div>
    </div>
    <div class="row" style="flex-wrap:wrap">
      <button class="btn btn--primary btn--sm" data-action="ai:apply">确认修改</button>
      <button class="btn btn--secondary btn--sm" data-action="ai:cancel">取消</button>
      <button class="btn btn--ghost btn--sm" data-action="undo:last"${canUndo ? '' : ' disabled'}>↶ 撤销</button>
    </div>
    ${compareTable(state)}
  </div>`;
}

// ---------------- 标签三：页面设计 ----------------

function designTabHTML(state, slide) {
  const sid = slide.id;
  const d = slide.design || {};
  const els = slide.elements || [];
  const links = els.filter((e) => e.kind === 'connector').length;
  return `<div class="props">
    <div class="hint-box">布局调整只重新组织页面结构，<b>标题、要点、数据、图表与演讲备注全部保留</b>。</div>
    <div class="prop-section">
      <div class="prop-title">页面布局（12 种）</div>
      ${selectHTML(LAYOUT_TYPES.map((t) => ({ value: t, label: LAYOUT_LABELS[t] })), slide.layout, `slide:${sid}:type`)}
      <div class="chips" style="margin-top:8px">${QUICK_LAYOUTS.map(
        (l) => `<button class="chip" data-action="design:layout" data-layout="${l}" data-id="${sid}">${esc(LAYOUT_LABELS[l])}</button>`,
      ).join('')}</div>
      <span class="field__hint">点击快捷布局会由 AI Adapter 生成对应的结构化元素与连线</span>
      <button class="btn btn--secondary btn--sm" data-action="design:reorganize">按当前布局重新组织元素</button>
    </div>
    <div class="prop-section">
      <div class="prop-title">视觉层级</div>
      <div class="field"><label class="field__label">强调重点</label>
        ${selectHTML(EMPHASIS_STYLES.map((v) => ({ value: v, label: ({ balanced: '均衡', title: '突出标题', data: '突出数据', visual: '突出视觉' })[v] })), d.emphasis, `slide:${sid}:design:emphasis`)}</div>
      <div class="field"><label class="field__label">装饰风格</label>
        ${selectHTML(DECORATION_STYLES.map((v) => ({ value: v, label: ({ minimal: '极简', rules: '细线', grid: '网格', blocks: '卡片描边', tech: '科技角标' })[v] })), d.decoration, `slide:${sid}:design:decoration`)}</div>
      <div class="field"><label class="field__label">信息密度</label>
        ${selectHTML(DENSITY_STYLES.map((v) => ({ value: v, label: ({ compact: '紧凑', normal: '标准', spacious: '宽松' })[v] })), d.density, `slide:${sid}:design:density`)}</div>
    </div>
    <div class="prop-section">
      <div class="prop-title">结构化元素 · ${els.length} 个 / ${links} 条连线</div>
      ${els.length
        ? `<ul class="element-list">${els.slice(0, 10).map(
            (e) => `<li><span class="el-kind">${esc(e.kind)}</span>${esc(e.title || e.text || e.from + ' → ' + e.to || '')}</li>`,
          ).join('')}${els.length > 10 ? `<li class="tiny">…还有 ${els.length - 10} 个</li>` : ''}</ul>`
        : '<div class="tiny">当前布局没有额外元素，使用要点文字渲染。</div>'}
    </div>
    ${compareTable(state)}
  </div>`;
}

function rightPanelHTML(state, slide, idx) {
  const tab = state.propTab || 'content';
  const tabs = [
    ['content', '内容编辑'], ['ai', 'AI 修改'], ['design', '页面设计'],
  ];
  return `<div class="ws__bar ws__bar--tabs">${tabs.map(
    ([key, label]) => `<button class="tab${tab === key ? ' tab--active' : ''}" data-action="tab:set" data-tab="${key}">${label}</button>`,
  ).join('')}</div>
    ${tab === 'ai' ? aiTabHTML(state, slide, idx) : tab === 'design' ? designTabHTML(state, slide) : contentTabHTML(state, slide)}`;
}

export function renderWorkspace(state) {
  const deck = state.deck;
  if (!deck || !deck.slides.length) {
    return `<div class="scroll"><div class="page">
      <h1 class="h1">还没有页面内容</h1>
      <p class="lede">请先回到大纲页生成页面内容。</p>
      <button class="btn btn--primary" style="margin-top:20px" data-action="ws:back">返回大纲</button>
    </div></div>`;
  }
  const idx = currentIndex(state);
  const slide = deck.slides[idx];
  const pageNo = idx + 1;
  const theme = getTheme(deck.theme);
  return `<div class="ws">
    <aside class="ws__left">
      <div class="ws__left-head">
        <span class="ws__bar-title">页面 · ${deck.slides.length}</span>
        <button class="btn btn--ghost btn--sm" data-action="ws:back">返回大纲</button>
      </div>
      <div class="thumb-list">${thumbsHTML(state)}</div>
      <div class="ws__left-foot">
        <button class="btn btn--secondary btn--sm" data-action="ws:add">+ 新增空白页</button>
        <button class="btn btn--secondary btn--sm" data-action="ws:del">删除页面</button>
        <button class="btn btn--secondary btn--sm" data-action="ws:move" data-dir="-1">↑ 上移</button>
        <button class="btn btn--secondary btn--sm" data-action="ws:move" data-dir="1">↓ 下移</button>
        <button class="btn btn--primary btn--sm span-2" data-action="add:open">✦ 按描述新增页面（AI）</button>
      </div>
    </aside>

    <section class="ws__center">
      <div class="ws__bar ws__bar--center">
        <div class="row"><span class="ws__bar-title">第 ${pageNo} / ${deck.slides.length} 页</span>
          <span class="tiny">布局：${esc(LAYOUT_LABELS[slide.layout] || slide.layout)}</span></div>
        <div class="row">
          <button class="btn btn--secondary btn--sm" data-action="ws:regen" title="按原始大纲重新生成当前页">重新生成页面</button>
          <button class="btn btn--secondary btn--sm" data-action="tab:set" data-tab="ai" title="按自然语言描述修改当前页">按描述修改</button>
          <button class="btn btn--primary btn--sm" data-action="ws:export">导出 PPTX</button>
        </div>
      </div>
      <div class="canvas-area"><div class="canvas-box">
        <div class="slide-frame" data-slide-canvas>${renderSlideHTML(slide, deck.theme, { pageNo })}</div>
        <div class="canvas-caption"><span>16:9 · 960 × 540 逻辑画布</span><span>主题：${esc(theme.name)}</span></div>
      </div></div>
      <div class="notes-box">
        <div class="notes-box__label">演讲者备注</div>
        <div class="notes-box__text" data-notes>${esc(slide.notes || '暂无演讲者备注')}</div>
      </div>
    </section>

    <aside class="ws__right">${rightPanelHTML(state, slide, idx)}</aside>
  </div>`;
}

/** 只重绘画布 / 当前缩略图 / 备注，绝不动右侧输入框（编辑焦点与未提交内容保持原样）。 */
export function refreshVisuals(state) {
  const deck = state.deck;
  if (!deck) return;
  const idx = currentIndex(state);
  const slide = deck.slides[idx];
  if (!slide) return;
  const html = renderSlideHTML(slide, deck.theme, { pageNo: idx + 1 });

  const canvas = document.querySelector('[data-slide-canvas]');
  if (canvas) canvas.innerHTML = html;

  const thumb = document.querySelector(`[data-thumb-frame="${CSS.escape(slide.id)}"]`);
  if (thumb) thumb.innerHTML = html;

  const title = document.querySelector(`[data-thumb-title="${CSS.escape(slide.id)}"]`);
  if (title) title.textContent = String(slide.title || '').slice(0, 8);

  const notes = document.querySelector('[data-notes]');
  if (notes) notes.textContent = slide.notes || '暂无演讲者备注';

  fitSlides();
}
