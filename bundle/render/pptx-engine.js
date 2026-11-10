/**
 * PPTX 渲染引擎统一入口（阶段 3）。
 *
 * UI 层与业务层只调用 renderDeckToPptx(deck, options)，完全不接触 PptxGenJS 的 API。
 * 未来替换生成库时只需改本文件 + pptx-layouts/pptx-elements 的绘制原语，应用其余部分不动。
 */
import { toLayout } from '../core/deck.js';
import { toPptxTheme } from './pptx-theme.js';
import { renderSlideToPptx, SUPPORTED_LAYOUTS } from './pptx-layouts.js';
import { validateForExport } from './pptx-validator.js';
import { SLIDE_W, SLIDE_H } from './pptx-coords.js';

export const PPTX_VENDOR_VERSION = '4.0.1';
export const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

let libraryPromise = null;

/** 懒加载自包含浏览器 ESM 包（bundle/vendor/ 内，无外部依赖、CSP 友好）。 */
export function loadPptxLibrary() {
  if (!libraryPromise) {
    libraryPromise = import('../vendor/pptxgen.bundle.esm.js').then((mod) => {
      const Ctor = mod.default;
      if (typeof Ctor !== 'function') throw new Error('PptxGenJS 未能正确加载（default 导出不是构造器）');
      return Ctor;
    });
  }
  return libraryPromise;
}

export function buildFileName(deck) {
  const topic = String(deck?.meta?.topic || '演示文稿')
    .replace(/[\\/:*?"<>|\r\n\t]/g, '').trim().slice(0, 28) || '演示文稿';
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `SlideCraft_${topic}_${date}.pptx`;
}

/**
 * 输入完整 Deck，输出真实 PPTX 文件数据。
 * @returns {Promise<{buffer:ArrayBuffer, bytes:Uint8Array, fileName:string, warnings:Array, stats:Object}>}
 */
export async function renderDeckToPptx(deck, options = {}) {
  const check = validateForExport(deck);
  if (!check.ok) throw new Error(`导出数据校验失败：${check.errors.join('；')}`);

  const PptxGenJS = await loadPptxLibrary();
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.333" × 7.5"，标准 16:9
  pptx.author = options.author || 'SlideCraft AI';
  pptx.company = 'SlideCraft AI';
  pptx.title = String(deck.meta?.topic || 'SlideCraft 演示文稿');
  pptx.subject = String(deck.meta?.purpose || '');
  pptx.lang = 'zh-CN';
  pptx.rtlMode = false;

  const theme = toPptxTheme(deck.theme);
  const warnings = check.warnings.map((w) => ({ ...w, page: null }));
  let currentPage = 0;
  const report = (w) => warnings.push({ ...w, page: currentPage });

  const slides = Array.isArray(deck.slides) ? deck.slides : [];
  const layoutsUsed = new Set();
  slides.forEach((s, i) => {
    currentPage = i + 1;
    const slide = pptx.addSlide();
    const layout = toLayout(s.layout || s.type);
    layoutsUsed.add(layout);
    renderSlideToPptx({
      pptx, slide, deck, s, theme, layout,
      pageNo: i + 1, total: slides.length, report,
    });
  });

  let buffer;
  try {
    buffer = await pptx.write({ outputType: 'arraybuffer', compression: true });
  } catch (e) {
    throw new Error(`PPTX 生成失败：${e?.message || e}`);
  }
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 1024) {
    throw new Error('PPTX 生成结果无效（文件过小或不是 ArrayBuffer）');
  }

  return {
    buffer,
    bytes: new Uint8Array(buffer),
    fileName: options.fileName || buildFileName(deck),
    warnings,
    stats: {
      pages: slides.length,
      layouts: [...layoutsUsed],
      themeName: theme.name,
      font: theme.font,
      titleSize: theme.sizes.title,
      bodySize: theme.sizes.body,
      dark: theme.dark,
      slideSizeInches: [SLIDE_W, SLIDE_H],
      supportedLayouts: SUPPORTED_LAYOUTS.length,
      vendorVersion: PPTX_VENDOR_VERSION,
    },
  };
}
