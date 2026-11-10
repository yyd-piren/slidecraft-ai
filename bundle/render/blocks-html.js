/**
 * 自由布局块的 HTML 预览渲染。
 *
 * 位置、尺寸、字号全部来自 core/blocks.js 的同一份数据；
 * 与 render/pptx-blocks.js 一一对应，绝不读取 DOM 截图，也不另算一套坐标。
 */
import { resolveBlocks } from '../core/blocks.js';
import { blockStyle, HTML_COLOR } from '../core/block-style.js';

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function barChart(chart) {
  const labels = Array.isArray(chart?.labels) ? chart.labels : [];
  const values = Array.isArray(chart?.series?.[0]?.values) ? chart.series[0].values : [];
  if (!labels.length || !values.length) return '<div class="blk__placeholder">图表区域 · 可在右侧编辑数据</div>';
  const max = Math.max(1, ...values.map((v) => Number(v) || 0));
  return `<div class="blk__chart">${labels.map((l, i) => `
    <div class="blk__chart-col"><span class="blk__chart-val">${esc(values[i] ?? '')}</span>
      <i style="height:${Math.max(6, (Number(values[i]) || 0) / max * 100)}%"></i>
      <span class="blk__chart-label">${esc(l)}</span></div>`).join('')}</div>`;
}

function bodyHTML(b) {
  const items = (b.items || []).filter(Boolean);
  const lines = b.text.split('\n').filter(Boolean);
  switch (b.kind) {
    case 'kicker': return `<div class="blk__kicker">${esc(b.text)}</div>`;
    case 'title': return `<div class="blk__title">${esc(b.text)}</div>`;
    case 'subtitle': return `<div class="blk__subtitle">${esc(b.text)}</div>`;
    case 'metric': return `<div class="blk__metric"><b>${esc(b.value || b.text)}</b><span>${esc(b.text || b.value)}</span></div>`;
    case 'rule': return '<i class="blk__rule"></i>';
    case 'evidence': return b.variant === 'summary'
      ? `<div class="blk__evidence blk__evidence--summary">${esc(b.text)}</div>`
      : `<div class="blk__evidence"><span>数据 / 案例</span>${esc(b.text)}</div>`;
    case 'icon': return `<div class="blk__icon">${esc(b.glyph || '★')}</div>`;
    case 'card':
    case 'node': return `${b.topLine ? '<i class="blk__topline"></i>' : ''}
      ${b.number ? `<span class="blk__num">${esc(b.number)}</span>` : ''}
      <div class="blk__head">${esc(b.text)}</div>${items.length
      ? `<ul class="blk__list">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`;
    case 'image': return b.src
      ? `<img class="blk__img" src="${esc(b.src)}" alt="${esc(b.text)}" />`
      : `<div class="blk__placeholder">${esc(b.text || '配图区域')}</div>`;
    case 'chart': return barChart(b.chart);
    default: return `<div class="blk__text">${lines.map((x) => `<div>${esc(x)}</div>`).join('')}</div>${items.length
      ? `<ul class="blk__list">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`;
  }
}

/** 渲染整层；主题决定字号与颜色，selectedId 只影响高亮，不参与坐标计算。 */
export function renderBlocksHTML(slide, themeInput = 'business', selectedId = null) {
  const blocks = resolveBlocks(slide);
  return `<div class="blk-layer" data-blk-layer>${blocks.map((b) => {
    const pos = `left:${(b.x * 100).toFixed(4)}%;top:${(b.y * 100).toFixed(4)}%;width:${(b.w * 100).toFixed(4)}%;height:${(b.h * 100).toFixed(4)}%`;
    // 用户手动设过 fontSize 时以它为准，但仍按同一 px→pt 规则换算（PPTX 侧同理）。
    const st = blockStyle(b.kind, themeInput);
    const px = b.fontSize || st.htmlPx;
    const color = HTML_COLOR[st.color] || HTML_COLOR.body;
    return `<div class="blk blk--${b.kind} blk--${b.tone}${b.id === selectedId ? ' blk--active' : ''}"
        data-blk-id="${esc(b.id)}" data-blk-px="${px}"
        style="${pos};font-size:${px}px;color:${color}"
        title="拖动调整位置 · 右下角缩放 · x=${b.x.toFixed(3)} y=${b.y.toFixed(3)} w=${b.w.toFixed(3)} h=${b.h.toFixed(3)}">
      <div class="blk__body">${bodyHTML(b)}</div>
      <span class="blk__tag">${esc(b.kind)}</span>
      <span class="blk__resize" data-blk-resize="1" title="拖动缩放"></span>
    </div>`;
  }).join('')}</div>`;
}
