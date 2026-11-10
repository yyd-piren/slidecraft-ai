/**
 * 动态主题系统（阶段 2.5）。
 *
 * Theme 的完整定义在 core/deck.js 的 THEME_PRESETS / normalizeTheme 中，
 * 并且**以完整 JSON 存进 deck.theme**（不是 CSS、也不是字符串 ID），
 * 阶段 3 的 PPTX 渲染器可直接消费这些字段。
 *
 * 本模块只负责：预设查询、深色判定、把 Theme JSON 派生为画布 CSS 变量。
 * themeVars 同时接受旧版字符串 ID（'business' / 'academic'）与新的 Theme 对象。
 */
import { THEME_PRESETS, THEME_IDS, normalizeTheme } from '../core/deck.js';

export const THEMES = THEME_PRESETS;

export function getTheme(input) {
  if (typeof input === 'string') return normalizeTheme(input);
  return normalizeTheme(input);
}

export function themeOptions() {
  return THEME_IDS.map((id) => ({ id, name: THEME_PRESETS[id].name }));
}

export function presetThemes() {
  return THEME_IDS.map((id) => normalizeTheme(id));
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function isDarkBackground(hex) {
  const c = hexToRgb(hex);
  if (!c) return false;
  return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255 < 0.5;
}

function rgba(hex, alpha) {
  const c = hexToRgb(hex);
  return c ? `rgba(${c.r},${c.g},${c.b},${alpha})` : `rgba(37,99,235,${alpha})`;
}

const SPACING_PAD = { compact: 38, normal: 52, spacious: 66 };

/** 把 Theme JSON 转成内联 CSS 变量串（默认 CSP 允许 style-src 'unsafe-inline'）。 */
export function themeVars(input) {
  const t = normalizeTheme(input);
  const dark = isDarkBackground(t.background);
  const line = dark ? 'rgba(255,255,255,.16)' : '#E2E8F0';
  const surface = dark ? 'rgba(255,255,255,.06)' : '#F7F9FC';
  const soft = dark ? rgba(t.primaryColor, 0.2) : t.accentColor;
  const muted = dark ? 'rgba(226,232,240,.64)' : '#64748B';
  const white = t.background;
  const pairs = [
    ['--c-bg', t.background],
    ['--c-brand', t.primaryColor],
    ['--c-brandDeep', t.secondaryColor],
    ['--c-ink', t.titleColor],
    ['--c-text', t.bodyColor],
    ['--c-muted', muted],
    ['--c-line', line],
    ['--c-surface', surface],
    ['--c-soft', soft],
    ['--c-white', white],
    ['--c-positive', dark ? '#34D399' : '#0E9F6E'],
    ['--f-head', t.fontFamily],
    ['--f-body', t.fontFamily],
    ['--t-title', `${t.titleSize}px`],
    ['--t-subtitle', `${t.subtitleSize}px`],
    ['--t-body', `${t.bodySize}px`],
    ['--sp-pad', `${SPACING_PAD[t.spacing] ?? 52}px`],
    ['--radius', `${t.borderRadius}px`],
    ['--deco', t.decorationStyle],
  ];
  return pairs.map(([k, v]) => `${k}:${v}`).join(';') + `;--dark:${dark ? 1 : 0}`;
}

/** 主题字段的中文标签，供主题设计面板使用。 */
export const THEME_FIELD_LABELS = {
  background: '背景色',
  primaryColor: '主色',
  secondaryColor: '辅助色',
  accentColor: '强调色',
  titleColor: '标题色',
  bodyColor: '正文色',
  fontFamily: '字体',
  titleSize: '标题字号',
  subtitleSize: '副标题字号',
  bodySize: '正文字号',
  spacing: '页面间距',
  borderRadius: '圆角',
  decorationStyle: '装饰风格',
};
