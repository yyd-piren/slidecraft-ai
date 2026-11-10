/**
 * 网页预览 / PPTX 导出共享的图表规格。
 *
 * 此前 HTML nativeChart() 只画 series[0]（单色柱 + 柱顶数值），PPTX drawChart()
 * 却画全部系列（分组柱 + 图例 + 坐标轴），导致图表页「网页和导出完全不同」，
 * 甚至丢掉第二、三系列的数据。这里把口径收成唯一真相。
 */
export const CANVAS = { w: 960, h: 540 };
export const pxToPt = (px) => px * 0.75;

export const CHART = {
  maxSeries: 3,
  maxAsidePoints: 3,          // chart 页右侧要点条数（网页旧代码只给 2 条）
  showValue: false,           // 与 PPTX showValue:false 一致：柱顶不写数值
  legendPos: 'b',             // 图例在下方
  colors: ['primary', 'secondary', 'muted'],
  /** chart 页左侧图表区域（CDP 实测，归一化）。 */
  box: { x: 0.0667, y: 0.311, w: 0.515, h: 0.419 },
  /** chart 页右侧要点（CDP 实测，CSS px）。 */
  aside: { numPx: 14, titlePx: 15, detailPx: 12, rowPx: 54.7 },
};

/** 把任意 chart 对象规整成 HTML 与 PPTX 共用的 {labels, series, type}。 */
export function chartSeries(input) {
  const raw = input?.chart || input || {};
  const labels = (Array.isArray(raw.labels) ? raw.labels : ['阶段一', '阶段二', '阶段三', '阶段四']).map(String);
  const src = Array.isArray(raw.series) && raw.series.length
    ? raw.series
    : [{ name: input?.title || '数据', values: [38, 56, 74, 91] }];
  const series = src.slice(0, CHART.maxSeries).map((s, i) => ({
    name: String(s?.name || `系列 ${i + 1}`),
    values: (Array.isArray(s?.values) ? s.values : [1, 2, 3, 4]).map((v) => Number(v) || 0),
    color: CHART.colors[i] || CHART.colors[0],
  }));
  const t = String(raw.type || 'bar');
  const type = ['bar', 'line', 'pie', 'area', 'doughnut', 'scatter'].includes(t) ? t : 'bar';
  return { labels, series, type };
}

/**
 * 近似 PowerPoint 自动坐标轴：把 max 向上取整到「整齐步长」的整数倍。
 * 例如 4200 → step 500、top 4500（与真实 PPT 渲染一致）。
 */
export function chartAxis(values) {
  const max = Math.max(1, ...values.map((v) => Number(v) || 0));
  const raw = max / 9;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const k = [1, 2, 2.5, 5, 10].find((n) => n * mag >= raw) || 10;
  const step = k * mag;
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + 1e-6; v += step) ticks.push(Math.round(v * 100) / 100);
  return { max, step, top, ticks };
}
