/**
 * 导出业务编排（阶段 3）。
 *
 * - runRealExport：最终产品使用的真实导出（校验 → renderDeckToPptx → Export Adapter 下载）。
 * - runMockExport：阶段 2 的交互桩，仅保留用于历史回归测试与兼容，UI / actions 已不再调用。
 *
 * 渲染逻辑在 render/pptx-*，文件输出在 render/pptx-export.js；本文件只做流程编排与进度反馈。
 */
import { getTheme } from '../render/themes.js';
import { renderDeckToPptx, buildFileName } from '../render/pptx-engine.js';
import { createExportAdapter } from '../render/pptx-export.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function suggestedFilename(deck) {
  const raw = String(deck?.meta?.topic || 'SlideCraft 演示文稿')
    .replace(/[\\/:*?"<>|\r\n]/g, '')
    .trim()
    .slice(0, 40);
  return `${raw || 'SlideCraft 演示文稿'}.pptx`;
}

const MOCK_STEPS = [
  { stage: '整理页面数据与结构', percent: 20 },
  { stage: '校验主题与六种布局', percent: 45 },
  { stage: '准备 PPTX 渲染管线（阶段 3 接入）', percent: 72 },
  { stage: '汇总导出结果', percent: 100 },
];

/**
 * @deprecated 阶段 2 遗留的 Mock 导出桩，仅用于回归测试；最终导出请使用 runRealExport。
 */
export async function runMockExport({ deck, onProgress = () => {} }) {
  const steps = [];
  for (const step of MOCK_STEPS) {
    steps.push(step.stage);
    onProgress({ stage: step.stage, percent: step.percent, steps: [...steps], result: null });
    await sleep(300);
  }
  return {
    ready: false,
    mode: 'mock',
    filename: suggestedFilename(deck),
    pages: deck.slides.length,
    theme: getTheme(deck.theme).name,
    layouts: [...new Set(deck.slides.map((s) => s.layout))],
    message: '演示模式：本次没有生成真实文件，也不提供下载。阶段 3 将接入 PptxGenJS 与 anna.upload.inline。',
  };
}

/** 真实导出：Deck 是唯一数据来源，Theme 是唯一主题来源。 */
export async function runRealExport({ deck, onProgress = () => {}, adapter = createExportAdapter() }) {
  const steps = [];
  const step = (stage, percent) => {
    steps.push(stage);
    onProgress({ stage, percent, steps: [...steps], result: null, error: null });
  };

  step('校验 Deck 数据、主题与页面元素', 15);
  step('映射 Theme JSON 与页面布局', 32);
  step('生成原生可编辑 PPTX（文本框 / 形状 / 连线 / 图表）', 58);
  const rendered = await renderDeckToPptx(deck, { fileName: buildFileName(deck) });

  step('准备本地下载', 88);
  const download = await adapter.download({ bytes: rendered.bytes, fileName: rendered.fileName });
  step('导出完成', 100);

  return {
    ready: true,
    mode: 'real',
    fileName: rendered.fileName,
    size: rendered.bytes.length,
    downloaded: download.downloaded,
    pages: rendered.stats.pages,
    theme: rendered.stats.themeName,
    layouts: rendered.stats.layouts,
    warnings: rendered.warnings,
    stats: rendered.stats,
    message: `已生成真实 .pptx 文件（${rendered.bytes.length} 字节）并触发浏览器下载。`,
  };
}
