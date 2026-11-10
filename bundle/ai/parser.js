/**
 * LLM 输出解析与校验层（阶段 4）—— 真实 AI 返回写入 Deck 之前的唯一关口。
 *
 * 流程：提取文本 → 剥离 Markdown 代码块 → JSON.parse（严禁 eval）→ 逐字段校验
 * → 本地安全修复 / 明确报错 → 经 core/deck.js 的 normalize* 转成标准 Deck v2 数据。
 *
 * 原则：
 * - 结构性非法（非 JSON、未知布局、未知元素类型、页数不符、试图更换 id）→ 明确抛错，调用方不覆盖 Deck。
 * - 可选字段缺失 / 轻微越界 → 使用合理默认值，并把每一次本地修复记进 summary.repairs，
 *   明确区分「本地数据修复」与「再次调用 LLM」（本层永不重新调用模型）。
 * - 绝不静默丢弃大段内容；任何截断都会记录。
 */
import {
  LAYOUT_TYPES, PAGE_TYPES, DECORATION_STYLES, EMPHASIS_STYLES, DENSITY_STYLES,
  uid, defaultTypeFor, normalizeOutlineItem, normalizeSlide, normalizeTheme,
  normalizeElements, toLayout,
} from '../core/deck.js';
import { AiError, AI_ERROR_CODES, toAiError, outputError } from './errors.js';
import { normalizeBlocks } from '../core/blocks.js';

export const MAX_TITLE = 90;
export const MAX_POINT_TEXT = 60;
export const MAX_POINT_DETAIL = 120;
export const MAX_TEXT = 160;
export const MAX_POINTS = 6;
export const MAX_ELEMENTS = 24;
export const MAX_ITEMS = 8;
export const MAX_PAGES = 20;

/** 与 render/pptx-validator.js 的 KNOWN_KINDS 完全一致，保证 AI 产出一定能被阶段 3 渲染。 */
export const ALLOWED_KINDS = [
  'layer', 'node', 'connector', 'step', 'column', 'metric', 'bar', 'note', 'label',
  'module', 'edge', 'text', 'shape', 'chart', 'image',
];
const KIND_ALIASES = { module: 'node', shape: 'node', edge: 'connector', text: 'note' };
const HEX_RE = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;
const THEME_COLOR_KEYS = ['background', 'primaryColor', 'secondaryColor', 'accentColor', 'titleColor', 'bodyColor'];

function repair(repairs, text) {
  if (repairs) repairs.push(String(text));
}

function cleanText(value, max, label, repairs) {
  let s = value === undefined || value === null ? '' : String(value);
  // 去掉可能破坏 OOXML 的控制字符，保留中文、英文、数字与常见标点。
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  if (s.length > max) {
    repair(repairs, `${label} 超过 ${max} 字，已截断 ${s.length - max} 字`);
    s = s.slice(0, max);
  }
  return s;
}

function asObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw outputError(`${label} 不是对象`, { label });
  }
  return value;
}

/** 从 SDK 返回值提取纯文本。SDK 已 resolve(msg.result)，此处不再解包 {result}。 */
export function extractText(result) {
  if (result && typeof result === 'object' && result.ok === false) {
    // 少数宿主路径会把 {ok:false,error} 当作 result 返回，而不是走 RPC error 通道。
    const e = result.error || {};
    throw toAiError({ code: e.code, message: e.message });
  }
  const pick = (c) => {
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) {
      const parts = c.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text);
      return parts.length ? parts.join('\n') : '';
    }
    if (c && typeof c === 'object') {
      if (typeof c.text === 'string') return c.text;
      return pick(c.content);
    }
    return '';
  };
  const text = result && typeof result === 'object'
    ? pick(result.content) || pick(result.text) || ''
    : '';
  if (!text.trim()) throw outputError('模型返回中没有可解析的文本内容（content.text 为空）');
  return text;
}

/**
 * 在字符串之外的括号配平扫描：返回从 start 开始的第一个完整 JSON 值。
 * 返回 null 表示未闭合（通常是 maxTokens 截断）。
 */
function balancedSlice(s, start) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i += 1) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) return { text: s.slice(start, i + 1), closed: true };
    }
  }
  return { text: s.slice(start), closed: false };
}

/** 去掉 // 与 /* *\/ 注释，但保留字符串内的同类字符。 */
function stripJsonComments(s) {
  let out = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    const next = s[i + 1];
    if (inStr) {
      out += ch;
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; out += ch; continue; }
    if (ch === '/' && next === '/') {
      while (i < s.length && s[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i += 1;
      i += 1;
      continue;
    }
    out += ch;
  }
  return out;
}

/** 输出被截断时，按未闭合的括号栈补齐结尾，尽量救回已完整的部分。 */
function closeTruncated(s) {
  const stack = [];
  let inStr = false;
  let esc = false;
  for (const ch of s) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }
  let t = s.trimEnd();
  if (inStr) t += '"';
  t = t.replace(/,\s*$/, '');
  for (let i = stack.length - 1; i >= 0; i -= 1) t += stack[i] === '{' ? '}' : ']';
  return t;
}

function attachRepairs(obj, repairs) {
  // 非枚举属性：不影响 JSON.stringify、字段遍历或任何业务判断。
  try { Object.defineProperty(obj, '__parseRepairs', { value: repairs, enumerable: false }); }
  catch { /* 冻结对象时忽略 */ }
  return obj;
}

/**
 * 逐页生成的截断救回：从原始文本里逐个提取「已经写完整」的 slide 对象。
 *
 * 整段 JSON 被 maxTokens 切断时，closeTruncated 常因截在某个字符串/键名中间
 * 而补出非法 JSON，导致整批报「解析失败」。这里改为按对象边界扫描：
 * 前面完整的页一律保留，只放弃最后一个残缺对象，再由业务层为缺页做本地兜底。
 */
function salvageSlidesJson(rawText) {
  const s = String(rawText || '');
  const marker = /"slides"\s*:\s*\[/.exec(s);
  if (!marker) return null;
  const tryParse = (t) => { try { return JSON.parse(t); } catch { return undefined; } };
  let i = marker.index + marker[0].length;
  const out = [];
  while (i < s.length) {
    while (i < s.length && /[\s,]/.test(s[i])) i += 1;
    if (i >= s.length || s[i] === ']') break;
    if (s[i] !== '{') break;
    const piece = balancedSlice(s, i);
    if (piece.closed) {
      const obj = tryParse(piece.text);
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) break;
      // 只保留结构完整的页：缺 layout/type 的半成品补齐后仍会让字段校验抛错，
      // 反而把整批生成拖垮，不如交给 buildFallbackSlides 用大纲生成并明确警告。
      if (!obj.layout && !obj.type) break;
      out.push(obj);
      i += piece.text.length;
    } else {
      // 最后一个对象被 maxTokens 切断：整体放弃这一页，由业务层兜底。
      break;
    }
  }
  return out.length ? { slides: out } : null;
}

/**
 * 剥离 Markdown 代码块 / 前后杂文本后解析；只使用 JSON.parse，绝不使用 eval。
 *
 * 修复要点（阶段 4 真实调用暴露）：
 * - 用括号配平扫描取代 lastIndexOf('}')，避免 JSON 后的解释文字破坏截取；
 * - 支持 // 与 /* *\/ 注释；
 * - 输出被 maxTokens 截断时尝试补齐括号救回已完整部分，并明确留痕；
 * - 顶层为数组时包装成 {items:[...]} 供上层识别；
 * - 错误信息区分「截断」与「格式非法」，便于用户判断。
 */
export function parseJsonLoose(rawText) {
  let s = String(rawText || '').replace(/^\uFEFF/, '').trim();
  if (!s) throw outputError('模型返回为空');
  const repairs = [];

  const fence = s.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fence && fence[1].trim()) { s = fence[1].trim(); repairs.push('已剥离 Markdown 代码块'); }
  s = stripJsonComments(s);

  const tryParse = (t) => { try { return JSON.parse(t); } catch { return undefined; } };
  const firstBrace = s.indexOf('{');
  const firstBracket = s.indexOf('[');
  // 顶层是数组时优先处理；否则 indexOf('{') 会命中数组内第一个元素，只解析出一项。
  if (firstBracket >= 0 && (firstBrace < 0 || firstBracket < firstBrace)) {
    const a = balancedSlice(s, firstBracket);
    let list = tryParse(a.text);
    if (list === undefined && !a.closed) list = tryParse(closeTruncated(a.text));
    if (Array.isArray(list)) {
      repairs.push('顶层为数组，已包装为 {items:[…]}');
      return attachRepairs({ items: list }, repairs);
    }
  }
  const start = firstBrace;
  if (start < 0) throw outputError('没有找到合法的 JSON 对象');
  if (start > 0) repairs.push('已剥离模型输出中的非 JSON 前后文本');

  const balanced = balancedSlice(s, start);
  if (balanced.text.length < s.length - start) {
    repairs.push('已忽略模型在 JSON 之后追加的说明文字');
  }
  const candidates = [];
  candidates.push(balanced.text);
  candidates.push(balanced.text.replace(/,\s*([}\]])/g, '$1'));
  if (!balanced.closed) {
    const closed = closeTruncated(balanced.text);
    candidates.push(closed);
    candidates.push(closed.replace(/,\s*([}\]])/g, '$1'));
  }
  // 兜底：模型在 JSON 后追加解释文字时，仍尝试到最后一个 } 的片段。
  const last = s.lastIndexOf('}');
  if (last > start) candidates.push(s.slice(start, last + 1));

  for (const c of candidates) {
    const parsed = tryParse(c);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      if (c !== balanced.text) repairs.push('已对模型输出做本地格式修补（尾随逗号 / 截断补全）');
      return attachRepairs(parsed, repairs);
    }
  }
  if (!balanced.closed) {
    throw outputError(
      `模型输出未闭合，疑似被 maxTokens 截断（${s.length} 字符）。请减少页数或重试`,
      { truncated: true, chars: s.length },
    );
  }
  throw outputError('JSON 解析失败或顶层不是对象', { chars: s.length });
}

/** 把 parseJsonLoose 的本地修复记录合并进业务 summary。 */
function takeRepairs(root, repairs) {
  const own = root?.__parseRepairs;
  if (Array.isArray(own)) repairs.push(...own);
  return root;
}

// ---------------- 字段级校验 ----------------

function checkLayout(raw, repairs) {
  const v = String(raw || '');
  if (LAYOUT_TYPES.includes(v)) return v;
  if (v === 'cover') { repair(repairs, '布局旧名 cover → title'); return 'title'; }
  if (v === 'visual') { repair(repairs, '布局旧名 visual → image-text'); return 'image-text'; }
  // 结构性错误：绝不让渲染器收到不支持的布局。
  throw outputError(`包含不支持的布局「${v || '(空)'}」，允许值：${LAYOUT_TYPES.join(' / ')}`);
}

function normalizePoints(raw, repairs) {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw outputError('points 不是数组');
  const list = raw.slice(0, MAX_POINTS).map((p) => ({
    text: cleanText(typeof p === 'string' ? p : p?.text, MAX_POINT_TEXT, '要点标题', repairs),
    detail: cleanText(typeof p === 'string' ? '' : p?.detail, MAX_POINT_DETAIL, '要点说明', repairs),
  }));
  if (raw.length > MAX_POINTS) repair(repairs, `要点 ${raw.length} 条超出上限，保留前 ${MAX_POINTS} 条`);
  return list.filter((p) => p.text || p.detail);
}

function normalizeDesign(raw, repairs) {
  if (raw === undefined) return undefined;
  const d = asObject(raw, 'design');
  const pick = (key, allowed, fallback) => {
    if (!allowed.includes(d[key])) { if (d[key] !== undefined) repair(repairs, `design.${key} 非法，已回退`); return fallback; }
    return d[key];
  };
  return {
    emphasis: pick('emphasis', EMPHASIS_STYLES, 'balanced'),
    decoration: pick('decoration', DECORATION_STYLES, 'minimal'),
    density: pick('density', DENSITY_STYLES, 'normal'),
    alignment: d.alignment === 'center' ? 'center' : 'left',
  };
}

function normalizeChart(raw, repairs) {
  if (raw === undefined || raw === null) return undefined;
  const c = asObject(raw, 'chart');
  const type = ['bar', 'line', 'pie'].includes(c.type) ? c.type : 'bar';
  if (c.type && type !== c.type) repair(repairs, `图表类型 ${c.type} 不支持，已回退为 bar`);
  const labels = Array.isArray(c.labels) ? c.labels.slice(0, 8).map((x) => cleanText(x, 24, '图表标签', repairs)) : [];
  const series = Array.isArray(c.series)
    ? c.series.slice(0, 4).map((s) => ({
        name: cleanText(s?.name, 30, '系列名', repairs),
        values: Array.isArray(s?.values)
          ? s.values.slice(0, 8).map((n) => (Number.isFinite(Number(n)) ? Number(n) : 0))
          : [],
      }))
    : [];
  if (!labels.length || !series.length) repair(repairs, '图表缺少标签或数据，已保留空图表结构');
  return {
    type, unit: cleanText(c.unit, 30, '图表单位', repairs), labels, series,
    note: cleanText(c.note, MAX_TEXT, '图表说明', repairs),
  };
}

function normalizeElementList(raw, repairs) {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw outputError('elements 不是数组');
  const list = raw.slice(0, MAX_ELEMENTS);
  if (raw.length > MAX_ELEMENTS) repair(repairs, `元素 ${raw.length} 个超出上限，保留前 ${MAX_ELEMENTS} 个`);
  const used = new Set();
  const out = list.map((e) => {
    const src = asObject(e, 'elements[]');
    let kind = String(src.kind || 'node');
    if (KIND_ALIASES[kind]) { repair(repairs, `元素别名 ${kind} → ${KIND_ALIASES[kind]}`); kind = KIND_ALIASES[kind]; }
    if (!ALLOWED_KINDS.includes(kind)) throw outputError(`包含不支持的元素类型「${kind}」`);
    let id = cleanText(src.id, 40, '元素 id', repairs) || uid('el');
    if (used.has(id)) { id = uid('el'); repair(repairs, '元素 id 重复，已重新生成'); }
    used.add(id);
    const coord = (k) => {
      const n = Number(src[k]);
      if (!Number.isFinite(n) || src[k] === null || src[k] === undefined || src[k] === '') return null;
      if (n < 0 || n > 1) { repair(repairs, `元素坐标 ${k}=${n} 越界，已收回 0～1`); return Math.max(0, Math.min(1, n)); }
      return n;
    };
    return {
      id, kind,
      title: cleanText(src.title, 60, '元素标题', repairs),
      text: cleanText(src.text, MAX_TEXT, '元素正文', repairs),
      value: cleanText(src.value, 30, '元素数值', repairs),
      from: cleanText(src.from, 40, '连线起点', repairs),
      to: cleanText(src.to, 40, '连线终点', repairs),
      level: Number.isFinite(Number(src.level)) ? Math.max(0, Math.min(9, Number(src.level))) : 0,
      items: Array.isArray(src.items) ? src.items.slice(0, MAX_ITEMS).map((x) => cleanText(x, 60, '元素条目', repairs)) : [],
      x: coord('x'), y: coord('y'), w: coord('w'), h: coord('h'),
    };
  });
  // 连线引用必须指向本页存在的节点；无法解析时按节点顺序补齐，保证关系可正确表达。
  const nodeIds = out.filter((e) => e.kind !== 'connector').map((e) => e.id);
  out.forEach((e) => {
    if (e.kind !== 'connector') return;
    if (e.from && !used.has(e.from)) { e.from = nodeIds[0] || ''; repair(repairs, '连线起点引用不存在，已按顺序补齐'); }
    if (e.to && !used.has(e.to)) { e.to = nodeIds[nodeIds.length - 1] || ''; repair(repairs, '连线终点引用不存在，已按顺序补齐'); }
  });
  return normalizeElements(out);
}

function normalizeSlideFields(raw, repairs, { withId = false } = {}) {
  const src = asObject(raw, 'slide');
  const layout = checkLayout(src.layout || src.type, repairs);
  // 真实模型常用 bullets / items / keyPoints 代替 points；不映射会静默丢掉全部要点。
  let pointsRaw = src.points;
  if (!Array.isArray(pointsRaw)) {
    const alias = ['bullets', 'items', 'keyPoints'].find((k) => Array.isArray(src[k]));
    if (alias) { pointsRaw = src[alias]; repair(repairs, `模型使用 ${alias} 而非 points，已映射`); }
  }
  const out = {
    type: layout,
    layout,
    title: cleanText(src.title, MAX_TITLE, '页面标题', repairs),
    subtitle: cleanText(src.subtitle, MAX_TEXT, '副标题', repairs),
    points: normalizePoints(pointsRaw, repairs) ?? [],
    evidence: cleanText(src.evidence, MAX_TEXT, '数据/案例', repairs),
    visualHint: cleanText(src.visualHint, MAX_TEXT, '呈现建议', repairs),
    notes: cleanText(src.notes, 400, '演讲者备注', repairs),
    chapter: cleanText(src.chapter, 40, '章节', repairs),
    design: normalizeDesign(src.design, repairs) ?? undefined,
    elements: normalizeElementList(src.elements, repairs) ?? [],
    chart: normalizeChart(src.chart, repairs) ?? null,
    // AI 给出的自由布局位置骨架：校验 kind、clamp 坐标；文字由 resolveBlocks 本地补齐。
    blocks: Array.isArray(src.blocks) ? normalizeBlocks(src.blocks) : [],
  };
  if (withId) out.id = cleanText(src.id, 60, 'slide.id', repairs) || uid('sl');
  return out;
}

function finish(summaryBase, repairs) {
  return {
    ...summaryBase,
    repairs,
    source: 'anna',
    localRepairCount: repairs.length,
  };
}

// ---------------- 五类（+2）业务结果的解析入口 ----------------

export function parseOutlineResult(text, { pageCount = 8, meta = {} } = {}) {
  const repairs = [];
  const root = takeRepairs(parseJsonLoose(extractTextOrRaw(text)), repairs);
  const raw = root.outline ?? root.pages ?? root.items;
  if (!Array.isArray(raw) || !raw.length) throw outputError('缺少 outline 数组或数组为空');
  if (raw.length > MAX_PAGES) throw outputError(`大纲 ${raw.length} 页超出上限 ${MAX_PAGES}`);
  const expected = Math.max(3, Math.min(MAX_PAGES, Number(pageCount) || 8));
  if (Math.abs(raw.length - expected) > 2) {
    throw outputError(`大纲页数 ${raw.length} 与需求 ${expected} 页不符（差异超过 2 页）`);
  }
  if (raw.length !== expected) repair(repairs, `大纲返回 ${raw.length} 页，与需求 ${expected} 页略有差异，按返回内容使用`);

  const outline = raw.map((item, i) => {
    const o = asObject(item, `outline[${i}]`);
    let pageType = String(o.pageType || '');
    if (!PAGE_TYPES.includes(pageType)) {
      repair(repairs, `第 ${i + 1} 页 pageType「${pageType}」非法，已回退`);
      pageType = defaultTypeFor(i, raw.length);
    }
    // id 一律由程序生成，避免模型输出重复 id 或覆盖已有大纲条目。
    return normalizeOutlineItem({
      id: uid('out'),
      chapter: cleanText(o.chapter, 40, '章节', repairs),
      title: cleanText(o.title, MAX_TITLE, '大纲标题', repairs),
      keyPoint: cleanText(o.keyPoint, MAX_TEXT, '核心观点', repairs),
      pageType,
    }, i, raw.length);
  });
  if (outline.every((o, i) => i > 0 && o.title === outline[0].title)) {
    throw outputError('大纲所有页面标题完全相同，疑似无效输出');
  }
  return {
    outline,
    summary: finish({ pages: outline.length, topic: cleanText(meta?.topic, 60, '主题', repairs) }, repairs),
  };
}

export function parseSlidesResult(text, { batch = [], allowPartial = false } = {}) {
  const repairs = [];
  const rawText = extractTextOrRaw(text);
  let root;
  try {
    root = takeRepairs(parseJsonLoose(rawText), repairs);
  } catch (e) {
    // 只有「逐页生成」允许截断救回；单页 patch / 主题等仍严格校验，避免写入半个对象。
    const salvaged = allowPartial && e?.details?.truncated ? salvageSlidesJson(rawText) : null;
    if (!salvaged) throw e;
    root = salvaged;
    repair(repairs, `模型输出被截断，已救回 ${salvaged.slides.length} 页完整内容`);
  }
  // 模型偶尔把顶层数组写成 {items:[...]} 或直接叫 pages。
  const slidesRaw = root.slides ?? root.pages ?? root.items;
  if (!Array.isArray(slidesRaw)) throw outputError('缺少 slides 数组');
  if (slidesRaw !== root.slides) repair(repairs, '模型使用了非标准顶层字段名，已映射为 slides');
  root.slides = slidesRaw;
  if (allowPartial) {
    // 截断补全可能造出缺关键字段的半成品页；丢弃并留痕，由缺页兜底接管。
    const whole = root.slides.filter((s) => s && typeof s === 'object' && !Array.isArray(s) && (s.layout || s.type));
    if (whole.length !== root.slides.length) {
      repair(repairs, `丢弃 ${root.slides.length - whole.length} 页结构不完整的输出`);
      root.slides = whole;
    }
  }
  if (root.slides.length > batch.length) {
    repair(repairs, `模型返回 ${root.slides.length} 页，多于本批 ${batch.length} 页，已保留前 ${batch.length} 页`);
  }
  if (root.slides.length !== batch.length && !allowPartial) {
    throw outputError(`返回 ${root.slides.length} 页，本批需要 ${batch.length} 页`);
  }
  const used = root.slides.slice(0, batch.length);
  const missing = batch.slice(used.length);
  if (missing.length) {
    repair(repairs, `本批需要 ${batch.length} 页，模型只返回 ${used.length} 页；${missing.length} 页将用大纲本地生成`);
  }
  const slides = used.map((raw, i) => {
    const cleaned = normalizeSlideFields(raw, repairs);
    const expectedId = batch[i]?.id;
    const givenId = cleanText(raw?.outlineId, 60, 'outlineId', repairs);
    if (givenId !== expectedId) repair(repairs, `第 ${i + 1} 页 outlineId 不匹配，已按大纲顺序对齐`);
    return normalizeSlide({
      ...cleaned,
      id: uid('sl'),           // 新页唯一 id；mergeGeneratedSlides 会按 outlineId 复用已有 id
      outlineId: expectedId || null,
      chapter: cleaned.chapter || batch[i]?.chapter || '',
      title: cleaned.title || batch[i]?.title || '未命名页面',
    }, i, batch.length);
  });
  return {
    slides,
    summary: finish({
      pages: slides.length,
      layouts: slides.map((s) => s.layout),
      truncated: missing.length > 0,
      missing,
      missingCount: missing.length,
    }, repairs),
  };
}

/**
 * 缺页兜底：用大纲条目生成一页结构完整、内容明确标注的 Slide（本地、零 CU）。
 * 不 pretending 成 AI 输出，业务层会给出可见警告并提示可单独「重新生成页面」。
 */
export function buildFallbackSlides(missing = [], startIndex = 0, total = 8) {
  return missing.map((o, i) => normalizeSlide({
    id: uid('sl'),
    outlineId: o.id,
    layout: toLayout(o.pageType || defaultTypeFor(startIndex + i, total)),
    title: String(o.title || '未命名页面'),
    subtitle: '',
    points: [{ text: String(o.keyPoint || o.title || '核心观点').slice(0, 60), detail: '' }],
    evidence: '',
    visualHint: '本页因模型输出截断由大纲自动生成，可点击「重新生成页面」补全',
    notes: '此页为大纲占位内容，建议重新生成后再演示。',
    chapter: String(o.chapter || ''),
    elements: [],
    chart: null,
  }, startIndex + i, total));
}

/** 单页 patch：regenerateSlide / editSlideByInstruction / changeSlideLayout 共用。 */
export function parseSlidePatchResult(text, { slide = null, allowedFields = null } = {}) {
  const repairs = [];
  const root = takeRepairs(parseJsonLoose(extractTextOrRaw(text)), repairs);
  const raw = root.patch ?? root.slide ?? root;
  asObject(raw, 'patch');
  if ('id' in raw) throw outputError('patch 中包含 id，禁止更换 slide.id');
  if ('outlineId' in raw) throw outputError('patch 中包含 outlineId，禁止更换关联大纲');

  // 与 normalizeSlideFields 一致：兼容模型把要点写成 bullets / items。
  const effective = { ...raw };
  if (!Array.isArray(effective.points)) {
    const alias = ['bullets', 'items', 'keyPoints'].find((k) => Array.isArray(raw[k]));
    if (alias) { effective.points = raw[alias]; repair(repairs, `模型使用 ${alias} 而非 points，已映射`); }
  }
  const allowed = allowedFields || [
    'type', 'layout', 'title', 'subtitle', 'points', 'evidence', 'visualHint',
    'notes', 'chapter', 'design', 'elements', 'chart', 'blocks',
  ];
  const patch = {};
  for (const key of allowed) {
    if (!(key in effective)) continue;
    if (key === 'layout' || key === 'type') patch[key] = checkLayout(effective[key] || effective.layout || effective.type, repairs);
    else if (key === 'points') patch[key] = normalizePoints(effective[key], repairs) ?? [];
    else if (key === 'elements') patch[key] = normalizeElementList(effective[key], repairs) ?? [];
    else if (key === 'blocks') patch[key] = Array.isArray(effective[key]) ? normalizeBlocks(effective[key]) : [];
    else if (key === 'design') patch[key] = normalizeDesign(effective[key], repairs);
    else if (key === 'chart') patch[key] = normalizeChart(effective[key], repairs) ?? null;
    else if (key === 'notes') patch[key] = cleanText(effective[key], 400, '演讲者备注', repairs);
    else if (key === 'title') patch[key] = cleanText(effective[key], MAX_TITLE, '页面标题', repairs);
    else patch[key] = cleanText(effective[key], MAX_TEXT, key, repairs);
  }
  if ('layout' in patch && !('type' in patch)) patch.type = patch.layout;
  if ('type' in patch && !('layout' in patch)) patch.layout = patch.type;
  if (!Object.keys(patch).length) throw outputError('patch 没有任何可应用的字段');

  // 若 patch 未包含布局，沿用当前页布局；避免 normalizeSlide 用默认布局覆盖。
  if (!patch.layout && slide) { patch.layout = toLayout(slide.layout || slide.type); patch.type = patch.layout; }
  return {
    patch,
    summary: finish({ fields: Object.keys(patch), layout: patch.layout || null }, repairs),
  };
}

export function parseNewSlideResult(text, { instruction = '' } = {}) {
  const repairs = [];
  const root = takeRepairs(parseJsonLoose(extractTextOrRaw(text)), repairs);
  const cleaned = normalizeSlideFields(root.slide ?? root, repairs);
  const rawItem = root.outlineItem ?? root.outline ?? {};
  asObject(rawItem, 'outlineItem');
  let pageType = String(rawItem.pageType || 'content');
  if (!PAGE_TYPES.includes(pageType)) {
    repair(repairs, `新增页大纲 pageType「${pageType}」非法，已回退为 content`);
    pageType = 'content';
  }
  // 强制生成全新的唯一 ID，绝不采用模型返回的 id，也绝不覆盖已有页面。
  const outlineItem = normalizeOutlineItem({
    id: uid('out'),
    chapter: cleanText(rawItem.chapter, 40, '章节', repairs) || 'AI 新增',
    title: cleanText(rawItem.title, MAX_TITLE, '大纲标题', repairs) || cleaned.title || '新增页面',
    keyPoint: cleanText(rawItem.keyPoint, MAX_TEXT, '核心观点', repairs) || String(instruction).slice(0, 80),
    pageType,
  }, 0, 3);
  const slide = normalizeSlide({
    ...cleaned,
    id: uid('sl'),
    outlineId: outlineItem.id,
    title: cleaned.title || outlineItem.title,
  }, 0, 3);
  return { slide, outlineItem, summary: finish({ layout: slide.layout }, repairs) };
}

export function parseThemeResult(text, { currentTheme = null } = {}) {
  const repairs = [];
  const root = takeRepairs(parseJsonLoose(extractTextOrRaw(text)), repairs);
  const raw = asObject(root.theme ?? root.design ?? root, 'theme');
  const base = normalizeTheme(currentTheme);
  const next = { ...base, id: 'custom' };
  for (const key of THEME_COLOR_KEYS) {
    const v = String(raw[key] ?? '').trim();
    if (!v) { repair(repairs, `主题颜色 ${key} 缺失，沿用当前值`); continue; }
    if (!HEX_RE.test(v)) { repair(repairs, `主题颜色 ${key}=${v} 非法，沿用当前值`); continue; }
    next[key] = v.length === 4
      ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toUpperCase()
      : v.toUpperCase();
  }
  for (const key of ['titleSize', 'subtitleSize', 'bodySize']) {
    const n = Number(raw[key]);
    if (!Number.isFinite(n) || n <= 0) { repair(repairs, `字号 ${key} 缺失或非法，沿用当前值`); continue; }
    const v = Math.max(12, Math.min(48, Math.round(n)));
    if (v !== n) repair(repairs, `字号 ${key}=${n} 越界，已收敛为 ${v}`);
    next[key] = v;
  }
  next.name = cleanText(raw.name, 40, '主题名称', repairs) || `自定义主题`;
  next.fontFamily = cleanText(raw.fontFamily, 160, '字体', repairs) || base.fontFamily;
  if (!/^[\w\s,'"\-]+$/.test(next.fontFamily)) {
    repair(repairs, '字体串含不安全字符，已回退当前字体');
    next.fontFamily = base.fontFamily;
  }
  const spacing = String(raw.spacing || '');
  next.spacing = ['compact', 'normal', 'spacious'].includes(spacing) ? spacing : base.spacing;
  const decoration = String(raw.decorationStyle || '');
  next.decorationStyle = DECORATION_STYLES.includes(decoration) ? decoration : base.decorationStyle;
  const radius = Number(raw.borderRadius);
  next.borderRadius = Number.isFinite(radius) ? Math.max(0, Math.min(24, Math.round(radius))) : base.borderRadius;
  return {
    theme: normalizeTheme(next),
    summary: finish({ name: next.name, background: next.background }, repairs),
  };
}

/** 允许直接传 SDK 结果对象，也允许传纯文本（便于单测）。 */
function extractTextOrRaw(input) {
  return typeof input === 'string' ? input : extractText(input);
}

export const PARSERS = {
  generateOutline: parseOutlineResult,
  generateSlides: parseSlidesResult,
  regenerateSlide: parseSlidePatchResult,
  editSlideByInstruction: parseSlidePatchResult,
  createSlideByInstruction: parseNewSlideResult,
  generateThemeByInstruction: parseThemeResult,
  changeSlideLayout: parseSlidePatchResult,
};

export { AiError, AI_ERROR_CODES, toAiError, outputError };
