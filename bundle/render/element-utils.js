/**
 * 动态页面元素的统一取值层（HTML 预览 与 PPTX 渲染 共用）。
 *
 * 阶段 4 真实 AI 暴露的问题：模型会把内容放在 items / bullets / points / text /
 * name / label / value 等任意字段，甚至给出只有 kind 的空壳元素。旧的渲染器只认
 * title + items，于是双栏/对比/架构/时间轴等布局画出空白框，而右侧属性面板里
 * 明明有要点。这里把所有字段收敛成统一结构，并保证永远能从 slide.points 兜底。
 */
const KIND_ALIASES = {
  module: 'node', shape: 'node', edge: 'connector', text: 'note',
};

export function normalizeKind(kind) {
  const k = String(kind || 'node');
  return KIND_ALIASES[k] || k;
}

/** 该布局需要的主元素类型；undefined 表示不使用结构化元素。 */
export const LAYOUT_MAIN_KIND = {
  flowchart: 'node',
  architecture: 'layer',
  timeline: 'step',
  comparison: 'column',
  'two-column': 'column',
  dashboard: 'metric',
};

function firstNonEmpty(...vals) {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return '';
}

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (v === undefined || v === null || v === '') return [];
  return [v];
}

function flattenItem(it) {
  if (typeof it === 'string') return it.trim();
  if (typeof it === 'number') return String(it);
  if (!it || typeof it !== 'object') return '';
  return firstNonEmpty(it.text, it.title, it.name, it.label, it.detail, it.value);
}

/** 把元素里任意形态的「条目列表」收敛为字符串数组。 */
export function elementItems(el) {
  if (!el || typeof el !== 'object') return [];
  const raw = el.items ?? el.bullets ?? el.points ?? el.list ?? el.entries
    ?? el.content ?? el.text ?? el.detail ?? el.description ?? el.lines;
  const out = [];
  for (const v of asArray(raw)) {
    if (typeof v === 'string') {
      // 模型常把多条写进一个字符串，用换行/分号/项目符号分隔。
      const parts = v.split(/[\n；;]+|\s+[·•]\s+/).map((x) => x.trim()).filter(Boolean);
      if (parts.length > 1) out.push(...parts);
      else if (v.trim()) out.push(v.trim());
    } else {
      const s = flattenItem(v);
      if (s) out.push(s);
    }
  }
  return out.filter(Boolean).slice(0, 8);
}

/** 元素标题：兼容 title / name / label / heading / header；短 text 也可作标题。 */
export function elementTitle(el, fallback = '') {
  const t = firstNonEmpty(el?.title, el?.name, el?.label, el?.heading, el?.header);
  if (t) return t;
  const text = firstNonEmpty(el?.text, el?.subtitle);
  if (text && text.length <= 24 && !/[\n；;]/.test(text)) return text;
  return fallback;
}

/** 元素说明文字（node / step 的副文本）。 */
export function elementText(el) {
  return firstNonEmpty(el?.text, el?.detail, el?.description, el?.subtitle, el?.value);
}

/** 指标卡数值。 */
export function elementValue(el, fallback = '—') {
  return firstNonEmpty(el?.value, el?.number, el?.metric, el?.stat) || fallback;
}

export function elementHasContent(el) {
  if (!el) return false;
  return !!(elementTitle(el) || elementText(el) || elementItems(el).length || elementValue(el, ''));
}

/** slide.points → 可直接展示的字符串数组（可选带上 detail）。 */
export function pointsToItems(slide, { withDetail = false } = {}) {
  const pts = Array.isArray(slide?.points) ? slide.points : [];
  return pts.map((p) => {
    const head = firstNonEmpty(p?.text, p?.title, p?.name);
    const detail = firstNonEmpty(p?.detail, p?.description);
    if (withDetail && head && detail) return `${head}：${detail}`;
    return head || detail;
  }).filter(Boolean);
}

/**
 * 规范化一组元素：统一 kind / title / items / text / value，
 * 并对「完全空壳」的元素从 slide.points 借内容，保证渲染出可见文字。
 */
export function enrichElements(els, slide) {
  const pts = pointsToItems(slide, { withDetail: true });
  let cursor = 0;
  return (Array.isArray(els) ? els : []).map((raw) => {
    if (!raw || typeof raw !== 'object') return { kind: 'note', title: '', items: [], text: '', value: '' };
    const kind = normalizeKind(raw.kind);
    const title = elementTitle(raw);
    const items = elementItems(raw);
    const text = elementText(raw);
    const value = elementValue(raw, '');
    const el = { ...raw, kind, title, items, text, value };
    if (kind === 'connector') return el; // 连线本身不需要文字
    if (elementHasContent(el) || !pts.length) return el;
    const a = pts[cursor % pts.length];
    cursor += 1;
    const b = pts[cursor % pts.length];
    el.title = title || a || `要点 ${cursor}`;
    if (!items.length) el.items = [a, b].filter((x, i, arr) => x && arr.indexOf(x) === i);
    if (!text && !el.items.length) el.text = b || '';
    return el;
  });
}

/** 判断给定元素里是否存在「有内容」的目标类型元素；否则应改用 points 兜底。 */
export function hasUsableElements(els, kind) {
  if (!kind) return false;
  const targets = (Array.isArray(els) ? els : [])
    .filter((e) => normalizeKind(e?.kind) === kind);
  return targets.length > 0 && targets.some((e) => elementHasContent(e));
}
