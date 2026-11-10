/**
 * Anna Runtime 接入层。
 *
 * 已核实的平台事实（阶段 1 调研）：
 * - SDK 入口：/static/anna-apps/_sdk/latest/index.js，AnnaAppRuntime.connect() 完成握手。
 * - storage.get({key}) → {value, exists}；storage.set({key, value}) → {etag,...}。
 * - 所有 Host API 调用走 postMessage → Host Bridge → /api/v1/anna-apps/runtime/rpc。
 *
 * 独立预览（没有宿主，例如直接打开静态服务器）时自动降级为 localStorage，
 * 这样同一份 bundle 既能被 Anna harness 加载，也能离线做 UI 测试。
 * 阶段 2 不会发起任何 llm.* / upload.* 调用。
 */

const SDK_URL = '/static/anna-apps/_sdk/latest/index.js';

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label}超时（${ms}ms）`)), ms)),
  ]);
}

function readLocal(key) {
  try {
    return JSON.parse(window.localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

function writeLocal(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 隐私模式 / 配额不足时静默，宿主存储仍可用 */
  }
}

function createStorage(kind, anna) {
  return {
    kind,
    lastError: null,
    /** 优先宿主 APS；宿主 miss / 不可用 / 读取失败时回落到本地镜像，保证刷新后仍能恢复草稿。 */
    async getJSON(key) {
      if (kind === 'host') {
        try {
          const r = await anna.storage.get({ key });
          // 生产 APS 返回 {value, exists:true}；本地 harness 的 legacy runtime_state
          // 只返回 {value}（无 exists）。两种结构都要能命中，否则会误判为「无草稿」。
          if (r && r.exists !== false && r.value !== undefined && r.value !== null) return r.value;
        } catch (e) {
          this.lastError = e?.message || String(e);
        }
      }
      return readLocal(key);
    },
    async setJSON(key, value) {
      try {
        if (kind === 'host') await anna.storage.set({ key, value });
      } catch (e) {
        this.lastError = e?.message || String(e);
        throw e;
      } finally {
        // 本地镜像仅作为宿主短暂不可用时的兜底，不参与 AI 调用。
        writeLocal(key, value);
      }
    },
  };
}

export async function connectPlatform() {
  let anna = null;
  let reason = '';
  try {
    const mod = await withTimeout(import(SDK_URL), 2500, 'SDK 加载');
    if (!mod || typeof mod.AnnaAppRuntime?.connect !== 'function') {
      throw new Error('SDK 中未找到 AnnaAppRuntime.connect');
    }
    anna = await withTimeout(mod.AnnaAppRuntime.connect(), 2500, '宿主握手');
  } catch (e) {
    reason = e?.message || String(e);
  }

  const kind = anna ? 'host' : 'standalone';
  const storage = createStorage(kind, anna);

  return {
    kind,
    reason,
    storage,
    anna,
    async setTitle(title) {
      if (kind !== 'host') return;
      try {
        await anna.window.set_title({ title });
      } catch {
        /* 标题更新失败不影响主流程 */
      }
    },
  };
}
