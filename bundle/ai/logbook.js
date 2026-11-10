/**
 * AI 调用日志：写入 anna.storage（独立预览时写 localStorage）。
 * 只记录用途、摘要、长度、模式、模型、quotaConsumed 与结果；不记录密钥、令牌或凭据。
 * 阶段 2 全部条目 mode='mock'、quotaConsumed=0；阶段 4 的真实调用沿用同一 schema。
 */
import { AI_LOG_KEY } from '../core/deck.js';

export function createLogbook(storage) {
  return {
    async read() {
      const list = await storage.getJSON(AI_LOG_KEY);
      return Array.isArray(list) ? list : [];
    },
    async write(entry) {
      // 日志写入失败不能影响生成主流程。
      try {
        const list = await this.read();
        const next = [...list, { ts: Date.now(), ...entry }].slice(-50);
        await storage.setJSON(AI_LOG_KEY, next);
      } catch (e) {
        console.warn('[SlideCraft] AI 调用日志写入失败：', e?.message || e);
      }
    },
  };
}
