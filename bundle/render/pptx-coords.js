/**
 * PPTX 统一坐标系统（阶段 3）。
 *
 * 所有布局都用 0~1 归一化坐标描述，再由这里统一换算成 LAYOUT_WIDE 的英寸值。
 * 这样 12 种布局共享同一套边距、安全区、间距与越界保护，不会各自写一套算法。
 */
export const SLIDE_W = 13.333; // inches —— PowerPoint 标准宽屏 16:9
export const SLIDE_H = 7.5;
export const PAGE_MARGIN = 0.055; // 归一化页边距

/**
 * 常用逻辑区域（归一化）。这些数值由 CDP 对网页 getBoundingClientRect 的实测换算而来
 * （960×540 逻辑画布），保证 HTML 预览与 PPTX 导出的位置一一对应：
 *   .sl-pad → kicker y=52, title y=81, rule y=139
 *   .sl-evidence → y≈441；.slide__foot 上边线 → y≈490
 * 改网页 CSS 后必须同步这里，回归测试会逐项比对网页实测与 PPTX 形状坐标。
 */
export const REGIONS = {
  kicker: { x: 0.0667, y: 0.0963, w: 0.8667, h: 0.0355 },
  title: { x: 0.0667, y: 0.1503, w: 0.8667, h: 0.077 },
  rule: { x: 0.0667, y: 0.257, w: 0.0542, h: 0.0056 },
  body: { x: 0.0667, y: 0.3037, w: 0.8667, h: 0.505 },
  evidence: { x: 0.0667, y: 0.8163, w: 0.8667, h: 0.0652 },
  footLine: { x: 0.0667, y: 0.9082, w: 0.8667, h: 0.0019 },
  foot: { x: 0.0667, y: 0.926, w: 0.8667, h: 0.033 },
};

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number(n) || 0));

/** 归一化矩形 → 英寸矩形；自动 clamp 到页面边界，绝不产生越界对象。 */
export function rect(nx, ny, nw, nh) {
  const x1 = clamp(nx, PAGE_MARGIN, 1 - PAGE_MARGIN);
  const y1 = clamp(ny, PAGE_MARGIN, 1 - PAGE_MARGIN);
  const x2 = clamp(nx + nw, PAGE_MARGIN, 1 - PAGE_MARGIN);
  const y2 = clamp(ny + nh, PAGE_MARGIN, 1 - PAGE_MARGIN);
  return {
    x: x1 * SLIDE_W,
    y: y1 * SLIDE_H,
    w: Math.max(0.02, (x2 - x1) * SLIDE_W),
    h: Math.max(0.02, (y2 - y1) * SLIDE_H),
  };
}

/** 相对某个区域取一块子区域（仍为归一化坐标）。 */
export function sub(region, dx, dy, dw, dh) {
  return rect(region.x + dx * region.w, region.y + dy * region.h, dw * region.w, dh * region.h);
}

/** 把一个区域按列/行等分，返回归一化矩形数组。 */
export function grid(region, cols, rows = 1, gap = 0.02) {
  const out = [];
  const cw = (1 - gap * (cols - 1)) / cols;
  const ch = (1 - gap * (rows - 1)) / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push(sub(region, c * (cw + gap), r * (ch + gap), cw, ch));
    }
  }
  return out;
}

/** 主题间距 → 归一化间隔（紧凑/标准/宽松）。 */
export function gapFor(spacing) {
  if (spacing === 'compact') return 0.012;
  if (spacing === 'spacious') return 0.032;
  return 0.02;
}

/** 导出前检查归一化元素坐标是否越界（用于 validator 生成明确警告）。 */
export function findOutOfBounds(norm) {
  if (!norm || typeof norm !== 'object') return false;
  const keys = ['x', 'y', 'w', 'h'];
  if (keys.some((k) => norm[k] === undefined)) return false;
  return (
    norm.x < 0 || norm.y < 0 || norm.w <= 0 || norm.h <= 0 ||
    norm.x + norm.w > 1 - PAGE_MARGIN + 1e-6 ||
    norm.y + norm.h > 1 - PAGE_MARGIN + 1e-6
  );
}
