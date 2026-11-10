/**
 * PPTX 文字排版（阶段 3）。
 *
 * 目标：不静默截断用户内容、不让文字越出文本框/页面、不让标题与正文层级丢失。
 * 做法：先按中英文混排估算所需行数，超出文本框高度时按有限档位缩小字号；
 * 仍放不下则交给 PowerPoint 的 normAutofit 兜底，并产生明确导出警告。
 */
const PT_PER_INCH = 72;

/** 估算一个字符串占多少「全角字符宽度单位」：中文 1、英数 0.55、空格 0.35。 */
function widthUnits(text) {
  let units = 0;
  for (const ch of String(text || '')) {
    const code = ch.codePointAt(0);
    if (/\s/.test(ch)) units += 0.35;
    else if (code > 0x2e80) units += 1; // CJK、全角标点、中文符号
    else units += 0.55;
  }
  return units;
}

/** 估算文本在给定宽度/字号下需要多少行（含显式换行）。 */
function estimateLines(text, boxWInches, fontSizePt) {
  const perLine = Math.max(4, (boxWInches * PT_PER_INCH) / fontSizePt);
  let total = 0;
  for (const paragraph of String(text || '').split('\n')) {
    if (!paragraph) { total += 1; continue; }
    total += Math.max(1, Math.ceil(widthUnits(paragraph) / perLine));
  }
  return Math.max(1, total);
}

const SCALE_STEPS = [1, 0.9, 0.82, 0.74, 0.68];

/**
 * 自适应文本框。box 为英寸矩形；style 含 color/fontFace/bold/align/valign/lineSpacing。
 * 返回 {fontSize, lines, adjusted, overflow}。
 */
export function addFittedText(slide, text, box, style, reporter = null) {
  const base = Math.max(9, Number(style.fontSize) || 14);
  const lineHeightRatio = 1.35;
  let chosen = base;
  let lines = 1;
  let overflow = false;

  for (const scale of SCALE_STEPS) {
    chosen = Math.max(9, Math.round(base * scale * 10) / 10);
    lines = estimateLines(text, box.w, chosen);
    // 单行文本只占约一个字号的高度；多行才需要额外行距，避免把小卡片误判为溢出。
    const ratio = lines > 1 ? lineHeightRatio : 1.0;
    const needed = (lines * chosen * ratio) / PT_PER_INCH;
    if (needed <= box.h * 1.02) { overflow = false; break; }
    overflow = true;
  }

  const opts = {
    x: box.x, y: box.y, w: box.w, h: box.h,
    fontSize: chosen,
    fontFace: style.fontFace || 'Microsoft YaHei',
    color: style.color || '0F172A',
    bold: !!style.bold,
    italic: !!style.italic,
    align: style.align || 'left',
    valign: style.valign || 'top',
    margin: 0,
    breakLine: false,
    lineSpacingMultiple: 1.0,
    fit: overflow ? 'shrink' : 'none', // 极端情况交给 PowerPoint 自动缩排，绝不截断
  };
  if (style.rotate !== undefined) opts.rotate = style.rotate;
  if (style.charSpacing !== undefined) opts.charSpacing = style.charSpacing;
  slide.addText(String(text ?? ''), opts);

  if (overflow && reporter) {
    reporter({
      type: 'text-overflow',
      message: `文字在给定区域内偏多（估算 ${lines} 行 / ${chosen}pt），已启用 PowerPoint 自动缩排`,
      detail: String(text || '').slice(0, 40),
    });
  }
  return { fontSize: chosen, lines, adjusted: chosen < base, overflow };
}

/** 富文本行数组：用于要点列表，序号、正文、补充说明均保持可编辑。 */
export function buildPointRuns(points, theme, baseSize) {
  const runs = [];
  const list = Array.isArray(points) ? points : [];
  list.forEach((p, i) => {
    const text = String(p?.text ?? p ?? '');
    const detail = String(p?.detail ?? '');
    if (!text && !detail) return;
    runs.push({
      text: `${String(i + 1).padStart(2, '0')}  ${text}`,
      options: { breakLine: true, bold: true, fontSize: baseSize, color: theme.colors.body, fontFace: theme.font },
    });
    if (detail) {
      runs.push({
        text: `      ${detail}`,
        options: { breakLine: true, fontSize: Math.max(9, baseSize - 3), color: theme.colors.muted, fontFace: theme.font },
      });
    }
  });
  return runs;
}

/**
 * 要点列表 —— 与网页 .sl-points 一致的三列独立布局：
 * 编号（蓝色）/ 标题（粗体）/ 说明（灰色小字），条目之间保留明显留白。
 * 每条都是独立的原生文本框，方便在 PowerPoint 中单独编辑。
 */
export function addPointList(slide, points, box, theme, reporter = null) {
  const list = (Array.isArray(points) ? points : []).filter((p) => p && (p.text || p.detail));
  if (!list.length) return;

  // 网页基准（960×540 画布换算为英寸）：编号列 24px、编号与文字间隔 14px、
  // 每条高 50px（标题 27.5px + 说明 22.5px）、条目间距 15px。
  const NUM_W = 0.333;
  const TEXT_GAP = 0.194;
  const ROW_H = 0.694;
  const ROW_GAP = 0.208;

  const n = list.length;
  const need = n * ROW_H + Math.max(0, n - 1) * ROW_GAP;
  const scale = need > box.h ? Math.max(0.35, box.h / need) : 1;
  const rowH = ROW_H * scale;
  const gap = ROW_GAP * scale;
  const numW = Math.min(NUM_W, box.w * 0.12);
  const textX = box.x + numW + TEXT_GAP * scale;
  const textW = Math.max(0.4, box.w - numW - TEXT_GAP * scale);
  const numSize = Math.max(9, Math.round((theme.sizes.small + 2) * Math.min(1, scale + 0.15)));
  const titleSize = Math.max(9, Math.round(theme.sizes.body * Math.min(1, scale + 0.15)));
  const detailSize = Math.max(8, Math.round((theme.sizes.small + 1) * Math.min(1, scale + 0.15)));

  list.forEach((p, i) => {
    const y = box.y + i * (rowH + gap);
    slide.addText(String(i + 1).padStart(2, '0'), {
      x: box.x, y, w: numW, h: rowH * 0.5,
      fontSize: numSize, bold: true, fontFace: theme.font,
      color: theme.colors.primary, valign: 'top', margin: 0,
    });
    addFittedText(slide, p.text || '', { x: textX, y, w: textW, h: rowH * 0.55 }, {
      fontSize: titleSize, bold: true, fontFace: theme.font,
      color: theme.colors.body, valign: 'top',
    }, reporter);
    if (p.detail) {
      addFittedText(slide, p.detail, { x: textX, y: y + rowH * 0.58, w: textW, h: rowH * 0.4 }, {
        fontSize: detailSize, fontFace: theme.font, color: theme.colors.muted, valign: 'top',
      }, reporter);
    }
  });

  if (scale < 1 && reporter) {
    reporter({
      type: 'text-overflow',
      message: `本页有 ${n} 条要点，正文区域偏紧，已按比例压缩行距与字号（未删减内容）`,
      detail: '',
    });
  }
}
