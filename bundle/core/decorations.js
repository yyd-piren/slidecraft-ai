/**
 * 页面装饰素材层（阶段 4 细节增强）。
 *
 * 设计取舍：
 * - 图标不用外部字体/Unicode 特殊符号，而是「圆角色块 + 一个中文单字」，
 *   在任何 Windows Office 中文字体下都能正常显示，且是 PowerPoint 原生形状 + 原生文本框，可编辑。
 * - AI 生成的图片（kind:'image'）以 data URL 保存，导出时用 PptxGenJS 原生 addImage，
 *   是独立可选中/缩放/替换的图片对象，绝不是整页截图。
 * - 坐标统一使用 0~1 归一化值，由 render/pptx-coords.js 换算为英寸。
 */
import { uid } from './deck.js';

/** 内置图标：色值只作为「建议色」，实际渲染优先跟随当前 Theme。 */
export const ICON_LIBRARY = [
  { key: 'goal', label: '目标', glyph: '标', hint: '目标 / 定位' },
  { key: 'data', label: '数据', glyph: '数', hint: '数据 / 指标' },
  { key: 'growth', label: '增长', glyph: '增', hint: '增长 / 趋势' },
  { key: 'team', label: '团队', glyph: '队', hint: '团队 / 协作' },
  { key: 'time', label: '时间', glyph: '时', hint: '时间 / 阶段' },
  { key: 'idea', label: '创意', glyph: '创', hint: '创意 / 方案' },
  { key: 'safe', label: '安全', glyph: '安', hint: '安全 / 风控' },
  { key: 'cost', label: '成本', glyph: '本', hint: '成本 / 投入' },
  { key: 'quality', label: '质量', glyph: '质', hint: '质量 / 标准' },
  { key: 'flow', label: '流程', glyph: '流', hint: '流程 / 步骤' },
  { key: 'tech', label: '技术', glyph: '技', hint: '技术 / 架构' },
  { key: 'client', label: '客户', glyph: '客', hint: '客户 / 用户' },
  { key: 'risk', label: '风险', glyph: '险', hint: '风险 / 问题' },
  { key: 'result', label: '成果', glyph: '果', hint: '成果 / 结论' },
  { key: 'check', label: '完成', glyph: '✓', hint: '完成 / 确认' },
  { key: 'star', label: '重点', glyph: '★', hint: '重点 / 亮点' },
];

export const ICON_BY_KEY = Object.fromEntries(ICON_LIBRARY.map((i) => [i.key, i]));
export const DECOR_KINDS = ['icon', 'image', 'callout'];

const clamp01 = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
};

/** 归一化并做安全兜底：任何非法装饰项都不会让导出崩溃。 */
export function normalizeDecorations(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((d) => d && typeof d === 'object' && DECOR_KINDS.includes(d.kind))
    .slice(0, 8)
    .map((d, i) => ({
      id: String(d.id || uid('deco')),
      kind: d.kind,
      icon: ICON_BY_KEY[d.icon] ? d.icon : 'star',
      glyph: String(d.glyph || ICON_BY_KEY[d.icon]?.glyph || '★').slice(0, 2),
      label: String(d.label || d.caption || ICON_BY_KEY[d.icon]?.label || '重点').slice(0, 24),
      caption: String(d.caption || '').slice(0, 80),
      // 图片 data URL 可能较大，单独限制长度，避免草稿超出 storage 配额。
      src: typeof d.src === 'string' && d.src.startsWith('data:image/') ? d.src.slice(0, 4_000_000) : '',
      x: clamp01(d.x, 0.78 + (i % 2) * 0.0),
      y: clamp01(d.y, 0.16 + i * 0.1),
      w: clamp01(d.w, d.kind === 'image' ? 0.3 : 0.12) || 0.12,
      h: clamp01(d.h, d.kind === 'image' ? 0.3 : 0.12) || 0.12,
    }))
    .map((d) => ({ ...d, w: Math.min(d.w, 1 - d.x), h: Math.min(d.h, 1 - d.y) }));
}

export function makeIconDecoration(key, opts = {}) {
  const item = ICON_BY_KEY[key] || ICON_LIBRARY[0];
  return normalizeDecorations([{
    id: uid('deco'), kind: 'icon', icon: item.key, glyph: item.glyph,
    label: item.label, caption: opts.caption || '',
    x: opts.x ?? 0.84, y: opts.y ?? 0.16,
    w: opts.w ?? 0.1, h: opts.h ?? 0.1,
  }])[0];
}

export function makeImageDecoration(src, opts = {}) {
  return normalizeDecorations([{
    id: uid('deco'), kind: 'image', src, caption: opts.caption || 'AI 生成配图',
    x: opts.x ?? 0.62, y: opts.y ?? 0.3, w: opts.w ?? 0.3, h: opts.h ?? 0.42,
  }])[0];
}

/** 内置图标的 SVG（仅用于 HTML 预览；PPTX 侧用原生形状绘制）。 */
export function iconSvg(key, { color = '#2563EB', background = '#EAF1FF' } = {}) {
  const item = ICON_BY_KEY[key] || ICON_LIBRARY[0];
  const glyph = item.glyph === '✓' || item.glyph === '★' ? item.glyph : item.glyph;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
    <rect x="2" y="2" width="60" height="60" rx="16" fill="${background}"/>
    <text x="32" y="33" text-anchor="middle" dominant-baseline="central"
      font-family="Microsoft YaHei, PingFang SC, sans-serif" font-size="30" font-weight="700" fill="${color}">${glyph}</text>
  </svg>`;
}

export function svgToDataUri(svg) {
  const b64 = typeof globalThis.btoa === 'function'
    ? globalThis.btoa(unescape(encodeURIComponent(svg)))
    : Buffer.from(svg, 'utf8').toString('base64');
  return `data:image/svg+xml;base64,${b64}`;
}
