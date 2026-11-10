/**
 * 网页预览 / PPTX 导出共享的布局几何规格。
 *
 * 背景：自动构图里 HTML 用 CSS 定位、PPTX 用 rect() 换算英寸，两边各写一套常量，
 * 就会出现「网页里和导出的 PPTX 不一样」（例如时间轴一边穿过圆心、一边在圆点下方带箭头）。
 * 这里把动态布局的几何与字号收成唯一真相：
 *   - HTML：归一化坐标 × 画布 960×540 → CSS px，绝对定位
 *   - PPTX：rect(x, y, w, h) → 英寸；字号 px × 0.75 → pt
 * 坐标取自 CDP 对网页 getBoundingClientRect 的实测，改布局请改这里，不要再分别改 CSS 和 PPTX。
 */
export const CANVAS = { w: 960, h: 540 };

/** CSS px → PowerPoint pt（1pt = 1.333px）。 */
export const pxToPt = (px) => px * 0.75;
export const pct = (v) => `${(v * 100).toFixed(4)}%`;
export const pxX = (v) => `${(v * CANVAS.w).toFixed(2)}px`;
export const pxY = (v) => `${(v * CANVAS.h).toFixed(2)}px`;

/** 把 CSS opacity 等价成 PPT 的实色：base 上叠 overlay（t=0 全 base，t=1 全 overlay）。 */
export function mixHex(base, overlay, t) {
  const parse = (v) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(v || '').trim());
    return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null;
  };
  const a = parse(base);
  const b = parse(overlay);
  if (!a || !b) return String(overlay).replace('#', '').toUpperCase();
  const k = Math.max(0, Math.min(1, Number(t) || 0));
  return a.map((v, i) => Math.round(v * (1 - k) + b[i] * k).toString(16).padStart(2, '0')).join('').toUpperCase();
}

const PAD_X = 0.0667;      // .sl-pad 的 64px 左右内边距
const CONTENT_W = 0.8667;  // 960 - 64*2
const ITEM_PAD = 0.00625;  // .dyn-timeline__item 的 6px 内边距

/**
 * timeline 页实测几何（960×540 画布，4 列时逐项校准）。
 * 轴线穿过圆点中心：axis.y = dot.y + dot.h / 2。
 */
export const TIMELINE = {
  kicker: 'TIMELINE',
  axis: { x: 0.136, y: 0.3718, w: 0.728, h: 0.0037, opacity: 0.45 },
  dot: { y: 0.3477, w: 0.0271, h: 0.0481, fontPx: 12 },
  title: { y: 0.4181, h: 0.0415, fontPx: 14 },
  // h 是网页单行实测高度；boxH 是 PPTX 文本框高度，留出两行余量避免长说明触发溢出警告，
  // 文字仍从 y 起 top 对齐，网页里多行文字也会自然向下延伸，两者视觉一致。
  text: { y: 0.4688, h: 0.0295, boxH: 0.059, fontPx: 11 },
};

/** 按列数均分，返回每列圆点 / 标题 / 说明的归一化矩形（HTML 与 PPTX 共用）。 */
export function timelineCells(n) {
  const count = Math.max(1, Math.min(6, Number(n) || 1));
  const colW = CONTENT_W / count;
  return Array.from({ length: count }, (_, i) => {
    const colX = PAD_X + i * colW;
    const x = colX + ITEM_PAD;
    const w = Math.max(0.02, colW - ITEM_PAD * 2);
    const dot = {
      x: colX + colW / 2 - TIMELINE.dot.w / 2,
      y: TIMELINE.dot.y, w: TIMELINE.dot.w, h: TIMELINE.dot.h,
    };
    const title = { x, y: TIMELINE.title.y, w, h: TIMELINE.title.h };
    const text = { x, y: TIMELINE.text.y, w, h: TIMELINE.text.h };
    const item = {
      x, y: TIMELINE.dot.y, w,
      h: TIMELINE.text.y + TIMELINE.text.h - TIMELINE.dot.y,
    };
    return { colX, colW, dot, title, text, item };
  });
}

/** 网页 .sl-evidence 实测：仅左侧 3px 竖线，没有整体外框。 */
export const EVIDENCE = {
  x: 0.0667, y: 0.8163, w: 0.8667, h: 0.0652,
  fontPx: 12, leftBarPx: 3, bordered: false,
};
