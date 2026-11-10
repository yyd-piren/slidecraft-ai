/** 顶栏、浮层与通用表单控件。所有文案与状态都由 store 驱动。 */
import { esc } from '../render/layouts.js';
import {
  THEME_PRESETS, THEME_IDS, DECORATION_STYLES, LAYOUT_LABELS,
} from '../core/deck.js';
import { THEMES } from '../render/themes.js';
import { THEME_PROMPT_EXAMPLES } from '../ai/mock.js';

const STEPS = [
  { key: 'create', label: '创建任务' },
  { key: 'outline', label: '编辑大纲' },
  { key: 'workspace', label: '编辑与导出' },
];

const SAVE_LABEL = { idle: '本地草稿', saving: '正在保存…', saved: '已保存', error: '保存失败' };
const HOST_LABEL = { connecting: '连接中…', host: 'Anna 宿主', standalone: '独立预览' };

/** 阶段 4：错误分类标签，让用户一眼区分额度不足 / 超时 / 格式异常 / 服务异常。 */
export const AI_ERROR_LABEL = {
  AI_DISABLED: 'AI 已禁用', NOT_GRANTED: '未授权', QUOTA_EXCEEDED: '额度不足',
  INVALID_REQUEST: '请求无效', PROVIDER_ERROR: '服务异常', SESSION_EXPIRED: '会话过期',
  TIMEOUT: '请求超时', CALL_LIMIT: '调用上限', INVALID_OUTPUT: '返回格式异常',
  NO_HOST: '未连接宿主', UNKNOWN: '生成失败',
};

function aiModalBadge(state) {
  return state.aiMode === 'anna'
    ? '<span class="badge badge--ai">Anna AI</span>'
    : '<span class="badge badge--mock">演示模式</span>';
}

function aiBadgeText(state) {
  if (state.aiMode !== 'anna') return '演示模式 · 未接入 AI';
  const c = state.lastAiCall;
  if (c && Number.isFinite(c.limit) && c.used !== null && c.used !== undefined) {
    return `Anna AI · 剩 ${Math.max(0, c.limit - c.used)} 次`;
  }
  return 'Anna AI 已接入';
}

function aiBadgeTitle(state) {
  if (state.aiMode !== 'anna') return '当前使用本地演示数据，不会调用 Anna AI，也不会消耗 CU';
  const c = state.lastAiCall;
  const calls = c && Number.isFinite(c.limit)
    ? `本次会话 ${c.used ?? 0}/${c.limit} 次调用 · 剩 ${Math.max(0, c.limit - (c.used ?? 0))} 次`
    : '点击生成后才会调用 Anna AI';
  if (!c) return calls;
  return [
    calls, `任务 ${c.task || '—'}`, `模型 ${c.model || '—'}`,
    `输入/输出 ${c.usage?.inputTokens ?? '—'}/${c.usage?.outputTokens ?? '—'} tokens`,
    `实际消耗 ${c.quotaConsumed ?? '未返回'} CU`,
  ].join(' · ');
}

export function selectHTML(items, value, bind, cls = 'select') {
  return `<select class="${cls}" data-bind="${esc(bind)}">${items
    .map((it) => {
      const v = typeof it === 'string' ? it : it.value;
      const label = typeof it === 'string' ? it : it.label;
      return `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(label)}</option>`;
    })
    .join('')}</select>`;
}

/** 顶栏模型下拉的选项（真实 AI 模式才有）。 */
function aiModelOptionsHTML(state) {
  return `<option value="">平台默认模型</option>` + (Array.isArray(state.aiModels) ? state.aiModels : [])
    .map((m) => `<option value="${esc(m.name)}"${state.aiModel === m.name ? ' selected' : ''}>${esc(m.display || m.name)}</option>`)
    .join('');
}

function aiControlsHTML(state) {
  if (state.aiMode !== 'anna') return '';
  const models = Array.isArray(state.aiModels) ? state.aiModels : [];
  const sig = models.map((m) => m.name).join('|');
  const quota = Number.isFinite(state.aiQuota) ? state.aiQuota.toFixed(2) : '—';
  const tip = state.aiCatalogError || `Anna 账户剩余额度 · 最后刷新 ${state.aiQuotaAt ? new Date(state.aiQuotaAt).toLocaleTimeString('zh-CN') : '—'}`;
  return `<select class="select select--sm ai-model" data-action="ai:model" data-sig="${esc(sig)}"
      title="选择本次生成使用的模型；留空表示由平台按账户偏好自动路由">
      ${aiModelOptionsHTML(state)}
    </select>
    <span class="ai-quota${state.aiCatalogError ? ' ai-quota--warn' : ''}" data-ai-quota title="${esc(tip)}">CU ${quota}</span>
    <button class="btn btn--ghost btn--sm btn--icon" data-action="ai:refresh" title="刷新模型列表与剩余额度">↻</button>`;
}

export function topbarHTML(state) {
  const active = STEPS.findIndex((s) => s.key === state.view);
  const steps = STEPS.map(
    (s, i) => `${i ? '<span class="step__sep">/</span>' : ''}
      <span class="step${i === active ? ' step--active' : ''}">
        <span class="step__num">${i + 1}</span>${s.label}
      </span>`,
  ).join('');
  const themeName = state.deck ? THEMES[state.deck.theme?.id]?.name || state.deck.theme?.name || '自定义' : '';
  return `<header class="topbar">
    <div class="brand"><span class="brand__logo">S</span>SlideCraft AI</div>
    <nav class="steps">${steps}</nav>
    <div class="topbar__right">
      ${state.deck ? `<button class="btn btn--secondary btn--sm" data-action="theme:open">全局主题 · ${esc(themeName)}</button>` : ''}
      <button class="btn btn--ghost btn--sm" data-action="undo:last"${state.undoStack.length ? '' : ' disabled'} title="撤销最近一次修改">↶ 撤销</button>
      <span class="badge ${state.aiMode === 'anna' ? 'badge--ai' : 'badge--mock'}" data-ai-badge title="${esc(aiBadgeTitle(state))}">${esc(aiBadgeText(state))}</span>
      ${aiControlsHTML(state)}
      <span class="save" data-save-state data-state="${state.saveState}">${SAVE_LABEL[state.saveState] || ''}</span>
      <span class="host" data-host-state title="${esc(state.hostReason || '')}">${HOST_LABEL[state.host] || ''}</span>
    </div>
  </header>`;
}

export function shellHTML(state, body) {
  return `${topbarHTML(state)}<div class="workarea">${body}</div>`;
}

// ---------------- 浮层 ----------------

function exportModal(m) {
  const r = m.result;
  const err = m.error;
  const warnings = Array.isArray(r?.warnings) ? r.warnings : [];
  return `<div class="modal-backdrop"><div class="modal">
    <div class="modal__head">导出 PPTX <span class="badge ${r ? 'badge--ok' : 'badge--mock'}">${r ? '真实文件' : err ? '失败' : '处理中'}</span></div>
    <div class="modal__body">
      <div class="row row--between"><span>${esc(m.stage)}</span><b>${m.percent}%</b></div>
      <div class="progress"><div class="progress__bar" style="width:${m.percent}%"></div></div>
      <ul class="log-list">${(m.steps || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
      ${err ? `<div class="error-box" style="margin-top:14px"><b>导出失败</b><br />${esc(err)}</div>` : ''}
      ${r ? `<div class="result-box" style="margin-top:14px">
        <b>已生成真实 .pptx 文件并触发本地下载</b><br />
        文件名：<b>${esc(r.fileName)}</b><br />
        大小：${(Number(r.size) / 1024).toFixed(1)} KB · 页数：${r.pages} · 主题：${esc(r.theme)}<br />
        字体：${esc(r.stats?.font || '')} · 标题/正文：${r.stats?.titleSize}/${r.stats?.bodySize} pt · 页面 16:9<br />
        布局：${esc((r.layouts || []).join('、'))}<br />
        ${esc(r.message)}<br />
        文本框、形状、连接线与图表均为 PowerPoint 原生可编辑对象；本次未调用 Anna AI 或 upload.inline。
      </div>` : ''}
      ${warnings.length ? `<div class="warn-box" style="margin-top:10px"><b>排版提醒（${warnings.length}）</b>
        <ul>${warnings.slice(0, 6).map((w) => `<li>${w.page ? `第 ${w.page} 页：` : ''}${esc(w.message)}</li>`).join('')}</ul>
        ${warnings.length > 6 ? `<div class="tiny">…另有 ${warnings.length - 6} 条</div>` : ''}</div>` : ''}
    </div>
    <div class="modal__foot"><button class="btn btn--secondary" data-action="modal:close">关闭</button></div>
  </div></div>`;
}

function resetModal() {
  return `<div class="modal-backdrop"><div class="modal">
    <div class="modal__head">清除草稿</div>
    <div class="modal__body">确定清除当前保存的草稿吗？已保存的大纲与页面内容会被移除，且无法撤销。</div>
    <div class="modal__foot">
      <button class="btn btn--secondary" data-action="modal:close">取消</button>
      <button class="btn btn--danger" data-action="draft:reset-confirm">确认清除</button>
    </div>
  </div></div>`;
}

function addSlideModal(state) {
  const d = state.addDraft || { instruction: '', position: 'after' };
  return `<div class="modal-backdrop"><div class="modal">
    <div class="modal__head">按描述新增页面 ${aiModalBadge(state)}</div>
    <div class="modal__body">
      <div class="field">
        <label class="field__label">页面描述</label>
        <textarea class="textarea" data-draft-bind="add.instruction" placeholder="例如：新增一页横向时间轴，展示项目从立项到上线的五个阶段">${esc(d.instruction)}</textarea>
        <span class="field__hint">AI 会按描述生成标题、内容、布局与结构化元素（${state.aiMode === 'anna' ? 'Anna AI' : '本地 Mock'}）</span>
      </div>
      <div class="field" style="margin-top:14px">
        <label class="field__label">插入位置</label>
        <select class="select" data-draft-bind="add.position">
          <option value="after"${d.position === 'after' ? ' selected' : ''}>当前页之后</option>
          <option value="start"${d.position === 'start' ? ' selected' : ''}>放在最前面</option>
          <option value="end"${d.position === 'end' ? ' selected' : ''}>放在最后面</option>
        </select>
      </div>
      <div class="hint-box" style="margin-top:14px">这是与「重新生成页面」「按描述修改页面」并列的第三个独立入口：它会创建<strong>新页面</strong>并同步新增大纲条目。</div>
    </div>
    <div class="modal__foot">
      <button class="btn btn--secondary" data-action="modal:close">取消</button>
      <button class="btn btn--primary" data-action="add:apply">生成并插入新页面</button>
    </div>
  </div></div>`;
}

export function compareTable(state) {
  const e = state.lastEdit;
  if (!e) return '';
  if (e.kind === 'theme') {
    const rows = [
      ['主题名称', e.before.name, e.after.name],
      ['背景色', e.before.background, e.after.background],
      ['主色', e.before.primaryColor, e.after.primaryColor],
      ['标题字号', `${e.before.titleSize}px`, `${e.after.titleSize}px`],
      ['装饰风格', e.before.decorationStyle, e.after.decorationStyle],
    ];
    return `<div class="prop-title" style="margin-top:16px">上一次主题修改 · 前后对比</div>
      <table class="compare"><thead><tr><th>字段</th><th>修改前</th><th>修改后</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td><b>${esc(r[2])}</b></td></tr>`).join('')}</tbody></table>`;
  }
  if (e.kind === 'slide') {
    const rows = [
      ['标题', e.before.title, e.after.title],
      ['布局', LAYOUT_LABELS[e.before.layout] || e.before.layout, LAYOUT_LABELS[e.after.layout] || e.after.layout],
      ['要点数', e.before.points, e.after.points],
      ['页面元素', e.before.elements, e.after.elements],
      ['连线数', e.before.connectors, e.after.connectors],
      ['文字量', `${e.before.chars} 字`, `${e.after.chars} 字`],
    ];
    return `<div class="prop-title" style="margin-top:16px">上一次页面修改 · 前后对比</div>
      <div class="tiny" style="margin-bottom:6px">指令：${esc(e.instruction || '')}</div>
      <table class="compare"><thead><tr><th>字段</th><th>修改前</th><th>修改后</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td><b>${esc(r[2])}</b></td></tr>`).join('')}</tbody></table>`;
  }
  return '';
}

const FONT_OPTIONS = [
  "'Microsoft YaHei', 'PingFang SC', 'Hiragino Sans GB', 'Segoe UI', sans-serif",
  "'SimSun', 'Songti SC', serif",
  "'Segoe UI', Arial, sans-serif",
];

function themeModal(state) {
  const t = state.themeDraft || {};
  const colors = [
    ['background', '背景色'], ['primaryColor', '主色'], ['secondaryColor', '辅助色'],
    ['accentColor', '强调色'], ['titleColor', '标题色'], ['bodyColor', '正文色'],
  ];
  return `<div class="modal-backdrop"><div class="modal modal--wide">
    <div class="modal__head">全局主题设计 ${aiModalBadge(state)}</div>
    <div class="modal__body modal__body--scroll">
      <div class="prop-title">预设主题</div>
      <div class="preset-row">${THEME_IDS.map((id) => {
        const p = THEME_PRESETS[id];
        const active = state.deck?.theme?.id === id;
        return `<button class="preset${active ? ' preset--active' : ''}" data-action="theme:preset" data-id="${id}">
          <span class="preset__swatch">${p.swatch.map((c) => `<i style="background:${c}"></i>`).join('')}</span>
          <span><b>${esc(p.name)}</b><small>${esc(p.caption)}</small></span>
        </button>`;
      }).join('')}</div>

      <div class="prop-title" style="margin-top:18px">用自然语言描述整体风格</div>
      <textarea class="textarea" data-draft-bind="theme.prompt" placeholder="例如：将整套 PPT 改为深色科技风，采用深蓝背景和紫色点缀">${esc(state.themePrompt || '')}</textarea>
      <div class="chips" style="margin-top:8px">${THEME_PROMPT_EXAMPLES.map(
        (x, i) => `<button class="chip" data-action="theme:example" data-text="${esc(x)}">示例 ${i + 1}</button>`,
      ).join('')}</div>
      <div class="row" style="margin-top:8px">
        <button class="btn btn--primary btn--sm" data-action="theme:generate">AI 生成并应用主题</button>
        <span class="tiny">返回完整 Theme JSON，存入 deck.theme；不改变任何页面文字</span>
      </div>

      <div class="prop-title" style="margin-top:18px">手动微调</div>
      <div class="color-grid">${colors.map(
        ([key, label]) => `<label class="color-item"><span>${label}</span>
          <input type="color" data-draft-bind="theme.${key}" value="${esc(t[key] || '#FFFFFF')}" /></label>`,
      ).join('')}</div>
      <div class="form-grid" style="margin-top:12px">
        <div class="field"><label class="field__label">主题名称</label>
          <input class="input" data-draft-bind="theme.name" value="${esc(t.name || '')}" /></div>
        <div class="field"><label class="field__label">字体</label>
          <select class="select" data-draft-bind="theme.fontFamily">${FONT_OPTIONS.map(
            (f, i) => `<option value="${esc(f)}"${(t.fontFamily || FONT_OPTIONS[0]) === f ? ' selected' : ''}>${['微软雅黑 / 苹方', '宋体 / 衬线', 'Segoe UI'][i]}</option>`,
          ).join('')}</select></div>
        <div class="field"><label class="field__label">标题字号</label>
          <input class="input" type="number" min="18" max="56" data-draft-bind="theme.titleSize" value="${Number(t.titleSize) || 32}" /></div>
        <div class="field"><label class="field__label">正文字号</label>
          <input class="input" type="number" min="12" max="30" data-draft-bind="theme.bodySize" value="${Number(t.bodySize) || 19}" /></div>
        <div class="field"><label class="field__label">页面间距</label>
          <select class="select" data-draft-bind="theme.spacing">
            ${['compact', 'normal', 'spacious'].map((v) => `<option value="${v}"${t.spacing === v ? ' selected' : ''}>${({ compact: '紧凑', normal: '标准', spacious: '宽松' })[v]}</option>`).join('')}
          </select></div>
        <div class="field"><label class="field__label">圆角</label>
          <input class="input" type="number" min="0" max="20" data-draft-bind="theme.borderRadius" value="${Number(t.borderRadius ?? 6)}" /></div>
        <div class="field span-2"><label class="field__label">装饰风格</label>
          <select class="select" data-draft-bind="theme.decorationStyle">
            ${DECORATION_STYLES.map((v) => `<option value="${v}"${t.decorationStyle === v ? ' selected' : ''}>${({ minimal: '极简', rules: '细线分隔', grid: '网格', blocks: '卡片描边', tech: '科技角标' })[v]}</option>`).join('')}
          </select></div>
      </div>
      <div class="row" style="margin-top:12px">
        <button class="btn btn--secondary btn--sm" data-action="theme:apply-draft">应用自定义主题</button>
        <button class="btn btn--ghost btn--sm" data-action="undo:last"${state.undoStack.length ? '' : ' disabled'}>↶ 撤销上次修改</button>
      </div>
      ${compareTable(state)}
    </div>
    <div class="modal__foot"><button class="btn btn--secondary" data-action="modal:close">关闭</button></div>
  </div></div>`;
}

export function overlayHTML(state) {
  let html = '';
  if (state.toast) {
    const tag = state.toast.type === 'error' && state.aiError
      ? `<span class="toast__code">${esc(AI_ERROR_LABEL[state.aiError.code] || '生成失败')}</span>`
      : '';
    html += `<div class="toast toast--${esc(state.toast.type)}">${tag}${esc(state.toast.text)}</div>`;
  }
  if (state.modal) {
    const type = state.modal.type;
    if (type === 'export') html += exportModal(state.modal);
    else if (type === 'confirm-reset') html += resetModal();
    else if (type === 'add-slide') html += addSlideModal(state);
    else if (type === 'theme') html += themeModal(state);
  }
  if (state.busy) html += `<div class="busy"><div class="busy__card"><span class="spinner"></span>${esc(state.busy)}</div></div>`;
  return html;
}

/** 更新顶栏局部状态，不重建 #app（避免打断输入焦点）。 */
export function patchStatus(state) {
  const save = document.querySelector('[data-save-state]');
  if (save) { save.textContent = SAVE_LABEL[state.saveState] || ''; save.dataset.state = state.saveState; }
  const host = document.querySelector('[data-host-state]');
  if (host) { host.textContent = HOST_LABEL[state.host] || ''; host.title = state.hostReason || ''; }
  const err = document.querySelector('[data-create-error]');
  if (err) err.textContent = state.createError || '';
  const aiBadge = document.querySelector('[data-ai-badge]');
  if (aiBadge) {
    aiBadge.textContent = aiBadgeText(state);
    aiBadge.title = aiBadgeTitle(state);
  }
  const quotaEl = document.querySelector('[data-ai-quota]');
  if (quotaEl) {
    quotaEl.textContent = `CU ${Number.isFinite(state.aiQuota) ? state.aiQuota.toFixed(2) : '—'}`;
    quotaEl.title = state.aiCatalogError || `Anna 账户剩余额度 · 最后刷新 ${state.aiQuotaAt ? new Date(state.aiQuotaAt).toLocaleTimeString('zh-CN') : '—'}`;
    quotaEl.classList.toggle('ai-quota--warn', !!state.aiCatalogError);
  }
  // 目录只在签名变化时重建，避免打断用户正在操作的下拉。
  const sel = document.querySelector('[data-action="ai:model"]');
  if (sel) {
    const sig = (Array.isArray(state.aiModels) ? state.aiModels : []).map((m) => m.name).join('|');
    if (sel.dataset.sig !== sig) {
      sel.innerHTML = aiModelOptionsHTML(state);
      sel.dataset.sig = sig;
    }
    sel.value = state.aiModel || '';
  }
}

/** 幻灯片画布固定 960×540，按容器宽度等比缩放；缩略图与大图共用同一渲染函数。 */
export function fitSlides(root = document) {
  root.querySelectorAll('.slide-frame').forEach((frame) => {
    const slide = frame.querySelector('.slide');
    if (!slide) return;
    const k = frame.clientWidth / 960;
    if (k > 0) slide.style.transform = `scale(${k})`;
  });
}
