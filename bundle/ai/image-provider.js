/**
 * Anna 平台原生图片生成接入（阶段 4 细节增强）。
 *
 * 官方依据：developers/reference/host-api-image.md
 *   anna.image.generate({prompt, n?, size?, ...}, {timeoutMs})
 *     → {images:[{url, ...}], model, quota_used, latency_ms}
 *   images[].url 为约 30 分钟 TTL 的 R2 预签名地址，不可长期保存。
 *   CSP 需允许 https 图片与连接：csp_overrides['img-src'] / ['connect-src']。
 *
 * 因此本模块立刻把图片取回并转成 data URL 存进 Deck，
 * 导出时用 PptxGenJS 原生 addImage 插入独立图片对象（可选中/缩放/替换），
 * 不是整页截图，也不会因 URL 过期导致 PPT 丢失配图。
 */
import { AiError, AI_ERROR_CODES, toAiError } from './errors.js';
import { iconSvg, svgToDataUri } from '../core/decorations.js';

/** 不同 provider 返回的计费用字段名不完全一致；取不到就记 null，绝不虚构 CU。 */
function imageQuota(result) {
  const v = result?.quota_used ?? result?.quotaConsumed ?? result?.quota_consumed
    ?? result?.billedCostCU ?? result?.cost;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    if (typeof FileReader === 'undefined') {
      reject(new AiError(AI_ERROR_CODES.PROVIDER_ERROR, '当前环境无法读取图片数据，已取消插入配图。'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new AiError(AI_ERROR_CODES.PROVIDER_ERROR, '图片数据读取失败，原有页面内容已保留。'));
    reader.readAsDataURL(blob);
  });
}

async function fetchImageAsDataUrl(url) {
  let res;
  try {
    res = await fetch(url, { mode: 'cors', credentials: 'omit' });
  } catch (e) {
    throw new AiError(
      AI_ERROR_CODES.PROVIDER_ERROR,
      '图片已生成，但沙箱不允许读取远程图片（CSP 限制）。请检查应用 csp_overrides 后重试，原有页面已保留。',
      { reason: String(e?.message || e) },
    );
  }
  if (!res.ok) {
    throw new AiError(AI_ERROR_CODES.PROVIDER_ERROR, `图片下载失败（HTTP ${res.status}），原有页面已保留。`);
  }
  const blob = await res.blob();
  if (!blob || !blob.size) throw new AiError(AI_ERROR_CODES.INVALID_OUTPUT, '图片内容为空，已取消插入。');
  const data = await blobToDataUrl(blob);
  if (!data.startsWith('data:image/')) throw new AiError(AI_ERROR_CODES.INVALID_OUTPUT, '返回的不是可用图片，已取消插入。');
  return data;
}

/**
 * 真实 Provider。业务层/UI 不接触 anna.image.*，只调用 generate()。
 * 每次调用都是用户显式点击触发；无自动重试、无并行、无页面加载时调用。
 */
export function createImageProvider({ anna, timeoutMs = 120000, onCall = null } = {}) {
  return {
    id: 'anna-image',
    get available() { return typeof anna?.image?.generate === 'function'; },

    // 实测：1024x1024 单次约 69 CU；512x512 对 PPT 内 3–4 英寸的配图已足够清晰，
    // 且按平台分辨率档位计费更低。默认取小尺寸，避免用户点一次就烧掉大量额度。
    async generate({ prompt, size = '512x512' } = {}) {
      const text = String(prompt || '').trim();
      if (!text) throw new AiError(AI_ERROR_CODES.INVALID_REQUEST, '请先描述想要生成的配图内容。');
      if (!this.available) {
        throw new AiError(AI_ERROR_CODES.NO_HOST, '当前环境没有 Anna 图片生成能力（未连接宿主或平台版本不支持）。');
      }
      const started = Date.now();
      let result;
      try {
        result = await anna.image.generate(
          { prompt: text, n: 1, size },
          { timeoutMs },
        );
      } catch (e) {
        const err = toAiError(e);
        if (onCall) onCall({ ok: false, task: 'generate_image', model: null, quotaUsed: null, errorCode: err.code, at: started });
        throw err;
      }
      const url = result?.images?.[0]?.url;
      if (!url) {
        const err = new AiError(AI_ERROR_CODES.INVALID_OUTPUT, 'Anna 未返回可用图片，原有页面已保留。');
        if (onCall) onCall({ ok: false, task: 'generate_image', errorCode: err.code, at: started });
        throw err;
      }
      let dataUrl;
      try {
        dataUrl = await fetchImageAsDataUrl(url);
      } catch (e) {
        if (onCall) onCall({ ok: false, task: 'generate_image', model: result?.model, quotaUsed: imageQuota(result), errorCode: e.code, at: started });
        throw e;
      }
      const record = {
        ok: true, task: 'generate_image', model: result?.model || null,
        quotaUsed: imageQuota(result), latencyMs: Date.now() - started,
        bytes: dataUrl.length, at: started,
      };
      if (onCall) onCall(record);
      // 不返回也不持久化临时 URL：只保留已取回的字节。
      return { src: dataUrl, model: record.model, quotaUsed: record.quotaUsed };
    },
  };
}

/** 演示模式：零 CU、零网络，用内置矢量图标生成一张可见的占位配图。 */
export function createMockImageProvider() {
  return {
    id: 'mock-image',
    get available() { return true; },
    async generate({ prompt = '' } = {}) {
      await new Promise((r) => setTimeout(r, 260));
      const key = /数据|图|chart/i.test(prompt) ? 'data' : /团队|人|team/i.test(prompt) ? 'team' : 'idea';
      return { src: svgToDataUri(iconSvg(key)), model: 'mock', quotaUsed: 0, mock: true };
    },
  };
}
