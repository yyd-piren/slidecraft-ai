/** 首页 / 创建页 / 大纲编辑页。工作区在 workspace.js 中单独实现。 */
import { esc } from '../render/layouts.js';
import { THEMES } from '../render/themes.js';
import {
  PURPOSE_OPTIONS, LANGUAGE_OPTIONS, STYLE_OPTIONS, DEPTH_OPTIONS,
  PAGE_TYPES, LAYOUT_LABELS,
} from '../core/deck.js';
import { selectHTML, shellHTML } from './common.js';
import { renderWorkspace } from './workspace.js';

export function renderApp(state) {
  let body;
  switch (state.view) {
    case 'create': body = createHTML(state); break;
    case 'outline': body = outlineHTML(state); break;
    case 'workspace': body = renderWorkspace(state); break;
    default: body = homeHTML(state);
  }
  return shellHTML(state, body);
}

function homeHTML(state) {
  const d = state.deck;
  const pages = d?.slides?.length || d?.outline?.length || 0;
  return `<div class="scroll"><div class="page">
    <section class="hero">
      <div class="eyebrow">AI PRESENTATION STUDIO</div>
      <h1 class="hero__title">从一个主题，到一份<br />可编辑的演示文稿</h1>
      <p class="hero__desc">输入需求，生成结构化大纲与逐页内容，在可视化工作区里逐页打磨，最后导出真正可编辑的 .pptx 文件。</p>
      <div class="hero__actions">
        <button class="btn btn--primary" data-action="nav:create">开始创作 <span class="btn__icon">→</span></button>
        <button class="btn btn--secondary" data-action="draft:resume"${d ? '' : ' disabled'}>
          ${d ? `继续上次草稿 · ${pages} 页` : '暂无已保存草稿'}
        </button>
      </div>
      <div class="hero__note">当前为演示数据模式：大纲与页面内容由本地 Mock 生成，不会调用 Anna AI，也不会消耗 CU。</div>
    </section>
    <section class="flow">
      <div class="flow__step"><span class="flow__num">1</span><div><div class="flow__title">描述需求</div><div class="flow__text">主题、受众、用途、页数、语言与风格</div></div></div>
      <div class="flow__step"><span class="flow__num">2</span><div><div class="flow__title">编辑大纲</div><div class="flow__text">逐页调整标题、观点与页面类型</div></div></div>
      <div class="flow__step"><span class="flow__num">3</span><div><div class="flow__title">打磨并导出</div><div class="flow__text">三栏工作区预览，导出可编辑 PPTX</div></div></div>
    </section>
    <div class="home__foot">
      <span class="tiny">SlideCraft AI · 阶段 2.5 · 自然语言改页 · 动态主题 · 12 种布局</span>
      ${d ? '<button class="btn btn--ghost btn--sm" data-action="draft:reset">清除已保存草稿</button>' : ''}
    </div>
  </div></div>`;
}

function themeCards(selected) {
  return Object.values(THEMES)
    .map((t) => {
      const active = t.id === selected;
      return `<button class="theme-card${active ? ' theme-card--active' : ''}" data-action="form:theme" data-theme="${t.id}">
        <span class="theme-card__swatch">${t.swatch.map((c) => `<i style="background:${c}"></i>`).join('')}</span>
        <span><span class="theme-card__name">${esc(t.name)}</span><span class="theme-card__desc">${esc(t.caption)}</span></span>
        ${active ? '<span class="theme-card__check">✓</span>' : ''}
      </button>`;
    })
    .join('');
}

function createHTML(state) {
  const f = state.form;
  return `<div class="scroll"><div class="page page--narrow">
    <div class="row row--between">
      <div><div class="eyebrow">STEP 01</div><h1 class="h1">创建演示文稿</h1>
        <p class="lede">先告诉 AI 你要讲什么。所有字段在生成大纲前都可以在此修改。</p></div>
      <button class="btn btn--ghost" data-action="nav:home">返回首页</button>
    </div>
    <div class="divider"></div>

    <section class="panel">
      <div class="panel__head">
        <div><div class="panel__title">内容需求</div><div class="panel__desc">带 * 为必填项；其余字段有默认值</div></div>
        <button class="btn btn--secondary btn--sm" data-action="form:demo">填入示例需求</button>
      </div>
      <div class="panel__body">
        <div class="form-grid">
          <div class="field span-2">
            <label class="field__label">PPT 主题<span class="req">*</span></label>
            <input class="input" data-bind="form:meta.topic" value="${esc(f.topic)}" placeholder="例如：人工智能如何提升团队工作效率" />
            <span class="field__hint">一句话描述这份演示要讲什么</span>
          </div>
          <div class="field">
            <label class="field__label">演示目的</label>
            ${selectHTML(PURPOSE_OPTIONS, f.purpose, 'form:meta.purpose')}
          </div>
          <div class="field">
            <label class="field__label">目标受众</label>
            <input class="input" data-bind="form:meta.audience" value="${esc(f.audience)}" placeholder="例如：部门负责人与项目团队" />
          </div>
          <div class="field">
            <label class="field__label">PPT 页数</label>
            <input class="input" type="number" min="3" max="20" data-bind="form:meta.pageCount" value="${Number(f.pageCount)}" />
            <span class="field__hint">3 – 20 页</span>
          </div>
          <div class="field">
            <label class="field__label">输出语言</label>
            ${selectHTML(LANGUAGE_OPTIONS, f.language, 'form:meta.language')}
          </div>
          <div class="field">
            <label class="field__label">演示风格</label>
            ${selectHTML(STYLE_OPTIONS, f.style, 'form:meta.style')}
          </div>
          <div class="field">
            <label class="field__label">内容详细程度</label>
            ${selectHTML(DEPTH_OPTIONS, f.depth, 'form:meta.depth')}
          </div>
          <div class="field span-2">
            <label class="field__label">补充要求</label>
            <textarea class="textarea" data-bind="form:meta.extra" placeholder="例如：请突出可落地的三步路径，并给出一个数据化成效示例">${esc(f.extra)}</textarea>
          </div>
        </div>
      </div>
    </section>

    <div style="height:18px"></div>
    <section class="panel">
      <div class="panel__head"><div><div class="panel__title">主题风格</div><div class="panel__desc">第一版提供两套主题，后续可在工作区随时切换</div></div></div>
      <div class="panel__body"><div class="theme-grid">${themeCards(f.theme)}</div></div>
    </section>

    <div class="row" style="margin-top:24px">
      <div class="field__error" data-create-error></div>
      <div class="row" style="margin-left:auto">
        <button class="btn btn--secondary" data-action="nav:home">取消</button>
        <button class="btn btn--primary" data-action="form:submit">生成大纲（演示数据）</button>
      </div>
    </div>
  </div></div>`;
}

function outlineHTML(state) {
  const d = state.deck;
  if (!d) return homeHTML(state);
  const m = d.meta;
  const rows = d.outline
    .map(
      (o, i) => `<div class="outline-row">
        <div class="outline-row__idx">${String(i + 1).padStart(2, '0')}</div>
        <div class="outline-row__fields">
          <input class="input" aria-label="章节" data-bind="outline:${o.id}:chapter" value="${esc(o.chapter)}" />
          <input class="input" aria-label="页面标题" data-bind="outline:${o.id}:title" value="${esc(o.title)}" />
          <input class="input" aria-label="核心观点" data-bind="outline:${o.id}:keyPoint" value="${esc(o.keyPoint)}" />
          ${selectHTML(
            PAGE_TYPES.map((t) => ({ value: t, label: LAYOUT_LABELS[t] })),
            o.pageType,
            `outline:${o.id}:pageType`,
          )}
        </div>
        <div class="outline-row__actions">
          <button class="icon-btn" data-action="outline:move" data-id="${o.id}" data-dir="-1" title="上移">↑</button>
          <button class="icon-btn" data-action="outline:move" data-id="${o.id}" data-dir="1" title="下移">↓</button>
          <button class="icon-btn icon-btn--danger" data-action="outline:del" data-id="${o.id}" title="删除">×</button>
        </div>
      </div>`,
    )
    .join('');

  return `<div class="scroll"><div class="page">
    <div class="row row--between">
      <div><div class="eyebrow">STEP 02</div><h1 class="h1">编辑大纲</h1>
        <p class="lede">逐页调整标题、核心观点与页面类型。确认后再生成每页的具体内容。</p></div>
      <div class="row">
        <button class="btn btn--secondary" data-action="outline:regen">重新生成大纲</button>
        <button class="btn btn--primary" data-action="outline:slides">生成全部页面内容 <span class="btn__icon">→</span></button>
      </div>
    </div>
    <div class="divider"></div>
    <div class="outline-summary">
      <span>主题 <b>${esc(m.topic)}</b></span><span>用途 <b>${esc(m.purpose)}</b></span>
      <span>受众 <b>${esc(m.audience)}</b></span><span>页数 <b>${d.outline.length}</b></span>
      <span>语言 <b>${esc(m.language)}</b></span><span>风格 <b>${esc(m.style)}</b></span>
    </div>
    <div class="outline-list">${rows || '<div class="tiny">暂无大纲条目，点击下方「新增页面」。</div>'}</div>
    <div class="outline-footer">
      <button class="btn btn--secondary" data-action="outline:add">+ 新增页面</button>
      <span class="tiny">修改大纲后，需点击「生成全部页面内容」才会同步更新已生成的页面文字。</span>
    </div>
    <div class="divider"></div>
    <div class="row row--between">
      <button class="btn btn--ghost" data-action="nav:create">← 返回修改需求</button>
      <span class="tiny">演示模式：本页所有 AI 操作均返回本地 Mock 数据，不产生 CU 消耗。</span>
    </div>
  </div></div>`;
}
