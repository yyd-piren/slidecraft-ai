/**
 * 自由布局块（阶段 4f）—— 网页拖拽与 PPTX 导出的**唯一坐标来源**。
 *
 * 设计要点：
 * - 所有坐标都是 0~1 归一化值，HTML 用百分比、PPTX 用 pptx-coords.rect() 换算英寸，
 *   两者读同一份数据，因此「网页里拖到哪，导出的 PPT 就在哪」，不会再出现排版漂移。
 * - 兼容旧数据：slide.blocks 缺失时为空数组，原 12 种布局渲染完全不变。
 * - 块只在 slide.freeLayout=true 时接管页面；关闭时立即回到对齐好的自动构图。
 * - 任何非法坐标都会被 clamp 到页面安全区，越界对象不会进入 PPTX。
 */
import { uid, toLayout } from './deck.js';

/** 与 render/pptx-coords.js 的 PAGE_MARGIN 保持一致，避免两条链路 clamp 结果不同。 */
export const PAGE_MARGIN = 0.055;

/** 与 render/layouts.js 的 kicker() 完全一致：自动构图用的是英文眉标，不是章节中文名。 */
const KICKERS = {
  title: 'PRESENTATION', agenda: 'CONTENTS', content: 'OVERVIEW',
  'two-column': 'TWO COLUMNS', 'image-text': 'VISUAL', chart: 'DATA',
  comparison: 'COMPARISON', timeline: 'TIMELINE', flowchart: 'FLOW',
  architecture: 'ARCHITECTURE', dashboard: 'DASHBOARD', summary: 'SUMMARY',
};
export const BLOCK_KINDS = [
  'kicker', 'title', 'rule', 'subtitle', 'text', 'card', 'metric', 'node',
  'image', 'icon', 'evidence', 'chart',
];
// 字号与配色统一由 core/block-style.js 按主题生成（HTML px ↔ PPTX pt），此处不再定义固定值。
const MIN_W = 0.06;
const MIN_H = 0.045;

const clamp = (v, lo, hi, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const str = (v, max = 400) => String(v ?? '').slice(0, max);

/** 归一化 + 边界回收：保证块完整落在页面内。 */
export function clampBlock(raw) {
  const b = { ...raw };
  // 装饰性短横线只有 3px 高，不能被通用最小高度撑成方块。
  const minH = b.kind === 'rule' ? 0.004 : MIN_H;
  b.w = clamp(b.w, MIN_W, 1 - PAGE_MARGIN * 2, 0.3);
  b.h = clamp(b.h, minH, 1 - PAGE_MARGIN * 2, 0.15);
  b.x = clamp(b.x, PAGE_MARGIN, 1 - PAGE_MARGIN - b.w, PAGE_MARGIN);
  b.y = clamp(b.y, PAGE_MARGIN, 1 - PAGE_MARGIN - b.h, PAGE_MARGIN);
  return b;
}

export function normalizeBlocks(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((b) => b && typeof b === 'object' && BLOCK_KINDS.includes(b.kind))
    .slice(0, 24)
    .map((b) => clampBlock({
      id: str(b.id, 60) || uid('blk'),
      kind: b.kind,
      text: str(b.text, 600),
      items: Array.isArray(b.items) ? b.items.slice(0, 12).map((x) => typeof x === 'string' ? str(x, 160) : str(x?.text ?? x?.title, 160)) : [],
      value: str(b.value, 60),
      number: str(b.number, 8),
      glyph: str(b.glyph, 3),
      variant: str(b.variant, 20),
      topLine: b.topLine === true,
      src: typeof b.src === 'string' && b.src.startsWith('data:image/') ? b.src.slice(0, 4_000_000) : '',
      chart: b.chart && typeof b.chart === 'object' && !Array.isArray(b.chart) ? b.chart : null,
      align: ['left', 'center'].includes(b.align) ? b.align : 'left',
      tone: ['plain', 'surface', 'primary'].includes(b.tone) ? b.tone : 'plain',
      // 关键：null / undefined 必须保持「未指定」，否则 Number(null)=0 会被 clamp 成 8px，
      // 导致切换自由布局后所有文字缩成 8px（曾出现的真实 bug）。
      fontSize: typeof b.fontSize === 'number' && Number.isFinite(b.fontSize)
        ? Math.min(48, Math.max(8, Math.round(b.fontSize))) : null,
      x: b.x, y: b.y, w: b.w, h: b.h,
    }));
}

function B(kind, x, y, w, h, extra = {}) {
  return clampBlock({ id: uid('blk'), kind, x, y, w, h, items: [], ...extra });
}

/** 两个块的相交面积占较小块面积的比例（用于拖拽时的重叠提示与导出警告）。 */
export function overlapRatio(a, b) {
  const iw = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const ih = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const area = Math.min(a.w * a.h, b.w * b.h);
  return area > 0 ? (iw * ih) / area : 0;
}

export function findOverlaps(blocks, threshold = 0.2) {
  const out = [];
  for (let i = 0; i < blocks.length; i += 1) {
    for (let j = i + 1; j < blocks.length; j += 1) {
      const r = overlapRatio(blocks[i], blocks[j]);
      if (r > threshold) out.push({ a: blocks[i].id, b: blocks[j].id, ratio: Math.round(r * 100) / 100 });
    }
  }
  return out;
}

/**
 * 解析最终要渲染的块。
 *
 * AI 只输出 {kind,x,y,w,h} 这样的「位置骨架」（避免长输出被 maxTokens 截断），
 * 文字内容由本地按相同布局的默认构图补齐；两条渲染链都调用本函数，结果完全一致。
 */
export function resolveBlocks(slide = {}) {
  const given = normalizeBlocks(slide.blocks);
  if (!given.length) return defaultBlocksFor(slide);
  const defaults = defaultBlocksFor(slide);
  const used = Object.create(null);
  return given.map((b, i) => {
    if (b.text || b.items.length || b.value || b.src || b.chart) return b;
    const sameKind = defaults.filter((d) => d.kind === b.kind);
    const k = used[b.kind] || 0;
    used[b.kind] = k + 1;
    const d = sameKind[k] || defaults[i % Math.max(1, defaults.length)];
    return {
      ...b,
      text: d?.text || '', items: d?.items || [], value: d?.value || '',
      chart: d?.chart || null, src: d?.src || '',
      align: d?.align || b.align, tone: d?.tone || b.tone,
    };
  });
}

/**
 * 按页面数据生成一套「自动构图」的块。
 * AI 若没给出 blocks，或用户第一次开启自由布局，都用这里的结果作为起点，
 * 保证任何布局都不会变成空白页。坐标全部来自统一的 REGIONS 安全区。
 */
export function defaultBlocksFor(slide = {}) {
  const layout = toLayout(slide.layout || slide.type || 'content');
  const points = Array.isArray(slide.points) ? slide.points : [];
  const texts = points.map((p) => str(p.text || p, 80)).filter(Boolean);
  const details = points.map((p) => str(p.detail || '', 120));
  const elements = Array.isArray(slide.elements) ? slide.elements : [];
  const of = (k) => elements.filter((e) => e.kind === k);

  // 与自动构图 chrome() 的三件套一致：英文眉标 → 标题 → 品牌色短横线。
  const head = () => [
    B('kicker', 0.0667, 0.0963, 0.4, 0.036, { text: KICKERS[layout] || 'OVERVIEW', tone: 'plain' }),
    // 右侧留出图标/配图区（用户常把图标放在 x≈0.84），避免矩形重叠误报；文字左对齐不受影响。
    B('title', 0.0667, 0.15, 0.76, 0.10, { text: str(slide.title || '未命名页面', 90), tone: 'plain' }),
    B('rule', 0.0667, 0.257, 0.0542, 0.0056, { tone: 'plain' }),
  ];
  // 与 .sl-evidence 一致：浅灰条 + 左侧品牌色竖线 + 蓝色「数据 / 案例」标签。
  // summary 的页脚是「左侧竖线 + 一句话」，没有浅灰底和「数据 / 案例」标签。
  const evidence = () => (str(slide.evidence || '').trim()
    ? [B('evidence', 0.0667, 0.8167, 0.8666, 0.0648, {
      text: str(slide.evidence, 160), tone: 'plain',
      variant: layout === 'summary' ? 'summary' : 'evidence',
    })]
    : []);

  if (layout === 'title') {
    return [
      B('kicker', 0.0667, 0.22, 0.4, 0.05, { text: 'PRESENTATION', tone: 'plain' }),
      B('title', 0.0667, 0.32, 0.74, 0.20, { text: str(slide.title || '演示标题', 90), tone: 'plain' }),
      B('subtitle', 0.0667, 0.56, 0.72, 0.10, { text: str(slide.subtitle || `${slide.points?.[0]?.text || ''}`, 160), tone: 'plain' }),
    ];
  }

  const cards = (n, cols, top, height, gapX = 0.025, gapY = 0.02) => {
    const totalW = 0.8666;
    const w = (totalW - gapX * (cols - 1)) / cols;
    const rows = Math.ceil(n / cols);
    const h = Math.min(height, (0.49 - gapY * (rows - 1)) / rows);
    return Array.from({ length: n }, (_, i) => {
      const c = i % cols; const r = Math.floor(i / cols);
      const srcCard = of('column')[i] || of('node')[i] || of('layer')[i] || of('step')[i] || of('metric')[i];
      const title = texts[i] || str(srcCard?.title, 60) || `要点 ${i + 1}`;
      const items = srcCard?.items?.length ? srcCard.items.slice(0, 4).map((x) => str(x, 100))
        : (details[i] ? [str(details[i], 140)] : []);
      return B('card', 0.0667 + c * (w + gapX), top + r * (h + gapY), w, h,
        { text: title, items, number: String(i + 1).padStart(2, '0'), tone: 'surface' });
    });
  };

  if (layout === 'agenda') return [...head(), ...cards(Math.max(2, Math.min(6, texts.length || 4)), 2, 0.3037, 0.15), ...evidence()];
  if (layout === 'summary') {
    // 与 .sl-summary__cards 一致：3 张等高卡片、只有「编号 + 标题」，不塞说明文字。
    const n = Math.max(2, Math.min(3, texts.length || 3));
    const w = (0.8666 - 0.025 * (n - 1)) / n;
    return [
      ...head(),
      ...Array.from({ length: n }, (_, i) => B('card', 0.0667 + i * (w + 0.025), 0.334, w, 0.20, {
        text: texts[i] || `要点 ${i + 1}`, number: String(i + 1).padStart(2, '0'),
        items: [], tone: 'surface', topLine: true,
      })),
      ...evidence(),
    ];
  }
  if (layout === 'two-column' || layout === 'comparison') {
    return [...head(), ...cards(2, 2, 0.3037, 0.42), ...evidence()];
  }
  if (layout === 'image-text') {
    return [
      ...head(),
      B('text', 0.0667, 0.3037, 0.41, 0.46, { text: texts.slice(0, 3).join(' · ') || str(slide.subtitle, 200), items: details.filter(Boolean).slice(0, 4), tone: 'surface' }),
      B('image', 0.51, 0.3037, 0.42, 0.46, { text: str(slide.visualHint || '配图区域', 80), tone: 'surface' }),
      ...evidence(),
    ];
  }
  if (layout === 'chart') {
    return [
      ...head(),
      B('chart', 0.0667, 0.3037, 0.58, 0.47, { chart: slide.chart || null, text: str(slide.title, 60), tone: 'surface' }),
      B('text', 0.67, 0.3037, 0.26, 0.47, { text: texts.slice(0, 4).join('\n'), items: details.filter(Boolean).slice(0, 4), tone: 'plain' }),
      ...evidence(),
    ];
  }
  if (layout === 'dashboard') {
    const metrics = of('metric');
    const m = Math.max(3, Math.min(4, metrics.length || 3));
    const w = (0.8666 - 0.025 * (m - 1)) / m;
    return [
      ...head(),
      ...Array.from({ length: m }, (_, i) => B('metric', 0.0667 + i * (w + 0.025), 0.32, w, 0.20, {
        value: str(metrics[i]?.value ?? metrics[i]?.title ?? `${(i + 1) * 25}%`, 24),
        text: str(metrics[i]?.title || metrics[i]?.text || texts[i] || `指标 ${i + 1}`, 60), tone: 'surface',
      })),
      B('card', 0.0667, 0.57, 0.8666, 0.20, { text: texts[0] || '关键结论', items: details.filter(Boolean).slice(0, 3), tone: 'surface' }),
      ...evidence(),
    ];
  }
  if (layout === 'timeline' || layout === 'flowchart') {
    const n = Math.max(3, Math.min(5, of('step').length || of('node').length || texts.length || 4));
    const w = (0.8666 - 0.025 * (n - 1)) / n;
    const steps = of('step').length ? of('step') : of('node');
    return [
      ...head(),
      ...Array.from({ length: n }, (_, i) => B('node', 0.0667 + i * (w + 0.025), 0.40, w, 0.24, {
        text: str(steps[i]?.title || texts[i] || `阶段 ${i + 1}`, 50),
        items: [str(steps[i]?.text || details[i] || '', 100)].filter(Boolean), tone: 'surface',
      })),
      ...evidence(),
    ];
  }
  if (layout === 'architecture') {
    const layers = of('layer');
    const n = Math.max(2, Math.min(3, layers.length || 3));
    const h = (0.48 - 0.03 * (n - 1)) / n;
    return [
      ...head(),
      ...Array.from({ length: n }, (_, i) => B('node', 0.18, 0.31 + i * (h + 0.03), 0.64, h, {
        text: str(layers[i]?.title || texts[i] || `第 ${i + 1} 层`, 60),
        items: (layers[i]?.items || []).slice(0, 4).map((x) => str(x, 60)), tone: 'surface',
      })),
      ...evidence(),
    ];
  }
  // content 及其它：标题 + 纵向要点卡片 + 案例条
  return [...head(), ...cards(Math.max(1, Math.min(4, texts.length || 3)), 1, 0.3037, 0.115), ...evidence()];
}
