/**
 * AI 适配器 —— 业务层唯一入口。
 *
 * 契约（Mock 与真实 AI 完全一致，七个业务方法均不是 Anna 平台 API）：
 *   generateOutline({meta})                        → {outline}
 *   generateSlides({meta, outline, existingSlides})→ {slides}
 *   regenerateSlide({meta, slide, outlineItem})    → {patch}
 *   editSlideByInstruction({instruction, slide, meta, theme, prevSlide, nextSlide, outlineItem}) → {patch}
 *   createSlideByInstruction({instruction, meta, theme, prevSlide, nextSlide})                  → {slide, outlineItem}
 *   generateThemeByInstruction({instruction, currentTheme})                                     → {theme}
 *   changeSlideLayout({slide, layout, instruction})                                             → {patch}
 *
 * 阶段 2 / 2.5 只注入 mockProvider；本文件与 bundle 中其余代码均不包含任何真实 AI 调用，
 * 因此页面加载、热更新、刷新、普通编辑都不可能产生 CU 消耗。
 * 阶段 4 只需注入实现同样七个方法的 realProvider（内部使用 anna.llm.complete），
 * UI 与 core/actions.js 无需改动。
 */
import { mockProvider } from './mock.js';

function lengthOf(value) {
  try {
    return JSON.stringify(value ?? null).length;
  } catch {
    return 0;
  }
}

function previewOf(value, limit = 140) {
  try {
    const s = JSON.stringify(value ?? null);
    return s.length > limit ? `${s.slice(0, limit)}…` : s;
  } catch {
    return '';
  }
}

export function createAiAdapter({ mode = 'mock', provider = null, logbook = null } = {}) {
  const impl = provider || (mode === 'mock' ? mockProvider : null);
  if (!impl) throw new Error(`AI 模式「${mode}」的 provider 尚未实现（阶段 4 接入）`);

  async function call(action, input, fn) {
    const started = Date.now();
    const entry = {
      mode: impl.id || mode,
      action,
      model: null,
      quotaConsumed: 0,
      inputChars: lengthOf(input),
      inputPreview: previewOf(input),
      outputChars: 0,
      outputPreview: '',
      status: 'running',
      error: null,
      note: impl.id === 'mock' ? '演示数据，未调用 Anna AI' : '',
    };
    try {
      const out = await fn();
      entry.status = 'ok';
      entry.outputChars = lengthOf(out);
      entry.outputPreview = previewOf(out);
      return out;
    } catch (e) {
      entry.status = 'error';
      entry.error = String(e?.message || e);
      throw e;
    } finally {
      entry.durationMs = Date.now() - started;
      // fire-and-forget：日志写失败不影响主流程。
      Promise.resolve(logbook?.write(entry)).catch(() => {});
    }
  }

  return {
    mode: impl.id || mode,
    generateOutline: (ctx) => call('generate_outline', ctx, () => impl.generateOutline(ctx)),
    generateSlides: (ctx) => call('generate_slides', ctx, () => impl.generateSlides(ctx)),
    regenerateSlide: (ctx) => call('regenerate_slide', ctx, () => impl.regenerateSlide(ctx)),
    editSlideByInstruction: (ctx) => call('edit_slide_by_instruction', ctx, () => impl.editSlideByInstruction(ctx)),
    createSlideByInstruction: (ctx) => call('create_slide_by_instruction', ctx, () => impl.createSlideByInstruction(ctx)),
    generateThemeByInstruction: (ctx) => call('generate_theme_by_instruction', ctx, () => impl.generateThemeByInstruction(ctx)),
    changeSlideLayout: (ctx) => call('change_slide_layout', ctx, () => impl.changeSlideLayout(ctx)),
  };
}
