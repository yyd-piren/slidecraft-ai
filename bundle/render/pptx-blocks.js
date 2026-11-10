/**
 * 自由布局块的 PPTX 渲染（阶段 4f）。
 *
 * 与 render/blocks-html.js 严格一一对应：同样的 blocks 数据 → 同样的 rect() → 同样的字号常量。
 * 输出全部是 PowerPoint 原生文本框 / 形状 / 图片 / 图表对象，不是整页截图。
 */
import { rect } from './pptx-coords.js';
import { addFittedText } from './pptx-text.js';
import { drawChart } from './pptx-elements.js';
import { resolveBlocks, findOverlaps } from '../core/blocks.js';
import { blockStyle, pxToPt } from '../core/block-style.js';

const PAD = 0.08; // 与 HTML .blk__body 的内边距视觉等价（英寸）

function text(slide, value, box, theme, size, extra = {}, report = null) {
  if (!String(value ?? '').trim()) return;
  addFittedText(slide, String(value), box, {
    fontSize: size, fontFace: theme.font, color: theme.colors.body, ...extra,
  }, report);
}

/** 返回本页渲染出的块数；由 renderSlideToPptx 在自由布局模式下调用。 */
export function renderBlocksToPptx(ctx) {
  const { slide, theme, s, report } = ctx;
  const blocks = resolveBlocks(s);
  const overlaps = findOverlaps(blocks, 0.2);
  if (overlaps.length && report) {
    report({
      type: 'block-overlap',
      message: `本页有 ${overlaps.length} 处元素相互覆盖，请在网页里拖动调整后再导出`,
      detail: '',
    });
  }

  for (const b of blocks) {
    const box = rect(b.x, b.y, b.w, b.h);
    const inner = {
      x: box.x + PAD, y: box.y + PAD,
      w: Math.max(0.1, box.w - PAD * 2), h: Math.max(0.1, box.h - PAD * 2),
    };
    if (b.tone !== 'plain') {
      slide.addShape('roundRect', {
        ...box,
        fill: { color: b.tone === 'primary' ? theme.colors.accent : theme.colors.surface },
        line: { color: b.tone === 'primary' ? theme.colors.primary : theme.colors.line, width: 0.6 },
      });
    }
    // 与 .sl-summary__card 的 border-top 一致的品牌色顶线。
    if (b.topLine) {
      slide.addShape('rect', {
        x: box.x, y: box.y, w: box.w, h: 0.035,
        fill: { color: theme.colors.primary }, line: { color: theme.colors.primary, width: 0 },
      });
    }
    // 与 HTML 预览共用同一份主题样式规格：px → pt 用同一个换算，颜色取同一个主题字段。
    const st = blockStyle(b.kind, ctx.deck?.theme);
    const base = pxToPt(b.fontSize || st.htmlPx);
    const ink = theme.colors[st.color] || theme.colors.body;
    const sub = Math.max(9, Math.round(base * 0.8));
    const common = { bold: st.bold, color: ink, align: st.align };

    switch (b.kind) {
      case 'rule': {
        // 与网页 .sl-rule 一致的品牌色短横线（原生形状，可编辑）。
        slide.addShape('rect', {
          ...box, fill: { color: theme.colors.primary }, line: { color: theme.colors.primary, width: 0 },
        });
        break;
      }
      case 'evidence': {
        const isSummary = b.variant === 'summary';
        if (!isSummary) {
          slide.addShape('rect', {
            ...box, fill: { color: theme.colors.surface }, line: { color: theme.colors.line, width: 0 },
          });
        }
        slide.addShape('rect', {
          x: box.x, y: box.y, w: 0.035, h: box.h,
          fill: { color: theme.colors.primary }, line: { color: theme.colors.primary, width: 0 },
        });
        if (isSummary) {
          // 与 .sl-summary__foot 一致：无底色、无标签，只有竖线 + 一句话。
          addFittedText(slide, b.text, {
            x: box.x + 0.12, y: box.y, w: Math.max(0.2, box.w - 0.12), h: box.h,
          }, { fontSize: 11, fontFace: theme.font, color: theme.colors.muted, valign: 'mid' }, report);
        } else {
          const labelW = 1.1;
          addFittedText(slide, '数据 / 案例', {
            x: box.x + 0.12, y: box.y, w: labelW, h: box.h,
          }, { fontSize: base, fontFace: theme.font, color: theme.colors.primary, bold: true, valign: 'mid' }, report);
          addFittedText(slide, b.text, {
            x: box.x + 0.12 + labelW, y: box.y, w: Math.max(0.2, box.w - 0.12 - labelW), h: box.h,
          }, { fontSize: base, fontFace: theme.font, color: theme.colors.muted, valign: 'mid' }, report);
        }
        break;
      }
      case 'icon': {
        slide.addShape('roundRect', {
          ...box, fill: { color: theme.colors.accent }, line: { color: theme.colors.primary, width: 0.75 },
        });
        text(slide, b.glyph || '★', box, theme, base,
          { ...common, align: 'center', valign: 'mid' }, report);
        break;
      }
      case 'kicker':
        text(slide, b.text, inner, theme, base, { ...common, valign: 'mid' }, report);
        break;
      case 'title':
        text(slide, b.text, inner, theme, base, { ...common, valign: 'mid' }, report);
        break;
      case 'subtitle':
        text(slide, b.text, inner, theme, base, { ...common, valign: 'mid' }, report);
        break;
      case 'metric': {
        const top = { ...inner, h: inner.h * 0.58 };
        const bottom = { ...inner, y: inner.y + inner.h * 0.6, h: inner.h * 0.34 };
        text(slide, b.value || b.text, top, theme, base,
          { ...common, valign: 'mid' }, report);
        text(slide, b.text || b.value, bottom, theme, Math.max(9, Math.round(base * 0.42)),
          { color: theme.colors.muted, align: 'center', valign: 'top' }, report);
        break;
      }
      case 'card':
      case 'node': {
        const hasList = !!b.items?.length;
        const numH = b.number ? inner.h * 0.24 : 0;
        if (b.number) {
          addFittedText(slide, b.number, { ...inner, h: numH }, {
            fontSize: Math.max(9, Math.round(base * 0.62)), fontFace: theme.font,
            color: theme.colors.primary, bold: true, valign: 'top',
          }, report);
        }
        const head = { ...inner, y: inner.y + numH, h: hasList ? inner.h * 0.36 : inner.h - numH };
        text(slide, b.text, head, theme, base, { ...common, valign: hasList ? 'mid' : 'top' }, report);
        if (hasList) {
          text(slide, b.items.join('\n'), {
            ...inner, y: inner.y + numH + inner.h * 0.38, h: inner.h * 0.6,
          }, theme, sub, { color: theme.colors.body }, report);
        }
        break;
      }
      case 'image': {
        if (b.src) {
          try { slide.addImage({ data: b.src, ...inner }); }
          catch {
            slide.addShape('rect', { ...inner, fill: { color: theme.colors.surface }, line: { color: theme.colors.line, width: 0.5 } });
            text(slide, b.text || '配图区域', inner, theme, base, { color: theme.colors.muted, align: 'center', valign: 'mid' }, report);
          }
        } else {
          slide.addShape('rect', { ...inner, fill: { color: theme.colors.surface }, line: { color: theme.colors.line, width: 0.5 } });
          text(slide, b.text || '配图区域', inner, theme, base, { color: theme.colors.muted, align: 'center', valign: 'mid' }, report);
        }
        break;
      }
      case 'chart': {
        if (b.chart) {
          try { drawChart(slide, inner, { chart: b.chart, title: b.text }, theme); }
          catch { text(slide, b.text || '图表区域', inner, theme, base, { align: 'center', valign: 'mid' }, report); }
        } else {
          text(slide, b.text || '图表区域', inner, theme, base,
            { color: theme.colors.muted, align: 'center', valign: 'mid' }, report);
        }
        break;
      }
      default: {
        const lines = [b.text, ...(b.items || [])].filter(Boolean).join('\n');
        text(slide, lines, inner, theme, base, { color: theme.colors.body }, report);
      }
    }
  }
  return blocks.length;
}
