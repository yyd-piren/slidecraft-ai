/**
 * 自由布局块的**唯一样式规格**（阶段 4f 修正）。
 *
 * 之前 blocks 用固定 px/pt 同数值，且标题染成品牌蓝，切换自由布局后视觉与自动构图不一致。
 * 现在全部沿用自动构图那套主题变量：
 *   HTML : .sl-kicker 12px / .sl-title var(--t-title) / .sl-points__text var(--t-body) / 说明 13px
 *   PPTX : pxToPt(px) = px * 0.75（因为 1pt = 1.333 CSS px）
 * 因此同一个 htmlPx 在网页与 PowerPoint 里的物理尺寸一致，配色也取同一个 Theme JSON 字段。
 */
import { normalizeTheme } from './deck.js';

/** 与 render/pptx-theme.js 的 pxToPt 完全相同的换算。 */
export function pxToPt(px) {
  return Math.max(9, Math.min(54, Math.round((Number(px) || 18) * 0.75)));
}

/** HTML 侧：主题字段 → CSS 变量（这些变量由 themes.js 注入到 .slide 上）。 */
export const HTML_COLOR = {
  primary: 'var(--c-brand)',
  title: 'var(--c-ink)',
  body: 'var(--c-text)',
  muted: 'var(--c-muted)',
  surface: 'var(--c-surface)',
  line: 'var(--c-line)',
};

/**
 * @returns {{htmlPx:number, pptxPt:number, color:string, bold:boolean, align:string}}
 *          color 同时是 theme.colors 的键与 HTML_COLOR 的键。
 */
export function blockStyle(kind, themeInput = 'business') {
  const t = normalizeTheme(themeInput);
  const title = Number(t.titleSize) || 32;
  const body = Number(t.bodySize) || 19;
  const sub = Number(t.subtitleSize) || 19;
  const spec = {
    // 与 .sl-kicker 一致
    kicker: { px: 12, color: 'primary', bold: true, align: 'left' },
    // 与 .sl-title（--t-title）一致，颜色是标题色而不是品牌蓝
    title: { px: title, color: 'title', bold: true, align: 'left' },
    subtitle: { px: sub, color: 'muted', bold: false, align: 'left' },
    // 说明文字：与 .sl-points__detail 13px 同量级，跟随主题正文大小微调
    text: { px: Math.round(body * 0.68), color: 'body', bold: false, align: 'left' },
    // 卡片 / 节点标题：与 .sl-summary__text 16px 一致
    card: { px: 16, color: 'title', bold: true, align: 'left' },
    node: { px: 16, color: 'title', bold: true, align: 'left' },
    // 指标数值：与 pptx-theme.sizes.metric 同量级
    metric: { px: Math.round(title * 1.05), color: 'primary', bold: true, align: 'center' },
    image: { px: 12, color: 'muted', bold: false, align: 'center' },
    icon: { px: 28, color: 'primary', bold: true, align: 'center' },
    // 品牌色短横线 / 数据案例条：与 .sl-rule、.sl-evidence 同款
    rule: { px: 12, color: 'primary', bold: false, align: 'left' },
    evidence: { px: 12, color: 'body', bold: false, align: 'left' },
    chart: { px: 12, color: 'muted', bold: false, align: 'center' },
  }[kind] || { px: Math.round(body * 0.68), color: 'body', bold: false, align: 'left' };

  return {
    htmlPx: spec.px,
    pptxPt: pxToPt(spec.px),
    color: spec.color,
    bold: spec.bold,
    align: spec.align,
  };
}
