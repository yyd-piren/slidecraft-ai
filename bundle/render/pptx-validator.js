/**
 * 导出前数据校验（阶段 3）。
 * errors 会阻断导出；warnings 会继续导出并在结果中明确展示给用户。
 * 校验只读 Deck，不修改任何数据。
 */
import { LAYOUT_TYPES, toLayout, normalizeTheme } from '../core/deck.js';
import { findOutOfBounds } from './pptx-coords.js';

export const KNOWN_KINDS = [
  'layer', 'node', 'connector', 'step', 'column', 'metric', 'bar', 'note', 'label',
  // 向后兼容别名（用户未来 AI 可能产出这些名称）
  'module', 'edge', 'text', 'shape', 'chart', 'image',
];

export function validateForExport(deck) {
  const errors = [];
  const warnings = [];
  if (!deck || typeof deck !== 'object') return { ok: false, errors: ['Deck 数据不存在'], warnings };
  if (!deck.id) errors.push('Deck 缺少 id');
  if (!Array.isArray(deck.slides) || !deck.slides.length) errors.push('没有可导出的页面');

  let theme;
  try { theme = normalizeTheme(deck.theme); }
  catch (e) { errors.push(`主题数据无效：${e?.message || e}`); }
  if (theme && !theme.fontFamily) warnings.push({ type: 'theme', message: '主题未指定字体，将使用微软雅黑', detail: '' });

  const layouts = new Set();
  const slides = Array.isArray(deck.slides) ? deck.slides : [];
  slides.forEach((s, i) => {
    const tag = `第 ${i + 1} 页`;
    if (!s || !s.id) { errors.push(`${tag} 缺少 slide.id`); return; }
    const layout = toLayout(s.layout || s.type);
    layouts.add(layout);
    if (!LAYOUT_TYPES.includes(layout)) errors.push(`${tag} 使用了未知布局：${s.layout || s.type}`);

    const hasText = String(s.title || '') || (Array.isArray(s.points) && s.points.length) || (Array.isArray(s.elements) && s.elements.length);
    if (!hasText) warnings.push({ type: 'empty', message: `${tag} 没有任何内容，将导出为空白页`, detail: s.title || '' });
    if (String(s.title || '').length > 90) {
      warnings.push({ type: 'long-title', message: `${tag} 标题过长（${String(s.title).length} 字），已启用自动缩排`, detail: String(s.title).slice(0, 30) });
    }

    const els = Array.isArray(s.elements) ? s.elements : [];
    const ids = new Set(els.map((e) => e?.id).filter(Boolean));
    els.forEach((e) => {
      if (!e || typeof e !== 'object') return;
      if (!KNOWN_KINDS.includes(String(e.kind || ''))) {
        warnings.push({ type: 'element', message: `${tag} 含未知元素类型「${e.kind}」，将按普通文本卡片处理`, detail: '' });
      }
      if (e.kind === 'connector' && (e.from || e.to) && (!ids.has(e.from) || !ids.has(e.to))) {
        warnings.push({ type: 'connector', message: `${tag} 的连接线引用了不存在的节点（${e.from} → ${e.to}），已按位置顺序连线`, detail: '' });
      }
      // 只有显式提供归一化坐标的元素才做越界检查；x/y/w/h 为 null 是合法的「未指定」。
      const hasCoords = ['x', 'y', 'w', 'h'].every((k) => typeof e[k] === 'number');
      if (hasCoords && findOutOfBounds(e)) {
        warnings.push({ type: 'bounds', message: `${tag} 有元素超出页面安全区，已自动收回到边界内`, detail: e.id || '' });
      }
    });
  });

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: { pages: slides.length, layouts: [...layouts], themeName: theme?.name || '未知' },
  };
}
