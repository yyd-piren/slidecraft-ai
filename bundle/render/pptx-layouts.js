/**
 * 12 种布局的 PPTX 渲染（阶段 3）。
 *
 * 每种布局都有独立的构图逻辑，全部由 Deck JSON + Theme JSON 驱动，全部输出原生形状/文本/图表。
 * 与 HTML 预览共享同一份业务数据（slide.points / slide.elements / slide.chart），不读取 DOM。
 */
import { rect, REGIONS, grid, SLIDE_W, SLIDE_H, gapFor } from './pptx-coords.js';
import { addFittedText, addPointList } from './pptx-text.js';
import {
  normalizeKind, drawCard, drawNode, drawConnector, drawLayer, drawStep,
  drawColumn, drawMetric, drawChart, drawImagePlaceholder, drawNote, renderFreeElements,
} from './pptx-elements.js';
import {
  LAYOUT_MAIN_KIND, hasUsableElements, enrichElements, pointsToItems,
} from './element-utils.js';

// ---------------- 通用构件 ----------------

function background(slide, theme) {
  slide.addShape('rect', {
    x: 0, y: 0, w: SLIDE_W, h: SLIDE_H,
    fill: { color: theme.colors.background }, line: { color: theme.colors.background, width: 0 },
  });
}

function chrome(ctx, kicker, title, withFoot = true) {
  const { slide, theme, s, pageNo, total, report } = ctx;
  if (kicker) {
    // 网页 .sl-kicker 为 12px，换算 9pt。
    addFittedText(slide, kicker, rect(REGIONS.kicker.x, REGIONS.kicker.y, REGIONS.kicker.w, REGIONS.kicker.h), {
      fontSize: theme.sizes.small, fontFace: theme.font, color: theme.colors.primary, bold: true,
      charSpacing: 2,
    }, report);
  }
  addFittedText(slide, title || '未命名页面', rect(REGIONS.title.x, REGIONS.title.y, REGIONS.title.w, REGIONS.title.h), {
    fontSize: Math.round(theme.sizes.title * theme.emphasisScale), fontFace: theme.font,
    color: theme.colors.title, bold: true, valign: 'mid',
  }, report);
  slide.addShape('rect', {
    ...rect(REGIONS.rule.x, REGIONS.rule.y, REGIONS.rule.w * (theme.decoration === 'rules' ? 8 : 1), REGIONS.rule.h),
    fill: { color: theme.colors.primary }, line: { color: theme.colors.primary, width: 0 },
  });
  if (withFoot) {
    // 网页 .slide__foot 有一条 1px 上边细线。
    slide.addShape('rect', {
      ...rect(REGIONS.footLine.x, REGIONS.footLine.y, REGIONS.footLine.w, REGIONS.footLine.h),
      fill: { color: theme.colors.line }, line: { color: theme.colors.line, width: 0 },
    });
    addFittedText(slide, `${s.chapter || ''}`, rect(REGIONS.foot.x, REGIONS.foot.y, 0.6, REGIONS.foot.h), {
      fontSize: theme.sizes.small, fontFace: theme.font, color: theme.colors.muted,
    }, report);
    addFittedText(slide, String(pageNo).padStart(2, '0'), rect(0.85, REGIONS.foot.y, 0.09, REGIONS.foot.h), {
      fontSize: theme.sizes.small + 1, fontFace: theme.font, color: theme.colors.primary, bold: true, align: 'right',
    }, report);
  }
}

function evidence(ctx) {
  const { slide, theme, s, report } = ctx;
  if (!String(s.evidence || '').trim()) return;
  const box = rect(REGIONS.evidence.x, REGIONS.evidence.y, REGIONS.evidence.w, REGIONS.evidence.h);
  // 与网页 .sl-evidence 一致：中性浅灰底、细边框、左侧 3px 蓝色竖条、蓝色标签 + 灰色正文。
  slide.addShape('rect', { ...box, fill: { color: theme.colors.surface }, line: { color: theme.colors.line, width: 0.5 } });
  slide.addShape('rect', {
    x: box.x, y: box.y, w: 0.042, h: box.h,
    fill: { color: theme.colors.primary }, line: { color: theme.colors.primary, width: 0 },
  });
  slide.addText([
    { text: '数据 / 案例', options: { bold: true, color: theme.colors.primary, fontSize: theme.sizes.small } },
    { text: `  ${s.evidence}`, options: { color: theme.colors.muted, fontSize: theme.sizes.small } },
  ], {
    x: box.x + 0.17, y: box.y + 0.02, w: box.w - 0.28, h: box.h - 0.04,
    fontFace: theme.font, color: theme.colors.muted, valign: 'mid', margin: 0,
  });
}

function notes(ctx) {
  const n = String(ctx.s.notes || '').trim();
  if (n) ctx.slide.addNotes(n);
}

/** 与 HTML 预览一致的元素兜底：缺少结构化元素时用原要点生成，绝不丢内容。 */
function parts(ctx, layout) {
  const s = ctx.s;
  const raw = Array.isArray(s.elements) ? s.elements : [];
  // 与 HTML 预览一致：目标类型元素若全是空壳，改用 slide.points 兜底，绝不导出空白卡片。
  const useGiven = !!LAYOUT_MAIN_KIND[layout] && hasUsableElements(raw, LAYOUT_MAIN_KIND[layout]);
  const given = enrichElements(raw, s);
  const of = (k) => given.filter((e) => normalizeKind(e.kind) === k);
  const pts = Array.isArray(s.points) ? s.points : [];
  const texts = pointsToItems(s);

  if (layout === 'flowchart' || layout === 'architecture') {
    let arr = useGiven ? of(layout === 'architecture' ? 'layer' : 'node') : [];
    if (!arr.length) {
      const names = layout === 'architecture'
        ? ['前端 / 交互层', '业务服务层', '数据与存储层'].map((f, i) => texts[i] || f)
        : (texts.length ? texts.slice(0, 4) : ['需求输入', '意图解析', '内容编排', '结果交付']);
      arr = names.map((name, i) => ({ id: `gen${i}`, kind: layout === 'architecture' ? 'layer' : 'node', title: name, text: pts[i]?.detail || `环节 ${i + 1}`, items: [name, `模块 ${i + 1}.1`, `模块 ${i + 1}.2`] }));
    }
    const links = of('connector');
    return { items: arr, links };
  }
  if (layout === 'timeline') {
    let arr = useGiven ? of('step') : [];
    if (!arr.length) {
      const names = texts.length ? texts : ['立项', '需求调研', '方案设计', '开发验证', '正式上线'];
      arr = names.slice(0, 6).map((name, i) => ({ id: `st${i}`, kind: 'step', title: name, text: pts[i]?.detail || `阶段 ${i + 1}` }));
    }
    return { items: arr, links: [] };
  }
  if (layout === 'comparison' || layout === 'two-column') {
    let arr = useGiven ? of('column') : [];
    if (!arr.length) {
      arr = [
        { id: 'A', kind: 'column', title: layout === 'comparison' ? '传统方案' : '核心观点', items: texts.slice(0, 3).length ? texts.slice(0, 3) : ['目标与背景', '关键结论', '适用范围'] },
        { id: 'B', kind: 'column', title: layout === 'comparison' ? 'AI 方案' : '支撑依据', items: texts.slice(3, 6).length ? texts.slice(3, 6) : ['数据来源', '实施路径', '衡量指标'] },
      ];
    }
    return { items: arr, links: [] };
  }
  if (layout === 'dashboard') {
    let arr = useGiven ? of('metric') : [];
    if (!arr.length) arr = (texts.length ? texts : ['覆盖团队', '平均提效', '交付周期']).slice(0, 3)
      .map((name, i) => ({ id: `m${i}`, kind: 'metric', title: name, value: ['86', '42%', '3.2×'][i] || '—' }));
    return { items: arr, links: [] };
  }
  return { items: given, links: of('connector') };
}

// ---------------- 12 种布局 ----------------

function renderTitle(ctx) {
  const { slide, theme, s, report, deck } = ctx;
  slide.addShape('rect', {
    ...rect(0.72, 0, 0.28, 1), fill: { color: theme.colors.accent },
    line: { color: theme.colors.accent, width: 0 },
  });
  addFittedText(slide, 'SLIDECRAFT AI', rect(0.07, 0.08, 0.5, 0.05), {
    fontSize: theme.sizes.small + 2, fontFace: theme.font, color: theme.colors.muted, bold: true,
  }, report);
  slide.addShape('rect', { ...rect(0.07, 0.36, 0.05, 0.008), fill: { color: theme.colors.primary }, line: { color: theme.colors.primary, width: 0 } });
  addFittedText(slide, s.title || deck.meta?.topic || '演示主题', rect(0.07, 0.42, 0.62, 0.22), {
    fontSize: Math.round(theme.sizes.title * 1.55), fontFace: theme.font, color: theme.colors.title, bold: true, valign: 'mid',
  }, report);
  addFittedText(slide, s.subtitle || `${deck.meta?.purpose || ''} · ${deck.meta?.audience || ''}`, rect(0.07, 0.66, 0.6, 0.09), {
    fontSize: theme.sizes.subtitle, fontFace: theme.font, color: theme.colors.body,
  }, report);
  addFittedText(slide, `${s.chapter || ''} · PRESENTATION`, rect(0.07, 0.9, 0.6, 0.045), {
    fontSize: theme.sizes.small, fontFace: theme.font, color: theme.colors.muted,
  }, report);
}

function renderAgenda(ctx) {
  chrome(ctx, 'CONTENTS', ctx.s.title);
  const { slide, theme, s, report } = ctx;
  const points = (Array.isArray(s.points) ? s.points : []).slice(0, 6);
  // 与网页 .sl-agenda 一致：2 列 × 3 行卡片，统一使用正文安全区，避免与案例条/页脚相撞。
  const cells = grid(
    { x: REGIONS.body.x, y: REGIONS.body.y, w: REGIONS.body.w, h: REGIONS.body.h },
    2, 3, gapFor(theme.spacing) * 1.2,
  );
  const PAD = 0.16;   // 英寸
  const NUM_W = 0.52; // 编号列宽
  const GAP = 0.14;
  points.forEach((p, i) => {
    const b = cells[i];
    drawCard(slide, b, theme, { fill: theme.colors.surface, lineWidth: 0.5 });
    // 网页 .sl-agenda__row 的左侧蓝色竖线
    slide.addShape('rect', {
      x: b.x, y: b.y, w: 0.042, h: b.h,
      fill: { color: theme.colors.primary }, line: { color: theme.colors.primary, width: 0 },
    });
    const textX = b.x + PAD + NUM_W + GAP;
    const textW = Math.max(0.6, b.w - PAD * 2 - NUM_W - GAP);
    const headY = b.y + PAD * 0.7;
    addFittedText(slide, String(i + 1).padStart(2, '0'), {
      x: b.x + PAD, y: headY, w: NUM_W, h: 0.32,
    }, {
      fontSize: theme.sizes.card + 2, fontFace: theme.font, color: theme.colors.primary, bold: true, valign: 'mid',
    }, report);
    addFittedText(slide, p.text || '', {
      x: textX, y: headY, w: textW, h: 0.34,
    }, {
      fontSize: theme.sizes.body, fontFace: theme.font, color: theme.colors.title, bold: true, valign: 'mid',
    }, report);
    if (p.detail) addFittedText(slide, p.detail, {
      x: textX, y: headY + 0.38, w: textW, h: Math.max(0.2, b.h - PAD - 0.46),
    }, {
      fontSize: theme.sizes.small + 2, fontFace: theme.font, color: theme.colors.muted, valign: 'top',
    }, report);
  });
  evidence(ctx);
}

function renderContent(ctx) {
  chrome(ctx, 'OVERVIEW', ctx.s.title);
  // 正文安全区一直延伸到案例条上方，与网页 .sl-points → .sl-evidence 的留白一致。
  addPointList(ctx.slide, ctx.s.points, rect(REGIONS.body.x, REGIONS.body.y, REGIONS.body.w, REGIONS.body.h), ctx.theme, ctx.report);
  evidence(ctx);
}

function renderTwoColumn(ctx, comparison = false) {
  chrome(ctx, comparison ? 'COMPARISON' : 'TWO COLUMNS', ctx.s.title);
  const { slide, theme, report } = ctx;
  const { items } = parts(ctx, comparison ? 'comparison' : 'two-column');
  const cells = grid({ x: 0.06, y: 0.31, w: 0.88, h: 0.52 }, 2, 1, gapFor(theme.spacing) * 3);
  items.slice(0, 2).forEach((el, i) => drawColumn(slide, cells[i], el, theme, report));
  if (comparison) {
    const b = rect(0.465, 0.53, 0.07, 0.07);
    slide.addShape('ellipse', { ...b, fill: { color: theme.colors.background }, line: { color: theme.colors.primary, width: 1 } });
    addFittedText(slide, 'VS', b, { fontSize: theme.sizes.small + 3, fontFace: theme.font, color: theme.colors.primary, bold: true, align: 'center', valign: 'mid' }, report);
  }
  evidence(ctx);
}

function renderImageText(ctx) {
  chrome(ctx, 'STRUCTURE', ctx.s.title);
  const { slide, theme, s, report } = ctx;
  addPointList(slide, s.points, rect(0.06, 0.31, 0.46, 0.5), theme, report);
  drawImagePlaceholder(slide, rect(0.56, 0.31, 0.38, 0.5), { title: s.visualHint || '配图建议：结构示意图 / 流程图' }, theme, report);
  evidence(ctx);
}

function renderChart(ctx) {
  chrome(ctx, 'DATA', ctx.s.title);
  const { slide, theme, s, report } = ctx;
  const chartBox = rect(0.06, 0.31, 0.57, 0.5);
  drawChart(slide, chartBox, { chart: s.chart || { labels: (s.points || []).slice(0, 4).map((p, i) => `阶段${i + 1}`), series: [{ name: s.title, values: [38, 56, 74, 91] }], type: 'bar' } }, theme);
  addPointList(slide, (s.points || []).slice(0, 3), rect(0.66, 0.31, 0.28, 0.5), theme, report);
  evidence(ctx);
}

function renderTimeline(ctx) {
  chrome(ctx, 'TIMELINE', ctx.s.title);
  const { slide, theme, report } = ctx;
  const { items } = parts(ctx, 'timeline');
  const n = Math.max(1, Math.min(6, items.length));
  const axisY = 0.47;
  slide.addShape('line', {
    ...rect(0.09, axisY, 0.82, 0.001),
    line: { color: theme.colors.primary, width: 2, endArrowType: 'triangle' },
  });
  const cells = grid({ x: 0.07, y: 0.36, w: 0.86, h: 0.44 }, n, 1, gapFor(theme.spacing));
  items.slice(0, n).forEach((el, i) => drawStep(slide, cells[i], el, theme, report, i));
  evidence(ctx);
}

function renderFlowchart(ctx) {
  chrome(ctx, 'FLOW', ctx.s.title);
  const { slide, theme, report } = ctx;
  const { items, links } = parts(ctx, 'flowchart');
  const n = Math.max(2, Math.min(5, items.length));
  const cells = grid({ x: 0.06, y: 0.38, w: 0.88, h: 0.28 }, n, 1, gapFor(theme.spacing) * 4);
  items.slice(0, n).forEach((el, i) => drawNode(slide, cells[i], el, theme, report, { fill: theme.colors.surface, line: theme.colors.primary }));
  for (let i = 0; i < n - 1; i++) {
    drawConnector(slide, cells[i], cells[i + 1], theme, links[i]?.title || '');
  }
  addFittedText(slide, `${Math.max(0, n - 1)} 条调用连线 · ${String(ctx.s.visualHint || '按环节顺序流转')}`, rect(0.06, 0.72, 0.88, 0.06), {
    fontSize: theme.sizes.small + 2, fontFace: theme.font, color: theme.colors.muted,
  }, report);
  evidence(ctx);
}

function renderArchitecture(ctx) {
  chrome(ctx, 'ARCHITECTURE', ctx.s.title);
  const { slide, theme, report } = ctx;
  const { items, links } = parts(ctx, 'architecture');
  const n = Math.max(2, Math.min(4, items.length));
  const cells = grid({ x: 0.06, y: 0.31, w: 0.88, h: 0.52 }, 1, n, gapFor(theme.spacing) * 2.5);
  items.slice(0, n).forEach((el, i) => drawLayer(slide, cells[i], el, theme, report));
  for (let i = 0; i < n - 1; i++) {
    drawConnector(slide, cells[i], cells[i + 1], theme, links[i]?.title || '调用');
  }
  evidence(ctx);
}

function renderDashboard(ctx) {
  chrome(ctx, 'DASHBOARD', ctx.s.title);
  const { slide, theme, report } = ctx;
  const { items } = parts(ctx, 'dashboard');
  const n = Math.max(1, Math.min(4, items.length));
  const cells = grid({ x: 0.06, y: 0.31, w: 0.88, h: 0.2 }, n, 1, gapFor(theme.spacing) * 2);
  items.slice(0, n).forEach((el, i) => drawMetric(slide, cells[i], el, theme, report));
  drawChart(slide, rect(0.06, 0.54, 0.88, 0.28), {
    chart: ctx.s.chart || { labels: ['Q1', 'Q2', 'Q3', 'Q4'], series: [{ name: ctx.s.title, values: [42, 58, 71, 88] }], type: 'bar' },
  }, theme);
  evidence(ctx);
}

function renderSummary(ctx) {
  chrome(ctx, 'SUMMARY', ctx.s.title);
  const { slide, theme, s, report } = ctx;
  const pts = (Array.isArray(s.points) ? s.points : []).slice(0, 3);
  const cells = grid({ x: 0.06, y: 0.32, w: 0.88, h: 0.34 }, 3, 1, gapFor(theme.spacing) * 2);
  pts.forEach((p, i) => {
    drawCard(slide, cells[i], theme, { fill: theme.colors.surface });
    addFittedText(slide, `0${i + 1}`, { x: cells[i].x + 0.15, y: cells[i].y + 0.12, w: 0.6, h: 0.3 }, {
      fontSize: theme.sizes.card + 2, fontFace: theme.font, color: theme.colors.primary, bold: true,
    }, report);
    addFittedText(slide, p.text || '', { x: cells[i].x + 0.15, y: cells[i].y + 0.5, w: cells[i].w - 0.3, h: cells[i].h - 0.6 }, {
      fontSize: theme.sizes.body, fontFace: theme.font, color: theme.colors.title, bold: true,
    }, report);
  });
  slide.addShape('rect', { ...rect(0.06, 0.72, 0.008, 0.09), fill: { color: theme.colors.primary }, line: { color: theme.colors.primary, width: 0 } });
  addFittedText(slide, s.evidence || s.subtitle || '感谢观看', rect(0.085, 0.72, 0.85, 0.09), {
    fontSize: theme.sizes.body, fontFace: theme.font, color: theme.colors.body, valign: 'mid',
  }, report);
}

const RENDERERS = {
  title: renderTitle,
  agenda: renderAgenda,
  content: renderContent,
  'two-column': (ctx) => renderTwoColumn(ctx, false),
  'image-text': renderImageText,
  chart: renderChart,
  comparison: (ctx) => renderTwoColumn(ctx, true),
  timeline: renderTimeline,
  flowchart: renderFlowchart,
  architecture: renderArchitecture,
  dashboard: renderDashboard,
  summary: renderSummary,
};

/** 渲染单页：统一背景 → 布局 → 备注。 */
export function renderSlideToPptx(ctx) {
  background(ctx.slide, ctx.theme);
  const key = ctx.layout;
  const fn = RENDERERS[key] || RENDERERS.content;
  fn(ctx);
  // 不再对所有布局叠加「带坐标的自由元素」：
  // 动态布局已通过 parts() 消费 elements，静态布局按 points 排版；
  // 曾出现真实 AI 在目录页生成 step 元素被二次绘制，圆形编号与卡片文字大面积重叠。
  // renderFreeElements 仍保留为可显式调用的扩展能力，但默认不参与单页渲染。
  notes(ctx);
}

export const SUPPORTED_LAYOUTS = Object.keys(RENDERERS);
