/**
 * 12 种页面布局的 HTML 预览渲染（阶段 2.5）。
 *
 * 设计约定（为阶段 3 的 PPTX 渲染预留）：
 * - 画布固定 960×540（16:9），所有元素为独立文本块 / 形状 / 连线，阶段 3 可一一映射为
 *   PowerPoint 中可编辑的对象，而不是把整页截图贴进幻灯片。
 * - 动态布局（two-column / comparison / timeline / flowchart / architecture / dashboard）
 *   由 slide.elements 驱动；没有元素时按 points 兜底生成，永远不会出现空白页。
 * - 主题变量（--c-* / --t-* / --sp-pad / --radius）驱动配色、字号与间距，
 *   因此切主题时所有页面同时改变，但页面文字内容完全不动。
 */
import { themeVars, isDarkBackground } from './themes.js';
import { normalizeTheme, toLayout, defaultDesign } from '../core/deck.js';
import {
  normalizeKind, LAYOUT_MAIN_KIND, hasUsableElements, enrichElements,
  elementTitle, elementItems, elementText, elementValue, pointsToItems,
} from './element-utils.js';

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 阶段 3：PPTX 渲染器按此清单生成可编辑对象（原生图表用 chart，不用图片）。 */
export const PPTX_LAYOUT_HINT = {
  title: { ratio: '16:9', objects: ['title', 'subtitle', 'rule', 'brand'], nativeChart: false },
  cover: { ratio: '16:9', objects: ['title', 'subtitle', 'rule', 'brand'], nativeChart: false },
  agenda: { ratio: '16:9', objects: ['title', 'indexedTextList'], nativeChart: false },
  content: { ratio: '16:9', objects: ['title', 'bullets', 'evidence'], nativeChart: false },
  'two-column': { ratio: '16:9', objects: ['title', 'columns', 'textBlocks'], nativeChart: false },
  'image-text': { ratio: '16:9', objects: ['title', 'bullets', 'placeholderShape', 'caption'], nativeChart: false },
  visual: { ratio: '16:9', objects: ['title', 'bullets', 'placeholderShape', 'caption'], nativeChart: false },
  chart: { ratio: '16:9', objects: ['title', 'bullets', 'nativeChart', 'evidence'], nativeChart: true },
  comparison: { ratio: '16:9', objects: ['title', 'columns', 'textBlocks', 'divider'], nativeChart: false },
  timeline: { ratio: '16:9', objects: ['title', 'axis', 'milestones', 'textBlocks'], nativeChart: false },
  flowchart: { ratio: '16:9', objects: ['title', 'nodes', 'connectors', 'textBlocks'], nativeChart: false },
  architecture: { ratio: '16:9', objects: ['title', 'layers', 'connectors', 'textBlocks'], nativeChart: false },
  dashboard: { ratio: '16:9', objects: ['title', 'metricCards', 'nativeChart'], nativeChart: true },
  summary: { ratio: '16:9', objects: ['title', 'conclusionCards', 'rule'], nativeChart: false },
};

function kicker(text) {
  return `<div class="sl-kicker">${esc(text)}</div>`;
}

function heading(title, tag = 'h2') {
  return `<${tag} class="sl-title">${esc(title || '未命名页面')}</${tag}><div class="sl-rule"></div>`;
}

function bullets(points) {
  if (!points || !points.length) {
    return '<div class="sl-empty">（暂无要点，可在右侧属性面板补充）</div>';
  }
  return `<ul class="sl-points">${points
    .map(
      (p, i) => `<li>
        <span class="sl-points__idx">${String(i + 1).padStart(2, '0')}</span>
        <div class="sl-points__body">
          <div class="sl-points__text">${esc(p.text)}</div>
          ${p.detail ? `<div class="sl-points__detail">${esc(p.detail)}</div>` : ''}
        </div>
      </li>`,
    )
    .join('')}</ul>`;
}

function evidenceLine(text) {
  return text ? `<div class="sl-evidence"><span>数据 / 案例</span>${esc(text)}</div>` : '';
}

function nativeChart(chart) {
  const labels = Array.isArray(chart?.labels) ? chart.labels : [];
  const values = Array.isArray(chart?.series?.[0]?.values) ? chart.series[0].values : [];
  if (!labels.length || !values.length) return '<div class="sl-empty">（暂无图表数据）</div>';
  const max = Math.max(1, ...values.map((v) => Number(v) || 0));
  return `<div class="sl-chart">
    <div class="sl-chart__plot">${labels
      .map((label, i) => {
        const v = Number(values[i]) || 0;
        return `<div class="sl-chart__col">
          <div class="sl-chart__value">${v}</div>
          <div class="sl-chart__track"><div class="sl-chart__bar" style="height:${Math.max(5, (v / max) * 100)}%"></div></div>
          <div class="sl-chart__label">${esc(label)}</div>
        </div>`;
      })
      .join('')}</div>
    ${chart?.note ? `<div class="sl-chart__note">${esc(chart.note)}</div>` : ''}
  </div>`;
}

// ---------------- 阶段 2 的六种基础布局（保持不变，仅由主题变量驱动） ----------------

function coverBody(s) {
  return `<div class="cover__mark">SLIDECRAFT AI</div>
    <div class="cover__main">
      <div class="cover__bar"></div>
      <h1 class="cover__title">${esc(s.title || '演示主题')}</h1>
      <p class="cover__sub">${esc(s.subtitle || '')}</p>
    </div>
    <div class="cover__shape" aria-hidden="true"></div>
    <div class="cover__foot">${esc(s.chapter || '')} &nbsp;·&nbsp; PRESENTATION</div>`;
}

function agendaBody(s) {
  return `<div class="sl-pad">
    ${kicker('CONTENTS')}${heading(s.title)}
    <div class="sl-agenda">${(s.points || [])
      .slice(0, 6)
      .map(
        (p, i) => `<div class="sl-agenda__row">
          <span class="sl-agenda__num">${String(i + 1).padStart(2, '0')}</span>
          <div><div class="sl-agenda__text">${esc(p.text)}</div>
          ${p.detail ? `<div class="sl-agenda__detail">${esc(p.detail)}</div>` : ''}</div>
        </div>`,
      )
      .join('')}</div>
  </div>`;
}

function contentBody(s) {
  return `<div class="sl-pad">
    ${kicker('OVERVIEW')}${heading(s.title)}
    ${bullets(s.points)}
    ${evidenceLine(s.evidence)}
  </div>`;
}

function imageTextBody(s) {
  return `<div class="sl-pad">
    ${kicker('STRUCTURE')}${heading(s.title)}
    <div class="sl-visual">
      <div class="sl-visual__text">${bullets(s.points)}</div>
      <div class="sl-visual__figure">
        <div class="figure__frame"><div class="figure__shape"></div><div class="figure__line"></div></div>
        <div class="figure__caption">${esc(s.visualHint || '配图建议')}</div>
      </div>
    </div>
  </div>`;
}

function chartBody(s) {
  const fallback = {
    labels: (s.points || []).slice(0, 4).map((p, i) => `阶段${i + 1}`),
    series: [{ name: s.title, values: [38, 56, 74, 91] }],
    note: '演示数据',
  };
  return `<div class="sl-pad">
    ${kicker('DATA')}${heading(s.title)}
    <div class="sl-chart-wrap">
      ${nativeChart(s.chart || fallback)}
      <div class="sl-chart__aside">${bullets((s.points || []).slice(0, 2))}</div>
    </div>
    ${evidenceLine(s.evidence)}
  </div>`;
}

function summaryBody(s) {
  return `<div class="sl-pad sl-summary">
    ${kicker('SUMMARY')}${heading(s.title)}
    <div class="sl-summary__cards">${(s.points || [])
      .slice(0, 3)
      .map(
        (p, i) => `<div class="sl-summary__card">
          <span class="sl-summary__num">0${i + 1}</span>
          <div class="sl-summary__text">${esc(p.text)}</div>
        </div>`,
      )
      .join('')}</div>
    <div class="sl-summary__foot">${esc(s.evidence || s.subtitle || '感谢观看')}</div>
  </div>`;
}

// ---------------- 阶段 2.5 动态布局：由 slide.elements 驱动 ----------------

/** 没有元素时按原有要点兜底生成，保证任何布局都有可见内容，且绝不丢失文字。 */
function elementsFor(layout, slide) {
  const given = Array.isArray(slide.elements) ? slide.elements : [];
  const pts = slide.points || [];
  const texts = pointsToItems(slide);
  const mainKind = LAYOUT_MAIN_KIND[layout];

  // 只有「目标类型元素确实带内容」才采用 AI 给的结构。
  // 真实模型常给出只有 kind 的空壳 column / layer / step，旧逻辑会照单全收，
  // 于是画出空白框；这里改为一律回退到 slide.points，并对字段做统一规范化。
  if (mainKind && hasUsableElements(given, mainKind)) {
    return enrichElements(given, slide);
  }

  if (layout === 'flowchart' || layout === 'architecture') {
    // 旧页面没有 elements 时，优先把原有要点文字放进结构里，保证切布局不丢内容。
    const names = layout === 'architecture'
      ? ['前端 / 交互层', '业务服务层', '数据与存储层'].map((fallback, i) => texts[i] ? texts[i].slice(0, 16) : fallback)
      : (texts.length ? texts.slice(0, 4) : ['需求输入', '处理与编排', '结果校验', '交付输出']);
    const nodes = names.map((name, i) => ({
      id: `n${i}`, kind: 'node', title: name,
      text: pts[i]?.detail || `环节 ${i + 1}`, level: i,
    }));
    const connectors = nodes.slice(0, -1).map((n, i) => ({
      id: `c${i}`, kind: 'connector', from: n.id, to: nodes[i + 1].id, title: '调用',
    }));
    return layout === 'architecture'
      ? nodes.map((n) => ({ ...n, kind: 'layer', items: [n.text, `模块 ${n.level + 1}.1`, `模块 ${n.level + 1}.2`] })).concat(connectors)
      : nodes.concat(connectors);
  }
  if (layout === 'timeline') {
    const steps = (texts.length ? texts : ['立项', '调研', '设计', '开发', '上线']).slice(0, 6);
    return steps.map((name, i) => ({ id: `s${i}`, kind: 'step', title: name, text: pts[i]?.detail || `阶段 ${i + 1}` }));
  }
  if (layout === 'comparison' || layout === 'two-column') {
    return [
      { id: 'col0', kind: 'column', title: layout === 'comparison' ? '传统方案' : '要点 A', items: texts.slice(0, 3).length ? texts.slice(0, 3) : ['人工处理，耗时长', '信息分散，难复用', '结果依赖个人经验'] },
      { id: 'col1', kind: 'column', title: layout === 'comparison' ? 'AI 方案' : '要点 B', items: texts.slice(3, 6).length ? texts.slice(3, 6) : ['自动生成，秒级完成', '结构化沉淀，可复用', '结果稳定可追溯'] },
    ];
  }
  if (layout === 'dashboard') {
    const vals = [86, 72, 64];
    return (texts.length ? texts : ['覆盖团队数', '平均提效', '交付周期缩短'])
      .slice(0, 3)
      .map((name, i) => ({ id: `m${i}`, kind: 'metric', title: name, value: `${vals[i] || 60}${i === 1 ? '%' : ''}` }));
  }
  return [];
}

function flowBody(s) {
  const els = elementsFor('flowchart', s);
  const nodes = els.filter((e) => normalizeKind(e.kind) === 'node');
  const links = els.filter((e) => normalizeKind(e.kind) === 'connector');
  return `<div class="sl-pad">
    ${kicker('FLOW')}${heading(s.title)}
    <div class="dyn-flow">${nodes
      .map(
        (n, i) => `<div class="dyn-node" data-el-id="${esc(n.id)}">
          <div class="dyn-node__idx">${String(i + 1).padStart(2, '0')}</div>
          <div class="dyn-node__title">${esc(elementTitle(n, `环节 ${i + 1}`))}</div>
          <div class="dyn-node__text">${esc(elementText(n) || (elementItems(n)[0] || ''))}</div>
        </div>${i < nodes.length - 1 ? '<div class="dyn-arrow" aria-hidden="true"><span>→</span></div>' : ''}`,
      )
      .join('')}</div>
    <div class="dyn-caption">${links.length} 条调用连线 · ${esc(s.visualHint || '按环节顺序流转')}</div>
    ${evidenceLine(s.evidence)}
  </div>`;
}

function architectureBody(s) {
  const els = elementsFor('architecture', s);
  const layers = els.filter((e) => normalizeKind(e.kind) === 'layer');
  const links = els.filter((e) => normalizeKind(e.kind) === 'connector');
  return `<div class="sl-pad">
    ${kicker('ARCHITECTURE')}${heading(s.title)}
    <div class="dyn-arch">${layers
      .map(
        (l, i) => `<div class="dyn-arch__layer">
          <div class="dyn-arch__label">${esc(elementTitle(l, `架构层 ${i + 1}`))}</div>
          <div class="dyn-arch__boxes">${elementItems(l).map((it) => `<div class="dyn-arch__box">${esc(it)}</div>`).join('')}</div>
        </div>${i < layers.length - 1 ? `<div class="dyn-arch__link" title="连接线 ${esc(links[i]?.from || '')} → ${esc(links[i]?.to || '')}">↓ 调用</div>` : ''}`,
      )
      .join('')}</div>
    ${evidenceLine(s.evidence)}
  </div>`;
}

function timelineBody(s) {
  const steps = elementsFor('timeline', s).filter((e) => normalizeKind(e.kind) === 'step');
  return `<div class="sl-pad">
    ${kicker('TIMELINE')}${heading(s.title)}
    <div class="dyn-timeline"><div class="dyn-timeline__axis"></div>${steps
      .map(
        (st, i) => `<div class="dyn-timeline__item">
          <div class="dyn-timeline__dot">${i + 1}</div>
          <div class="dyn-timeline__title">${esc(elementTitle(st, `阶段 ${i + 1}`))}</div>
          <div class="dyn-timeline__text">${esc(elementText(st) || (elementItems(st)[0] || ''))}</div>
        </div>`,
      )
      .join('')}</div>
    ${evidenceLine(s.evidence)}
  </div>`;
}

function columnsBody(s, comparison) {
  const cols = elementsFor(comparison ? 'comparison' : 'two-column', s)
    .filter((e) => normalizeKind(e.kind) === 'column');
  // 双保险：AI 给了空壳 column 时不得画出两个空白框，退回普通内容页展示原要点。
  const hasText = cols.some((c) => elementTitle(c) || elementItems(c).length);
  if (!hasText) return contentBody(s);
  return `<div class="sl-pad">
    ${kicker(comparison ? 'COMPARISON' : 'TWO COLUMNS')}${heading(s.title)}
    <div class="dyn-cols${comparison ? ' dyn-cols--vs' : ''}">${cols
      .map(
        (c) => `<div class="dyn-col">
          <div class="dyn-col__head">${esc(elementTitle(c, comparison ? '方案' : '核心要点'))}</div>
          <ul class="dyn-col__list">${elementItems(c).map((it) => `<li>${esc(it)}</li>`).join('')}</ul>
        </div>`,
      )
      .join('')}</div>
    ${evidenceLine(s.evidence)}
  </div>`;
}

function dashboardBody(s) {
  const all = elementsFor('dashboard', s);
  const metrics = all.filter((e) => normalizeKind(e.kind) === 'metric');
  const bars = all.filter((e) => normalizeKind(e.kind) === 'bar');
  const chart = s.chart || {
    labels: ['Q1', 'Q2', 'Q3', 'Q4'],
    series: [{ name: s.title, values: [42, 58, 71, 88] }],
    note: '演示数据',
  };
  return `<div class="sl-pad">
    ${kicker('DASHBOARD')}${heading(s.title)}
    <div class="dyn-metrics">${metrics
      .map(
        (m) => `<div class="dyn-metric"><div class="dyn-metric__value">${esc(elementValue(m))}</div>
          <div class="dyn-metric__label">${esc(elementTitle(m, '指标'))}</div></div>`,
      )
      .join('')}</div>
    <div class="dyn-dash-chart">${nativeChart(chart)}${bars.length ? `<div class="dyn-caption">${bars.length} 项补充指标</div>` : ''}</div>
    ${evidenceLine(s.evidence)}
  </div>`;
}

const BODIES = {
  title: coverBody,
  cover: coverBody,
  agenda: agendaBody,
  content: contentBody,
  'image-text': imageTextBody,
  visual: imageTextBody,
  chart: chartBody,
  summary: summaryBody,
  flowchart: flowBody,
  architecture: architectureBody,
  timeline: timelineBody,
  comparison: (s) => columnsBody(s, true),
  'two-column': (s) => columnsBody(s, false),
  dashboard: dashboardBody,
};

export function renderSlideHTML(slide, themeInput = 'business', opts = {}) {
  const layout = toLayout(slide?.layout || slide?.type);
  const body = BODIES[layout] || contentBody;
  const theme = normalizeTheme(themeInput);
  const design = { ...defaultDesign(), ...(slide?.design || {}) };
  const dark = isDarkBackground(theme.background);
  const pageNo = opts.pageNo ? String(opts.pageNo).padStart(2, '0') : '';
  const foot =
    layout === 'title' || layout === 'cover'
      ? ''
      : `<div class="slide__foot"><span>${esc(slide?.chapter || '')}</span><span class="slide__page">${pageNo}</span></div>`;
  return `<div class="slide slide--${layout}${dark ? ' slide--dark' : ''}"
      style="${themeVars(themeInput)}"
      data-deco="${esc(theme.decorationStyle)}"
      data-density="${esc(design.density)}"
      data-emphasis="${esc(design.emphasis)}"
      data-align="${esc(design.alignment)}"
      data-slide-id="${esc(slide?.id || '')}">
    ${body(slide || {})}
    ${foot}
  </div>`;
}
