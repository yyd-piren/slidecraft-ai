/**
 * AnnaAIProvider（阶段 4）—— 应用中唯一调用 anna.llm.complete 的地方。
 *
 * 依据（已核实）：
 * - 官方文档 reference/host-api-llm.md：llm.complete({messages, maxTokens, temperature, systemPrompt, ...}, opts?)
 * - 平台 SDK 0.27.0 源码：`rt.call("llm","complete",args,opts)` → `pending.resolve(msg.result)`，
 *   返回值就是结果对象本身，不再解包 {result}；错误 reject 一个带 err.code 的 Error。
 * - methods.json（dispatcher 0.33.0）：llm.complete / llm.catalog 均 stub:false。
 *
 * 硬性约束：
 * - 业务层 / UI 不接触 SDK；本模块只把 anna 作为构造参数注入。
 * - 所有调用串行（禁止并行 LLM 请求）、零自动重试。
 * - maxCalls 默认 Infinity（不限次数）；仅在用户显式设置 aiMaxCalls 时作为可选保护上限。
 * - 失败一律抛出 AiError，绝不静默退回 Mock、绝不伪装成功。
 * - 每次真实调用都留下可核查记录：model / usage / _meta.quotaConsumed（失败时为 null，不虚构 CU）。
 */
import { PROMPT_BUILDERS, SLIDES_BATCH_SIZE } from './prompts.js';
import {
  parseOutlineResult, parseSlidesResult, parseSlidePatchResult,
  parseNewSlideResult, parseThemeResult, buildFallbackSlides,
} from './parser.js';
import { AiError, AI_ERROR_CODES, toAiError } from './errors.js';

function withTimeout(promise, ms) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new AiError(AI_ERROR_CODES.TIMEOUT, 'AI 请求超时，原有内容已保留，请稍后重试。')), ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function usageOf(result) {
  const u = result?.usage || {};
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  return { inputTokens: num(u.inputTokens), outputTokens: num(u.outputTokens), totalTokens: num(u.totalTokens) };
}

export function createAnnaProvider({
  anna,
  maxCalls = Infinity,
  timeoutMs = 100000,
  onCall = null,
  modelName = '',
} = {}) {
  if (!anna || typeof anna?.llm?.complete !== 'function') {
    throw new AiError(AI_ERROR_CODES.NO_HOST, '当前环境没有可用的 Anna AI 能力（未连接宿主）。');
  }

  let callCount = 0;
  let queue = Promise.resolve();
  const records = [];
  // 已实测：modelPreferences.hints 必须是 [{name}]; 形如 {hints:{name}} 会被平台忽略。
  let selectedModel = String(modelName || '').trim();

  /** 取走并清空本轮真实调用记录，供 adapter 写日志。 */
  function drainCallRecords() {
    return records.splice(0, records.length);
  }

  async function doComplete(task, prompt, extra = {}) {
    if (callCount >= maxCalls) {
      throw new AiError(
        AI_ERROR_CODES.CALL_LIMIT,
        '已达本阶段真实 AI 调用上限，请检查上次调用结果后再继续。原有内容已保留。',
        { maxCalls, callCount },
      );
    }
    callCount += 1;
    const started = Date.now();
    let result = null;
    let error = null;
    try {
      // SDK 第二参数 opts.timeoutMs 是官方支持的单次超时；外层 race 再兜一层，
      // 避免宿主未实现 opts 时请求永久挂起。
      result = await withTimeout(
        anna.llm.complete(
          {
            messages: prompt.messages,
            maxTokens: prompt.maxTokens,
            temperature: prompt.temperature,
            systemPrompt: prompt.systemPrompt,
            // 用户在顶栏选择的模型；留空则完全交由平台按账户偏好路由。
            ...(selectedModel ? { modelPreferences: { hints: [{ name: selectedModel }] } } : {}),
          },
          { timeoutMs },
        ),
        timeoutMs + 10000,
      );
    } catch (e) {
      error = toAiError(e);
    }

    const meta = result?._meta || {};
    const record = {
      task,
      batch: extra.batch || null,
      at: started,
      durationMs: Date.now() - started,
      ok: !error,
      errorCode: error?.code || null,
      model: error ? null : (result?.model ?? null),
      provider: error ? null : (meta.provider ?? null),
      stopReason: error ? null : (result?.stopReason ?? null),
      usage: error ? null : usageOf(result),
      // 只有 SDK 明确返回时才记录；失败一律 null，绝不虚构 CU 数值。
      quotaConsumed: !error && Number.isFinite(Number(meta.quotaConsumed)) ? Number(meta.quotaConsumed) : null,
      maxTokensEcho: !error && meta.maxTokens ? meta.maxTokens : null,
      requestedMaxTokens: prompt.maxTokens,
      requestedModel: selectedModel || null,
      possiblyTruncated: !error && result?.stopReason === 'maxTokens',
    };
    records.push(record);
    if (typeof onCall === 'function') {
      try { onCall(record); } catch { /* 观察回调不能影响主流程 */ }
    }
    if (error) throw error;
    return result;
  }

  /** 串行闸门：任何时刻最多一个 llm.complete 在飞；不重试。 */
  function complete(task, prompt, extra) {
    const job = queue.then(() => doComplete(task, prompt, extra));
    queue = job.catch(() => {});
    return job;
  }

  function mergeRepairs(target, summary) {
    if (Array.isArray(summary?.repairs)) target.push(...summary.repairs);
  }

  /**
   * 统一解析入口：LLM 返回格式异常时，把脱敏的原文片段写进调用记录，
   * 让日志能直接回答「是截断还是格式错误」，同时仍只把可读文案展示给用户。
   */
  async function runParsed(task, prompt, parseFn, extra) {
    const result = await complete(task, prompt, extra);
    try {
      return parseFn(result);
    } catch (e) {
      const err = toAiError(e);
      const rec = records[records.length - 1];
      if (rec) {
        const t = String(result?.content?.text ?? '');
        rec.parseError = {
          code: err.code,
          message: err.userMessage,
          outputChars: t.length,
          head: t.slice(0, 160),
          tail: t.slice(-200),
          stopReason: result?.stopReason ?? null,
          possiblyTruncated: result?.stopReason === 'maxTokens' || !!err.details?.truncated,
        };
      }
      throw err;
    }
  }

  return {
    id: 'anna',
    drainCallRecords,
    get callCount() { return callCount; },
    get maxCalls() { return maxCalls; },
    getModel: () => selectedModel,
    setModel(name) { selectedModel = String(name || '').trim(); },

    /** 可选：能力发现 / 余额查询。不会自动调用，也不计入 LLM 生成次数。 */
    async getQuota() {
      if (typeof anna.llm?.catalog !== 'function') return null;
      const job = queue.then(async () => {
        try {
          const r = await withTimeout(anna.llm.catalog({}), 20000);
          return { remainingCU: r?.quota?.remainingCU ?? null, modelCount: Array.isArray(r?.models) ? r.models.length : null };
        } catch (e) {
          throw toAiError(e);
        }
      });
      queue = job.catch(() => {});
      return job;
    },

    /**
     * 模型目录 + 剩余 CU：只保留 serviceTypes 含 text 的模型供下拉。
     * 这是能力发现 RPC，不产生推理、不扣 CU；失败时返回 error 字段而非抛错，
     * 保证 --no-llm / 网络异常时 UI 也能优雅降级。不走串行队列，避免阻塞生成。
     */
    async getCatalog() {
      const empty = { models: [], remainingCU: null, at: Date.now(), error: null };
      if (typeof anna.llm?.catalog !== 'function') {
        return { ...empty, error: '当前环境不支持模型目录' };
      }
      try {
        const r = await withTimeout(anna.llm.catalog({}), 20000);
        const models = (Array.isArray(r?.models) ? r.models : [])
          .filter((m) => m && Array.isArray(m.serviceTypes) && m.serviceTypes.includes('text'))
          .map((m) => ({
            name: String(m.modelName || ''),
            display: String(m.displayName || m.modelName || ''),
            preferred: !!m.isUserPreferred,
            platformDefault: !!m.isPlatformDefault,
          }))
          .filter((m) => m.name);
        return {
          models,
          remainingCU: Number.isFinite(Number(r?.quota?.remainingCU)) ? Number(r.quota.remainingCU) : null,
          at: Date.now(),
          error: null,
        };
      } catch (e) {
        return { ...empty, error: String(e?.message || e) };
      }
    },

    // 1. 大纲生成
    async generateOutline({ meta = {} } = {}) {
      const prompt = PROMPT_BUILDERS.generateOutline({ meta });
      return runParsed('generate_outline', prompt,
        (r) => parseOutlineResult(r, { pageCount: meta.pageCount, meta }));
    },

    // 2. 逐页内容生成：按大纲分批、串行，控制单次输入输出长度与 CU。
    async generateSlides({ meta = {}, outline = [], existingSlides = [] } = {}) {
      if (!outline.length) throw new AiError(AI_ERROR_CODES.INVALID_REQUEST, '没有可生成内容的大纲。');
      const batches = chunk(outline, SLIDES_BATCH_SIZE);
      const slides = [];
      const repairs = [];
      const warnings = [];
      for (let i = 0; i < batches.length; i += 1) {
        const batch = batches[i];
        const prompt = PROMPT_BUILDERS.generateSlides({ meta, outline, batch, existingSlides });
        // allowPartial：允许模型输出被截断时保留已完整生成的页，缺页用大纲本地兜底。
        // 这样「一次长输出被截断」不会让整份 PPT 生成失败，也不会静默丢内容。
        const parsed = await runParsed('generate_slides', prompt,
          (r) => parseSlidesResult(r, { batch, allowPartial: true }),
          { batch: { index: i + 1, total: batches.length } });
        mergeRepairs(repairs, parsed.summary);
        slides.push(...parsed.slides);
        const missing = parsed.summary.missing || [];
        if (missing.length) {
          const from = slides.length + 1;
          slides.push(...buildFallbackSlides(missing, slides.length, outline.length));
          const msg = `第 ${from}–${from + missing.length - 1} 页因模型输出截断，已按大纲自动生成占位内容，可单独「重新生成页面」补全`;
          warnings.push({ type: 'truncated', message: msg, batch: i + 1 });
        }
      }
      return {
        slides,
        summary: {
          pages: slides.length, batches: batches.length, repairs, warnings,
          localRepairCount: repairs.length, truncatedCount: warnings.length, source: 'anna',
        },
      };
    },

    // 3. 重新生成单页
    async regenerateSlide(ctx = {}) {
      const prompt = PROMPT_BUILDERS.regenerateSlide(ctx);
      return runParsed('regenerate_slide', prompt,
        (r) => parseSlidePatchResult(r, { slide: ctx.slide }));
    },

    // 4. 自然语言修改单页（只返回 patch，id 由业务层按 slide.id 保留）
    async editSlideByInstruction(ctx = {}) {
      const prompt = PROMPT_BUILDERS.editSlideByInstruction(ctx);
      return runParsed('edit_slide_by_instruction', prompt,
        (r) => parseSlidePatchResult(r, { slide: ctx.slide }));
    },

    // 5. 自然语言新增页面
    async createSlideByInstruction(ctx = {}) {
      const prompt = PROMPT_BUILDERS.createSlideByInstruction(ctx);
      return runParsed('create_slide_by_instruction', prompt,
        (r) => parseNewSlideResult(r, { instruction: ctx.instruction }));
    },

    // 6. 自然语言修改全局主题
    async generateThemeByInstruction(ctx = {}) {
      const prompt = PROMPT_BUILDERS.generateThemeByInstruction(ctx);
      return runParsed('generate_theme_by_instruction', prompt,
        (r) => parseThemeResult(r, { currentTheme: ctx.currentTheme }));
    },

    // 7. 只切换布局（严格限制可写字段，原文不丢）
    async changeSlideLayout(ctx = {}) {
      const prompt = PROMPT_BUILDERS.changeSlideLayout(ctx);
      return runParsed('change_slide_layout', prompt,
        (r) => parseSlidePatchResult(r, {
          slide: ctx.slide,
          allowedFields: ['type', 'layout', 'elements', 'visualHint', 'design'],
        }));
    },
  };
}
