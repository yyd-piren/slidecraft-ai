/**
 * 导出管线。
 *
 * 阶段 2：只打通「导出入口 → 进度反馈 → 明确结果」这条交互链路，
 *         刻意不生成文件、不调用 upload.inline，也绝不显示「导出成功」。
 * 阶段 3：在此接入 PptxGenJS（须打包进 bundle，默认 CSP 禁止外部 CDN 脚本）
 *         → 生成可编辑 .pptx → ArrayBuffer 转 base64 → anna.upload.inline 上传 → 下载入口。
 */
import { getTheme } from '../render/themes.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function suggestedFilename(deck) {
  const raw = String(deck?.meta?.topic || 'SlideCraft 演示文稿')
    .replace(/[\\/:*?"<>|\r\n]/g, '')
    .trim()
    .slice(0, 40);
  return `${raw || 'SlideCraft 演示文稿'}.pptx`;
}

const STEPS = [
  { stage: '整理页面数据与结构', percent: 20 },
  { stage: '校验主题与六种布局', percent: 45 },
  { stage: '准备 PPTX 渲染管线（阶段 3 接入）', percent: 72 },
  { stage: '汇总导出结果', percent: 100 },
];

export async function runMockExport({ deck, onProgress = () => {} }) {
  const steps = [];
  for (const step of STEPS) {
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
