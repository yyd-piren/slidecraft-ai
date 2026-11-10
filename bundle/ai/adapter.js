/**
 * AI 适配器 —— 业务层唯一入口（阶段 4 升级）。
 *
 * 七个业务方法与 Mock / Anna Provider 完全一致，且都不是 Anna 平台 API：
 *   generateOutline / generateSlides / regenerateSlide / editSlideByInstruction /
 *   createSlideByInstruction / generateThemeByInstruction / changeSlideLayout
 *
 * 模式选择：
 *   - 生产环境（非 localhost）默认使用真实 AnnaAIProvider。
 *   - 本地 dev / 独立预览默认 Mock（配合 anna-app dev --no-llm，零 CU）。
 *   - URL 参数 ?ai=mock 强制 Mock，?ai=anna（或 ?aiReal=1）显式启用真实 Provider。
 *   - 真实模式失败时抛 AiError，绝不静默退回 Mock、绝不伪装成功。
 *
 * 日志：每次业务调用写一条，包含任务类型、输入/输出长度、状态、错误码；
 * 真实 Provider 额外附上每次 llm.complete 的 model / usage / _meta.quotaConsumed。
 * 日志永不记录 API Key、Token、PAT 或任何凭据。
 */
import { mockProvider } from './mock.js';
import { createAnnaProvider } from './anna-provider.js';
import { toAiError } from './errors.js';

const AI_METHODS = [
  'generateOutline', 'generateSlides', 'regenerateSlide', 'editSlideByInstruction',
  'createSlideByInstruction', 'generateThemeByInstruction', 'changeSlideLayout',
];

/**
 * 纯函数，便于单测；不直接读全局 location。
 *
 * parentSearch：Anna dev harness 的 dashboard 会自己生成 iframe URL（wid/t/theme…），
 * 应用无法直接在自己的 URL 上带业务参数。iframe 与 dashboard 同源，
 * 因此把父页面查询参数一并纳入判断：打开 `http://localhost:5180/?aiReal=1`
 * 即可让整个会话稳定处于真实 AI 模式，切换 form factor / 刷新都不会丢。
 *
 * 优先级：显式 URL 参数 > force（持久开关，可选）> 环境默认（生产 anna / 本地 mock）。
 */
export function resolveAiMode({ hostname = '', search = '', parentSearch = '', force = null } = {}) {
  let params;
  try {
    const raw = [search, parentSearch]
      .filter(Boolean)
      .map((s) => String(s).replace(/^\?/, ''))
      .join('&');
    params = new URLSearchParams(raw);
  } catch { params = new URLSearchParams(); }
  const q = (params.get('ai') || '').toLowerCase();
  if (q === 'mock') return 'mock';
  if (q === 'anna' || q === 'real' || params.has('aiReal')) return 'anna';
  if (force === 'mock' || force === 'anna') return force;
  const local = ['localhost', '127.0.0.1', '0.0.0.0', ''].includes(String(hostname).toLowerCase());
  return local ? 'mock' : 'anna';
}

function lengthOf(value) {
  try { return JSON.stringify(value ?? null).length; } catch { return 0; }
}
function previewOf(value, limit = 140) {
  try {
    const s = JSON.stringify(value ?? null);
    return s.length > limit ? `${s.slice(0, limit)}…` : s;
  } catch { return ''; }
}

export function createAiAdapter({
  mode = 'mock',
  provider = null,
  logbook = null,
  anna = null,
  maxCalls = Infinity,
  timeoutMs = 100000,
  onCall = null,
  modelName = '',
} = {}) {
  const impl = provider || (mode === 'anna'
    ? createAnnaProvider({ anna, maxCalls, timeoutMs, onCall, modelName })
    : mockProvider);
  if (!impl) throw new Error(`AI 模式「${mode}」的 provider 尚未实现`);

  async function call(action, input, fn) {
    const started = Date.now();
    const entry = {
      mode: impl.id || mode,
      action,
      model: null,
      provider: null,
      usage: null,
      quotaConsumed: 0,
      quotaConsumedKnown: impl.id !== 'anna',
      realCallCount: 0,
      llmCalls: [],
      inputChars: lengthOf(input),
      inputPreview: previewOf(input),
      outputChars: 0,
      outputPreview: '',
      status: 'running',
      error: null,
      errorCode: null,
      note: impl.id === 'mock' ? '演示数据，未调用 Anna AI' : '真实 Anna AI 调用',
    };
    try {
      const out = await fn();
      entry.status = 'ok';
      entry.outputChars = lengthOf(out);
      entry.outputPreview = previewOf(out);
      return out;
    } catch (e) {
      const err = toAiError(e);
      entry.status = 'error';
      entry.error = err.userMessage;
      entry.errorCode = err.code;
      throw err;
    } finally {
      entry.durationMs = Date.now() - started;
      // 取走本次业务调用产生的所有真实 LLM 记录，逐条落盘供核查。
      if (typeof impl.drainCallRecords === 'function') {
        const recs = impl.drainCallRecords();
        if (recs.length) {
          entry.realCallCount = recs.length;
          entry.llmCalls = recs.map((r) => ({
            task: r.task, batch: r.batch, at: r.at, durationMs: r.durationMs,
            model: r.model, provider: r.provider, stopReason: r.stopReason,
            usage: r.usage, quotaConsumed: r.quotaConsumed,
            requestedMaxTokens: r.requestedMaxTokens,
            requestedModel: r.requestedModel ?? null,
            possiblyTruncated: !!r.possiblyTruncated,
            parseError: r.parseError ?? null,
            ok: r.ok, errorCode: r.errorCode,
          }));
          entry.model = recs.find((r) => r.model)?.model ?? null;
          entry.provider = recs.find((r) => r.provider)?.provider ?? null;
          const sums = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
          let cu = 0;
          let known = false;
          for (const r of recs) {
            if (r.usage) {
              sums.inputTokens += r.usage.inputTokens ?? 0;
              sums.outputTokens += r.usage.outputTokens ?? 0;
              sums.totalTokens += r.usage.totalTokens ?? 0;
            }
            if (r.quotaConsumed !== null && r.quotaConsumed !== undefined) { cu += r.quotaConsumed; known = true; }
          }
          entry.usage = recs.some((r) => r.usage) ? sums : null;
          // 失败时 SDK 没有返回 quotaConsumed → 保持 0 且标记「未知」，绝不虚构数值。
          entry.quotaConsumed = cu;
          entry.quotaConsumedKnown = known;
          entry.note = `真实 Anna AI · ${recs.length} 次 llm.complete`;
        }
      }
      // fire-and-forget：日志写失败不影响主流程。
      Promise.resolve(logbook?.write(entry)).catch(() => {});
    }
  }

  const adapter = { mode: impl.id || mode };
  for (const name of AI_METHODS) {
    if (typeof impl[name] !== 'function') throw new Error(`Provider 缺少业务方法：${name}`);
    adapter[name] = (ctx) => call(name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), ctx, () => impl[name](ctx));
  }
  adapter.getQuota = typeof impl.getQuota === 'function' ? () => impl.getQuota() : async () => null;
  adapter.getCatalog = typeof impl.getCatalog === 'function'
    ? () => impl.getCatalog()
    : async () => ({ models: [], remainingCU: null, at: Date.now(), error: '演示模式无模型目录' });
  adapter.setModel = (name) => { if (typeof impl.setModel === 'function') impl.setModel(name); };
  adapter.getModel = () => (typeof impl.getModel === 'function' ? impl.getModel() : '');
  adapter.provider = impl;
  return adapter;
}
