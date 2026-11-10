/**
 * AI 错误分类（阶段 4）。
 *
 * 目的：把 Anna SDK 抛出的技术错误、本地解析/校验错误统一转成
 * 「用户可读、可分类、不含堆栈、不含凭据」的中文提示，供 UI 明确区分状态。
 * 业务层只认 code，不认 SDK 内部异常对象。
 */
export const AI_ERROR_CODES = {
  AI_DISABLED: 'AI_DISABLED',
  NOT_GRANTED: 'NOT_GRANTED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  INVALID_REQUEST: 'INVALID_REQUEST',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  TIMEOUT: 'TIMEOUT',
  CALL_LIMIT: 'CALL_LIMIT',
  INVALID_OUTPUT: 'INVALID_OUTPUT',
  NO_HOST: 'NO_HOST',
  UNKNOWN: 'UNKNOWN',
};

export class AiError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AiError';
    this.code = code;
    this.details = details || {};
    // userMessage 是 UI 唯一允许展示的文案；绝不包含堆栈、URL、令牌。
    this.userMessage = message;
  }
}

const SDK_CODE_MAP = {
  llm_disabled: [AI_ERROR_CODES.AI_DISABLED, '当前开发环境已禁用 Anna AI。请在 Anna 平台中打开应用，或切换到演示模式。'],
  APP_NOT_GRANTED: [AI_ERROR_CODES.NOT_GRANTED, '应用尚未安装或未开通订阅，暂时无法使用 Anna AI。'],
  APP_QUOTA_EXCEEDED: [AI_ERROR_CODES.QUOTA_EXCEEDED, 'Anna 额度不足，本次生成未执行。请检查剩余 CU 后再试。'],
  APP_INVALID_REQUEST: [AI_ERROR_CODES.INVALID_REQUEST, 'AI 请求参数不符合平台要求，请缩减输入内容后重试。'],
  APP_PROVIDER_ERROR: [AI_ERROR_CODES.PROVIDER_ERROR, 'Anna 模型服务暂时不可用，请稍后重试。'],
  APP_SESSION_EXPIRED: [AI_ERROR_CODES.SESSION_EXPIRED, 'AI 会话已过期，请重新打开应用后再试。'],
  APP_SESSION_TOKEN_EXPIRED: [AI_ERROR_CODES.SESSION_EXPIRED, 'AI 会话凭证已过期，请重新打开应用后再试。'],
  APP_MODEL_NOT_VISION_CAPABLE: [AI_ERROR_CODES.INVALID_REQUEST, '当前模型不支持该请求，请稍后重试。'],
  '-32601': [AI_ERROR_CODES.PROVIDER_ERROR, '当前平台版本不支持该 AI 能力。'],
};

/** 把任意异常收敛为 AiError；已是 AiError 的原样返回。 */
export function toAiError(e) {
  if (e instanceof AiError) return e;
  const code = String(e?.code ?? e?.name ?? '');
  const raw = String(e?.message || e || '');
  const hit = SDK_CODE_MAP[code];
  if (hit) return new AiError(hit[0], hit[1], { sdkCode: code });

  if (/timeout|timed out|超时|AbortError/i.test(raw) || /TimeoutError/i.test(code)) {
    return new AiError(AI_ERROR_CODES.TIMEOUT, 'AI 请求超时，原有内容已保留，请稍后重试。', { sdkCode: code });
  }
  if (/quota|额度|insufficient/i.test(raw)) {
    return new AiError(AI_ERROR_CODES.QUOTA_EXCEEDED, SDK_CODE_MAP.APP_QUOTA_EXCEEDED[1], { sdkCode: code });
  }
  if (/network|fetch|ECONN|offline/i.test(raw)) {
    return new AiError(AI_ERROR_CODES.PROVIDER_ERROR, '网络连接异常，Anna AI 暂时不可用，原有内容已保留。', { sdkCode: code });
  }
  // details 只进日志，UI 永远只展示 userMessage；截断摘要便于排障，不暴露堆栈或凭据。
  return new AiError(AI_ERROR_CODES.UNKNOWN, 'AI 生成失败，原有内容已保留。请稍后重试或切换到演示模式。', {
    sdkCode: code,
    reason: raw.replace(/(?:pat|token|api[_-]?key|secret)\s*[:=]\s*\S+/gi, '<redacted>').slice(0, 160),
  });
}

export function outputError(message, details = {}) {
  return new AiError(AI_ERROR_CODES.INVALID_OUTPUT, `AI 返回内容不符合要求：${message}。原有内容已保留。`, details);
}

/** UI 展示用的短文案，永不返回堆栈/原始异常文本。 */
export function readableAiError(e) {
  const err = toAiError(e);
  return err.userMessage;
}
