/**
 * Theme JSON → PowerPoint 主题参数（阶段 3）。
 *
 * 唯一输入是 Deck.theme 的完整 Theme JSON；不读取任何 CSS、不硬编码颜色/字体/字号到布局里。
 * 负责：HEX 规范化、深色背景下的文字对比度保护、CSS 字体串 → Office 字体名回退、
 * px → pt 字号换算、间距/圆角/装饰风格的统一映射。
 */
import { normalizeTheme } from '../core/deck.js';
import { isDarkBackground } from './themes.js';

const DEFAULT_HEX = '2563EB';
const LIGHT_TEXT = 'F8FAFC';
const DARK_TEXT = '0F172A';

/** Windows Office 常见中文字体优先；取不到时用微软雅黑兜底。 */
const FONT_PREFERENCE = [
  'Microsoft YaHei', '微软雅黑', '等线', 'DengXian', 'SimHei', '黑体',
  'SimSun', '宋体', 'PingFang SC', 'Microsoft JhengHei', 'Calibri', 'Arial',
];
export const DEFAULT_FONT = 'Microsoft YaHei';

export function toHex(value, fallback = DEFAULT_HEX) {
  const raw = String(value || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{6}$/i.test(raw)) return raw.toUpperCase();
  if (/^[0-9a-f]{3}$/i.test(raw)) return raw.split('').map((c) => c + c).join('').toUpperCase();
  return fallback;
}

function luminance(hex) {
  const h = toHex(hex);
  const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrast(a, b) {
  const la = luminance(a); const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** 深色背景自动使用浅色文字；浅色背景自动使用深色文字（对比度不足时）。 */
export function ensureReadable(fg, bg) {
  const background = toHex(bg, 'FFFFFF');
  const foreground = toHex(fg, DARK_TEXT);
  if (contrast(foreground, background) >= 3) return foreground;
  return isDarkBackground('#' + background) ? LIGHT_TEXT : DARK_TEXT;
}

/** CSS font-family 串（单引号字体名列表）→ 单个 Office 字体名。 */
export function resolveFont(fontFamily) {
  const raw = String(fontFamily || '');
  const names = raw.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
  for (const n of names) {
    const hit = FONT_PREFERENCE.find((p) => p.toLowerCase() === n.toLowerCase());
    if (hit) return hit;
  }
  // 用户自定义字体：保留名字本身（PowerPoint 会按本机字体回退），但限制长度避免破坏 XML。
  const custom = names.find((n) => n && n.length < 40 && !/sans-serif|serif|monospace|^system/i.test(n));
  return custom || DEFAULT_FONT;
}

/** CSS px → PowerPoint pt（约 0.75 倍），并限制在合理区间。 */
export function pxToPt(px, fallback = 18) {
  const n = Number(px) || fallback;
  return Math.max(9, Math.min(54, Math.round(n * 0.75)));
}

export function toPptxTheme(input) {
  const t = normalizeTheme(input);
  const background = toHex(t.background, 'FFFFFF');
  const dark = isDarkBackground('#' + background);
  // 与网页 CSS 变量 --c-surface / --c-line 保持一致（中性浅灰，不用 accentColor）。
  const surface = dark ? '1F2937' : 'F7F9FC';
  const line = dark ? '475569' : 'E2E8F0';

  return {
    name: t.name || '自定义主题',
    dark,
    // 颜色全部为无 # 的 6 位 HEX，可直接传给 PptxGenJS。
    colors: {
      background,
      primary: toHex(t.primaryColor),
      secondary: toHex(t.secondaryColor),
      accent: toHex(t.accentColor, dark ? '334155' : 'EAF1FF'),
      title: ensureReadable(t.titleColor, background),
      body: ensureReadable(t.bodyColor, background),
      muted: dark ? 'CBD5E1' : '64748B',
      surface,
      line,
      white: 'FFFFFF',
    },
    font: resolveFont(t.fontFamily),
    sizes: {
      title: pxToPt(t.titleSize, 32),
      subtitle: pxToPt(t.subtitleSize, 19),
      body: pxToPt(t.bodySize, 19),
      // 派生档位：卡片标题、指标数值、页脚。
      card: Math.max(10, Math.round(pxToPt(t.bodySize, 19) * 0.9)),
      metric: Math.max(20, Math.round(pxToPt(t.titleSize, 32) * 1.05)),
      small: Math.max(8, Math.round(pxToPt(t.bodySize, 19) * 0.62)),
    },
    spacing: t.spacing || 'normal',
    radius: Number(t.borderRadius) || 4,
    decoration: t.decorationStyle || 'minimal',
    emphasisScale: t.titleSize >= 38 ? 1.1 : 1,
  };
}
