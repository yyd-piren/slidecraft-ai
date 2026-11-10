/**
 * Export Adapter —— 文件输出层（阶段 3）。
 *
 * 与 PPTX 渲染完全解耦：渲染只产出 ArrayBuffer/Uint8Array，本模块只负责把它变成本地下载。
 * 阶段 5 接入 Anna 平台上传时，在这里新增 upload({bytes,fileName,anna}) 实现
 * （对应 anna.upload.inline），UI 与渲染器都无需改动。
 */
import { PPTX_MIME } from './pptx-engine.js';

export const createExportAdapter = () => ({
  id: 'browser-download',
  mime: PPTX_MIME,

  toBlob(bytes) {
    return new Blob([bytes], { type: PPTX_MIME });
  },

  /** 供未来 upload.inline 使用：Uint8Array → base64（本阶段不调用平台）。 */
  toBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    }
    return btoa(binary);
  },

  /** 本地浏览器下载：真实的 <a download> + Blob URL。 */
  async download({ bytes, fileName }) {
    if (!bytes || !bytes.length) throw new Error('没有可下载的文件数据');
    const blob = this.toBlob(bytes);
    // 本地开发/无头测试钩子：暴露下载用的同一份字节，便于自动化验证文件内容。
    // Staging / 生产域名下不存在，也不写入任何持久化存储。
    if (typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(location.hostname)) {
      window.__SLIDECRAFT_LAST_DOWNLOAD__ = { fileName, mime: PPTX_MIME, bytes: bytes.slice() };
    }
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.rel = 'noopener';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      // 给浏览器留出开始下载的时间再释放 URL。
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
    return { downloaded: true, size: bytes.length, mime: PPTX_MIME, fileName };
  },
});
