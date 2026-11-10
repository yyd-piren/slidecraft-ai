/**
 * 动态页面元素 → PowerPoint 原生对象（阶段 3）。
 *
 * 当前项目 Slide.elements 的真实 kind：layer / node / connector / step / column / metric / bar / note / label。
 * 同时兼容未来可能出现的别名：module / edge / text / shape / chart / image。
 * 所有元素都输出为形状 + 独立文本对象，绝不把整页渲染成图片。
 */
import { addFittedText } from './pptx-text.js';
import { rect } from './pptx-coords.js';
import {
  normalizeKind, elementTitle, elementItems, elementText, elementValue,
} from './element-utils.js';

// 与 HTML 预览共用同一套别名与字段取值规则，避免两边渲染结果不一致。
export { normalizeKind } from './element-utils.js';

const PAD = 0.12; // inches

function inner(box, ratioY = 0, ratioH = 1) {
  return {
    x: box.x + PAD, y: box.y + PAD + box.h * ratioY,
    w: Math.max(0.2, box.w - PAD * 2), h: Math.max(0.15, box.h * ratioH - PAD * 2),
  };
}

/** 基础卡片：圆角矩形 + 主题描边，返回形状本身可继续编辑。 */
export function drawCard(slide, box, theme, opts = {}) {
  return slide.addShape(opts.shape || 'roundRect', {
    x: box.x, y: box.y, w: box.w, h: box.h,
    rectRadius: Math.min(0.3, theme.radius / 60),
    fill: { color: opts.fill || theme.colors.surface },
    line: { color: opts.line || theme.colors.line, width: opts.lineWidth ?? 0.75 },
  });
}

function text(slide, value, box, theme, size, opts, report) {
  if (!String(value || '').trim()) return;
  addFittedText(slide, String(value), box, {
    fontSize: size, fontFace: theme.font, color: opts.color || theme.colors.title,
    bold: !!opts.bold, align: opts.align || 'left', valign: opts.valign || 'mid',
  }, report);
}

/** 节点 / 模块卡片：标题 + 描述均为可编辑文本。 */
export function drawNode(slide, box, el, theme, report, opts = {}) {
  drawCard(slide, box, theme, opts);
  const title = elementTitle(el);
  const desc = elementText(el) || elementItems(el)[0] || '';
  const hasDesc = !!(desc && title && desc !== title);
  text(slide, title || desc || '模块', inner(box, 0, hasDesc ? 0.55 : 1), theme,
    theme.sizes.card, { bold: true, color: theme.colors.title, align: 'center' }, report);
  if (hasDesc) {
    text(slide, desc, inner(box, 0.55, 0.45), theme, Math.max(9, theme.sizes.small + 1),
      { color: theme.colors.body, align: 'center' }, report);
  }
}

/** 原生连接线（带箭头）。方向由两个节点框自动推导，flipH / flipV 保证箭头指向正确。 */
export function drawConnector(slide, a, b, theme, label = '') {
  const ax = a.x + a.w / 2, ay = a.y + a.h / 2;
  const bx = b.x + b.w / 2, by = b.y + b.h / 2;
  const horizontal = Math.abs(bx - ax) >= Math.abs(by - ay);
  let x1, y1, x2, y2;
  if (horizontal) {
    const right = bx >= ax;
    x1 = right ? a.x + a.w : a.x;
    x2 = right ? b.x : b.x + b.w;
    y1 = (ay + by) / 2; y2 = y1;
  } else {
    const down = by >= ay;
    x1 = (ax + bx) / 2; x2 = x1;
    y1 = down ? a.y + a.h : a.y;
    y2 = down ? b.y : b.y + b.h;
  }
  const x = Math.min(x1, x2), y = Math.min(y1, y2);
  const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
  const flipH = x2 < x1;
  const flipV = (x2 - x1) * (y2 - y1) < 0;
  slide.addShape('line', {
    x, y, w: Math.max(w, 0.02), h: Math.max(h, 0.02), flipH, flipV,
    line: { color: theme.colors.primary, width: 2, endArrowType: 'triangle' },
  });
  if (label) {
    const lx = Math.min(x1, x2) + w / 2 - 0.55;
    const ly = Math.min(y1, y2) + h / 2 - 0.12;
    slide.addText(String(label), {
      x: lx, y: ly, w: 1.1, h: 0.24, fontSize: 9, fontFace: theme.font,
      color: theme.colors.muted, align: 'center', margin: 0,
    });
  }
}

/** 架构层：层标题 + 多个可编辑模块小卡片。 */
export function drawLayer(slide, box, el, theme, report) {
  drawCard(slide, box, theme, { fill: theme.colors.surface, line: theme.colors.primary, lineWidth: 1 });
  // 标题只占左侧标签列；若占满整卡会与右侧子项文本框 100% 重叠。
  text(slide, elementTitle(el, '架构层'), {
    x: box.x + PAD, y: box.y + 0.08, w: box.w * 0.28, h: box.h - 0.16,
  }, theme, theme.sizes.card,
    { bold: true, color: theme.colors.primary, align: 'left', valign: 'mid' }, report);
  const items = elementItems(el).slice(0, 4);
  if (!items.length) return;
  const startX = box.x + box.w * 0.32;
  const availW = box.w * 0.66;
  const cellW = availW / items.length;
  items.forEach((it, i) => {
    const b = { x: startX + i * cellW + 0.03, y: box.y + 0.14, w: cellW - 0.06, h: box.h - 0.28 };
    slide.addShape('rect', { ...b, fill: { color: theme.colors.background }, line: { color: theme.colors.line, width: 0.5 } });
    text(slide, it, { x: b.x + 0.05, y: b.y + 0.05, w: b.w - 0.1, h: b.h - 0.1 }, theme,
      Math.max(9, theme.sizes.small + 1), { color: theme.colors.body, align: 'center' }, report);
  });
}

/** 时间轴节点：椭圆序号 + 标题 + 说明。 */
export function drawStep(slide, box, el, theme, report, index = 0) {
  const dot = { x: box.x + box.w / 2 - 0.22, y: box.y, w: 0.44, h: 0.44 };
  slide.addShape('ellipse', { ...dot, fill: { color: theme.colors.primary }, line: { color: theme.colors.secondary, width: 0.75 } });
  slide.addText(String(index + 1), { ...dot, fontSize: 12, fontFace: theme.font, color: 'FFFFFF', bold: true, align: 'center', valign: 'mid', margin: 0 });
  text(slide, elementTitle(el, `阶段 ${index + 1}`), { x: box.x, y: box.y + 0.55, w: box.w, h: 0.36 }, theme,
    theme.sizes.card, { bold: true, align: 'center' }, report);
  const stepText = elementText(el) || elementItems(el)[0] || '';
  if (stepText) {
    text(slide, stepText, { x: box.x, y: box.y + 0.95, w: box.w, h: 0.55 }, theme,
      Math.max(9, theme.sizes.small + 1), { color: theme.colors.body, align: 'center' }, report);
  }
}

/** 对比 / 双栏：独立区域 + 标题 + 可编辑条目。 */
export function drawColumn(slide, box, el, theme, report) {
  drawCard(slide, box, theme, { fill: theme.colors.surface });
  text(slide, elementTitle(el, '栏目'), { x: box.x + PAD, y: box.y + 0.12, w: box.w - PAD * 2, h: 0.42 }, theme,
    theme.sizes.card + 1, { bold: true, color: theme.colors.primary }, report);
  const items = elementItems(el);
  const runs = items.slice(0, 6).map((it, i) => ({
    text: `•  ${it}`,
    options: { breakLine: true, fontSize: theme.sizes.body - 2, color: theme.colors.body, fontFace: theme.font },
  }));
  if (runs.length) {
    slide.addText(runs, {
      x: box.x + PAD, y: box.y + 0.62, w: box.w - PAD * 2, h: box.h - 0.75,
      fontFace: theme.font, color: theme.colors.body, valign: 'top', margin: 0,
      lineSpacingMultiple: 1.1, fit: 'shrink',
    });
  }
}

/** 指标卡：大号数值 + 说明文字，层级由主题字号驱动。 */
export function drawMetric(slide, box, el, theme, report) {
  drawCard(slide, box, theme, { fill: theme.colors.surface });
  // 数值与标签留出明确间隙，避免两行文本框轻微相交。
  text(slide, elementValue(el), { x: box.x + 0.1, y: box.y + 0.16, w: box.w - 0.2, h: box.h * 0.44 }, theme,
    theme.sizes.metric, { bold: true, color: theme.colors.primary, align: 'center' }, report);
  text(slide, elementTitle(el, '指标') || elementText(el), { x: box.x + 0.1, y: box.y + box.h * 0.66, w: box.w - 0.2, h: box.h * 0.28 }, theme,
    Math.max(9, theme.sizes.small + 2), { color: theme.colors.body, align: 'center' }, report);
}

export function drawBar(slide, box, el, theme, report) {
  drawCard(slide, box, theme, { shape: 'rect' });
  text(slide, `${el.title || ''} ${el.value ?? ''}`.trim(), inner(box, 0, 1), theme,
    theme.sizes.card, { bold: true, align: 'center' }, report);
}

export function drawNote(slide, box, el, theme, report, opts = {}) {
  text(slide, el.title || el.text || '', box, theme, opts.fontSize || theme.sizes.body,
    { color: opts.color || theme.colors.body, align: opts.align || 'left', bold: !!opts.bold }, report);
}

/** 图片占位：明确画成形状 + 文字，不伪装成真实图片。 */
export function drawImagePlaceholder(slide, box, el, theme, report) {
  slide.addShape('rect', {
    ...box, fill: { color: theme.colors.surface },
    line: { color: theme.colors.line, width: 1, dashType: 'dash' },
  });
  text(slide, el.title || el.text || '配图占位（请在此处插入图片）', inner(box, 0, 1), theme,
    theme.sizes.small + 2, { color: theme.colors.muted, align: 'center' }, report);
}

/** 原生 PowerPoint 图表（不是图片）。数据格式按 PptxGenJS 官方定义。 */
export function drawChart(slide, box, el, theme) {
  const raw = el.chart || el;
  const labels = Array.isArray(raw.labels) ? raw.labels.map(String) : ['阶段一', '阶段二', '阶段三', '阶段四'];
  const series = Array.isArray(raw.series) && raw.series.length ? raw.series : [{ name: el.title || '数据', values: [38, 56, 74, 91] }];
  const data = series.slice(0, 3).map((s, i) => ({
    name: String(s.name || `系列 ${i + 1}`),
    labels,
    values: (Array.isArray(s.values) ? s.values : [1, 2, 3, 4]).map((v) => Number(v) || 0),
  }));
  const type = ['bar', 'line', 'pie', 'area', 'doughnut', 'scatter'].includes(String(raw.type)) ? String(raw.type) : 'bar';
  slide.addChart(type, data, {
    x: box.x, y: box.y, w: box.w, h: box.h,
    chartColors: [theme.colors.primary, theme.colors.secondary, theme.colors.muted],
    showLegend: type !== 'pie', legendPos: 'b',
    showValue: false, catAxisLabelFontFace: theme.font, valAxisLabelFontFace: theme.font,
    fontFace: theme.font, fontSize: theme.sizes.small + 2,
    showTitle: false,
  });
}

/** 带归一化坐标的自由元素（向后兼容扩展）：按坐标绘制，越界由 rect() 自动收回。 */
export function renderFreeElements(slide, elements, theme, report) {
  const boxes = new Map();
  const list = Array.isArray(elements) ? elements : [];
  list.forEach((el, i) => {
    if (!el || [el.x, el.y, el.w, el.h].some((v) => typeof v !== 'number')) return;
    const kind = normalizeKind(el.kind);
    const box = rect(el.x, el.y, el.w, el.h);
    if (el.id) boxes.set(el.id, box);
    if (kind === 'connector') return;
    if (kind === 'metric') drawMetric(slide, box, el, theme, report);
    else if (kind === 'step') drawStep(slide, box, el, theme, report, i);
    else if (kind === 'column') drawColumn(slide, box, el, theme, report);
    else if (kind === 'layer') drawLayer(slide, box, el, theme, report);
    else if (kind === 'chart') drawChart(slide, box, el, theme);
    else if (kind === 'image') drawImagePlaceholder(slide, box, el, theme, report);
    else if (kind === 'note' || kind === 'label') drawNote(slide, box, el, theme, report);
    else drawNode(slide, box, el, theme, report);
  });
  list.filter((el) => el && normalizeKind(el.kind) === 'connector').forEach((el) => {
    const a = boxes.get(el.from), b = boxes.get(el.to);
    if (a && b) drawConnector(slide, a, b, theme, el.title || '');
  });
}
