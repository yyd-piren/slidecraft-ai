/**
 * Deck JSON —— SlideCraft AI 唯一数据源。
 * 纯数据模块：不依赖 DOM / Anna SDK，可被 Node 直接引入做单元测试。
 * Mock 模式与真实 AI 模式都必须产出/消费这里定义的结构。
 *
 * 阶段 2.5 变更（兼容式升级，不推倒状态管理）：
 * - deck.theme 从字符串 ID 升级为完整 Theme JSON；旧字符串仍可 normalizeDeck 恢复。
 * - Slide 增加 design（页面级视觉）与 elements（结构化页面元素，含连线）。
 * - 布局从 6 种扩展到 12 种；旧名 cover / visual 自动映射为 title / image-text。
 * - 所有写操作仍严格按 slide.id 定位，绝不因内容修改更换 ID。
 */

export const DECK_VERSION = 2;
export const LEGACY_DECK_VERSION = 1;
export const DECK_STORAGE_KEY = 'slidecraft:deck:v1';
export const AI_LOG_KEY = 'slidecraft:ai-logs:v1';
export const UNDO_STORAGE_KEY = 'slidecraft:undo:v1';

/** 大纲页的「页面类型建议」沿用阶段 2 的六种取值，保证旧草稿与旧行为兼容。 */
export const PAGE_TYPES = ['cover', 'agenda', 'content', 'visual', 'chart', 'summary'];

/** 阶段 2.5 的完整布局体系（12 种），供工作区、渲染器与 AI 契约共用。 */
export const LAYOUT_TYPES = [
  'title', 'agenda', 'content', 'two-column', 'image-text', 'chart',
  'comparison', 'timeline', 'flowchart', 'architecture', 'dashboard', 'summary',
];
export const LAYOUT_LABELS = {
  title: '封面', cover: '封面',
  agenda: '目录',
  content: '普通内容',
  'two-column': '双栏布局',
  'image-text': '图文混排', visual: '图文混排',
  chart: '数据图表',
  comparison: '对比分析',
  timeline: '时间轴',
  flowchart: '流程图',
  architecture: '架构图',
  dashboard: '数据看板',
  summary: '总结',
};

/** 旧布局名 → 新布局名。任何入口写入旧名都会被安全归一化。 */
const LEGACY_LAYOUT_MAP = { cover: 'title', visual: 'image-text' };
export function toLayout(value) {
  if (LEGACY_LAYOUT_MAP[value]) return LEGACY_LAYOUT_MAP[value];
  return LAYOUT_TYPES.includes(value) ? value : 'content';
}

export const DECORATION_STYLES = ['minimal', 'rules', 'grid', 'blocks', 'tech'];
export const EMPHASIS_STYLES = ['balanced', 'title', 'data', 'visual'];
export const DENSITY_STYLES = ['compact', 'normal', 'spacious'];

// 注意：字体串会被放进双引号包裹的 style 属性，必须用单引号，否则会截断 HTML 属性。
const CJK_FONT = "'Microsoft YaHei', 'PingFang SC', 'Hiragino Sans GB', 'Segoe UI', sans-serif";

/** 完整 Theme JSON —— 直接存进 deck.theme，阶段 3 的 PPTX 渲染器可原样消费。 */
function themeShape(o) {
  return {
    id: o.id || 'custom',
    name: o.name || '自定义主题',
    background: o.background || '#FFFFFF',
    primaryColor: o.primaryColor || '#2563EB',
    secondaryColor: o.secondaryColor || '#1D4ED8',
    accentColor: o.accentColor || '#EAF1FF',
    titleColor: o.titleColor || '#0F172A',
    bodyColor: o.bodyColor || '#334155',
    fontFamily: o.fontFamily || CJK_FONT,
    titleSize: Number(o.titleSize) || 32,
    subtitleSize: Number(o.subtitleSize) || 19,
    bodySize: Number(o.bodySize) || 19,
    spacing: o.spacing || 'normal',
    borderRadius: Number(o.borderRadius ?? 6),
    decorationStyle: o.decorationStyle || 'minimal',
  };
}

export const THEME_PRESETS = {
  business: {
    ...themeShape({
      id: 'business', name: '商务简约', background: '#FFFFFF',
      primaryColor: '#2563EB', secondaryColor: '#1D4ED8', accentColor: '#EAF1FF',
      titleColor: '#0F172A', bodyColor: '#334155',
      titleSize: 32, subtitleSize: 19, bodySize: 19,
      spacing: 'normal', borderRadius: 6, decorationStyle: 'minimal',
    }),
    caption: '清晰的层级与克制的蓝色，适合工作汇报、项目提案',
    swatch: ['#2563EB', '#EAF1FF', '#0F172A'],
  },
  academic: {
    ...themeShape({
      id: 'academic', name: '学术答辩', background: '#FFFFFF',
      primaryColor: '#1E4E8C', secondaryColor: '#163A68', accentColor: '#E8EEF7',
      titleColor: '#12233B', bodyColor: '#2C3E55',
      titleSize: 30, subtitleSize: 18, bodySize: 18,
      spacing: 'normal', borderRadius: 4, decorationStyle: 'rules',
    }),
    caption: '稳重的深蓝与规整的网格，适合论文答辩、研究汇报',
    swatch: ['#1E4E8C', '#E8EEF7', '#12233B'],
  },
};
export const THEME_IDS = Object.keys(THEME_PRESETS);

/** 字符串 ID / 部分对象 / 完整对象 → 完整 Theme JSON（不改原对象）。 */
export function normalizeTheme(input) {
  if (typeof input === 'string') {
    return themeShape(THEME_PRESETS[input] || THEME_PRESETS.business);
  }
  const base = THEME_PRESETS[input?.id] || THEME_PRESETS.business;
  return themeShape({ ...base, ...(input && typeof input === 'object' ? input : {}) });
}

export const PURPOSE_OPTIONS = ['工作汇报', '项目提案', '课程讲解', '学术答辩', '培训分享', '产品发布'];
export const LANGUAGE_OPTIONS = ['简体中文', '繁體中文', 'English'];
export const STYLE_OPTIONS = ['专业克制', '逻辑清晰', '轻松活泼', '数据驱动'];
export const DEPTH_OPTIONS = ['精简', '标准', '详尽'];

export function uid(prefix = 'id') {
  let rand;
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    rand = globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  } else {
    rand = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  return `${prefix}_${rand}`;
}

export function copy(obj) {
  return typeof structuredClone === 'function'
    ? structuredClone(obj)
    : JSON.parse(JSON.stringify(obj));
}

export function defaultMeta() {
  return {
    topic: '',
    purpose: '工作汇报',
    audience: '团队成员',
    pageCount: 8,
    language: '简体中文',
    style: '专业克制',
    depth: '标准',
    extra: '',
  };
}

export function defaultDesign() {
  return { emphasis: 'balanced', decoration: 'minimal', density: 'normal', alignment: 'left' };
}

function normalizeDesign(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  return {
    emphasis: EMPHASIS_STYLES.includes(d.emphasis) ? d.emphasis : 'balanced',
    decoration: DECORATION_STYLES.includes(d.decoration) ? d.decoration : 'minimal',
    density: DENSITY_STYLES.includes(d.density) ? d.density : 'normal',
    alignment: d.alignment === 'center' ? 'center' : 'left',
  };
}

function firstText(...vals) {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return '';
}

function itemText(x) {
  if (typeof x === 'string') return x.trim();
  if (typeof x === 'number') return String(x);
  if (x && typeof x === 'object') return firstText(x.text, x.title, x.name, x.label, x.detail, x.value);
  return '';
}

/** 真实模型会把条目写成 items / bullets / points / 一段换行文本，这里统一收敛。 */
function elementItemsOf(e) {
  const raw = e.items ?? e.bullets ?? e.points ?? e.list ?? e.entries ?? e.content ?? e.text;
  const arr = Array.isArray(raw) ? raw : (raw === undefined || raw === null || raw === '' ? [] : [raw]);
  const out = [];
  for (const x of arr) {
    if (typeof x === 'string') {
      const parts = x.split(/[\n；;]+/).map((s) => s.trim()).filter(Boolean);
      if (parts.length > 1) out.push(...parts);
      else if (x.trim()) out.push(x.trim());
    } else {
      const s = itemText(x);
      if (s) out.push(s);
    }
  }
  return out.filter(Boolean).slice(0, 8);
}

/** 结构化页面元素：节点 / 连线 / 阶段 / 指标 / 分栏 / 文本块。 */
export function normalizeElements(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e) => e && typeof e === 'object')
    .map((e) => ({
      id: e.id || uid('el'),
      kind: String(e.kind || 'node'),
      // 兼容模型把标题写成 name / label / heading，把内容写成 bullets / text。
      title: firstText(e.title, e.name, e.label, e.heading, e.header),
      text: String(e.text ?? ''),
      value: firstText(e.value, e.number, e.metric, e.stat),
      from: e.from ? String(e.from) : '',
      to: e.to ? String(e.to) : '',
      level: Number(e.level) || 0,
      items: elementItemsOf(e),
      x: typeof e.x === 'number' ? e.x : null,
      y: typeof e.y === 'number' ? e.y : null,
      w: typeof e.w === 'number' ? e.w : null,
      h: typeof e.h === 'number' ? e.h : null,
    }));
}

export function createDeck(meta = {}) {
  const now = Date.now();
  return {
    id: uid('deck'),
    version: DECK_VERSION,
    meta: { ...defaultMeta(), ...meta },
    theme: normalizeTheme('business'),
    outline: [],
    slides: [],
    createdAt: now,
    updatedAt: now,
    exportInfo: null,
  };
}

/** 按位置推荐页面类型（沿用阶段 2 的取值，normalizeSlide 会映射为体系内布局名）。 */
export function defaultTypeFor(index, total = 8) {
  if (index === 0) return 'cover';
  if (index === 1 && total >= 4) return 'agenda';
  if (index === total - 1 && total > 1) return 'summary';
  const seq = ['content', 'visual', 'chart', 'content', 'visual', 'content', 'chart', 'content'];
  return seq[Math.max(0, index - 2) % seq.length];
}

export function normalizeOutlineItem(raw = {}, index = 0, total = 8) {
  return {
    id: raw.id || uid('out'),
    chapter: String(raw.chapter ?? ''),
    title: String(raw.title ?? ''),
    keyPoint: String(raw.keyPoint ?? ''),
    pageType: PAGE_TYPES.includes(raw.pageType) ? raw.pageType : defaultTypeFor(index, total),
  };
}

export function normalizeSlide(raw = {}, index = 0, total = 8) {
  // type 与 layout 保持同源；旧名（cover / visual）在此统一映射为新布局名。
  const layout = toLayout(raw.type || raw.layout || defaultTypeFor(index, total));
  const points = Array.isArray(raw.points)
    ? raw.points.map((p) =>
        typeof p === 'string'
          ? { text: p, detail: '' }
          : { text: String(p?.text ?? ''), detail: String(p?.detail ?? '') },
      )
    : [];
  return {
    id: raw.id || uid('sl'),
    outlineId: raw.outlineId || null,
    type: layout,
    layout,
    title: String(raw.title ?? ''),
    subtitle: String(raw.subtitle ?? ''),
    points,
    evidence: String(raw.evidence ?? ''),
    visualHint: String(raw.visualHint ?? ''),
    chart: raw.chart && typeof raw.chart === 'object' && !Array.isArray(raw.chart) ? raw.chart : null,
    notes: String(raw.notes ?? ''),
    chapter: String(raw.chapter ?? ''),
    design: normalizeDesign(raw.design),
    elements: normalizeElements(raw.elements),
    // 页面装饰（内置图标 / Anna AI 配图）：渲染层会用 normalizeDecorations 做安全归一化，
    // 这里只做轻量保留，避免 deck.js 与 decorations.js 产生循环依赖。
    decorations: Array.isArray(raw.decorations) ? raw.decorations.slice(0, 8) : [],
    // 自由布局：blocks 是 HTML 预览与 PPTX 导出共用的唯一坐标来源；
    // freeLayout 为 false 时完全走原来的 12 种自动构图，保证旧草稿与全部回归不变。
    freeLayout: raw.freeLayout === true,
    blocks: Array.isArray(raw.blocks) ? raw.blocks.slice(0, 24) : [],
  };
}

export function validateDeck(input) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['deck 不是对象'] };
  }
  if (!input.id) errors.push('缺少 id');
  if (input.version !== DECK_VERSION && input.version !== LEGACY_DECK_VERSION) {
    errors.push(`version 不匹配（期望 ${DECK_VERSION} 或旧版 ${LEGACY_DECK_VERSION}）`);
  }
  if (!input.meta || typeof input.meta.topic !== 'string') errors.push('meta.topic 无效');
  const th = input.theme;
  if (typeof th === 'string') {
    if (!THEME_IDS.includes(th)) errors.push('theme 无效');
  } else if (!th || typeof th !== 'object' || !th.name || !th.primaryColor) {
    errors.push('theme 无效（需为完整 Theme JSON）');
  }
  if (!Array.isArray(input.outline)) errors.push('outline 不是数组');
  if (!Array.isArray(input.slides)) errors.push('slides 不是数组');
  if (Array.isArray(input.slides)) {
    const seen = new Set();
    input.slides.forEach((s, i) => {
      if (!s || !s.id) errors.push(`slides[${i}] 缺少 id`);
      else if (seen.has(s.id)) errors.push(`slides[${i}] id 重复：${s.id}`);
      seen.add(s.id);
    });
  }
  return { ok: errors.length === 0, errors };
}

/** 恢复旧草稿 / 校验 AI 返回值时统一归一化；保留所有 id 与已有内容，不重建页面数据。 */
export function normalizeDeck(input) {
  if (!input || typeof input !== 'object') return null;
  const outline = Array.isArray(input.outline) ? input.outline : [];
  const slides = Array.isArray(input.slides) ? input.slides : [];
  return {
    ...input,
    version: DECK_VERSION,
    theme: normalizeTheme(input.theme),
    outline: outline.map((o, i) => normalizeOutlineItem(o, i, outline.length)),
    slides: slides.map((s, i) => normalizeSlide(s, i, slides.length)),
  };
}

function touch(deck, patch) {
  return { ...deck, ...patch, updatedAt: Date.now() };
}

function requireId(list, id, label) {
  const idx = list.findIndex((x) => x && x.id === id);
  if (idx < 0) throw new Error(`找不到${label}：${id}`);
  return idx;
}

function moved(list, idx, dir) {
  const next = idx + dir;
  if (next < 0 || next >= list.length) return list;
  const out = list.slice();
  [out[idx], out[next]] = [out[next], out[idx]];
  return out;
}

// ---- 单页精确更新：所有写操作都按 id 定位，绝不使用数组下标作为唯一标识 ----

export function patchSlide(deck, slideId, patch) {
  const idx = requireId(deck.slides, slideId, '页面');
  const slides = deck.slides.slice();
  slides[idx] = normalizeSlide({ ...slides[idx], ...patch, id: slides[idx].id }, idx, deck.slides.length);
  return touch(deck, { slides });
}

/** 撤销用：整页快照原样还原（不再 normalize，保证逐字节一致）。 */
export function applySlideSnapshot(deck, slideId, snapshot) {
  const idx = requireId(deck.slides, slideId, '页面');
  const slides = deck.slides.slice();
  slides[idx] = copy(snapshot);
  return touch(deck, { slides });
}

export function patchOutlineItem(deck, itemId, patch) {
  const idx = requireId(deck.outline, itemId, '大纲条目');
  const outline = deck.outline.slice();
  outline[idx] = normalizeOutlineItem({ ...outline[idx], ...patch, id: outline[idx].id }, idx, deck.outline.length);
  // 页面类型是结构性属性，立即同步到已生成的页面；文字内容仍由「生成全部内容」统一刷新。
  const slides =
    patch.pageType && PAGE_TYPES.includes(patch.pageType)
      ? deck.slides.map((s) =>
          s.outlineId === itemId ? { ...s, type: toLayout(patch.pageType), layout: toLayout(patch.pageType) } : s,
        )
      : deck.slides;
  return touch(deck, { outline, slides });
}

export function addOutlineItem(deck, afterId = null) {
  const outline = deck.outline.slice();
  const at = afterId ? requireId(outline, afterId, '大纲条目') + 1 : outline.length;
  const item = normalizeOutlineItem(
    { id: uid('out'), chapter: '新章节', title: '新页面标题', keyPoint: '补充这一页的核心观点', pageType: 'content' },
    at,
    outline.length + 1,
  );
  outline.splice(at, 0, item);
  const base = touch(deck, { outline, meta: { ...deck.meta, pageCount: outline.length } });

  // 已经生成过页面内容时同步插入占位页，保证大纲视图与工作区视图始终一一对应。
  if (!deck.slides.length) return base;
  const slides = base.slides.slice();
  const afterSlideIdx = afterId ? slides.findIndex((s) => s.outlineId === afterId) : -1;
  const atSlide = afterSlideIdx >= 0 ? afterSlideIdx + 1 : slides.length;
  slides.splice(
    atSlide,
    0,
    normalizeSlide(
      {
        id: uid('sl'),
        outlineId: item.id,
        type: item.pageType,
        title: item.title,
        subtitle: '',
        points: [{ text: '待补充的要点', detail: '' }],
        chapter: item.chapter,
        notes: '',
      },
      atSlide,
      slides.length + 1,
    ),
  );
  return touch(base, { slides });
}

export function removeOutlineItem(deck, itemId) {
  const idx = requireId(deck.outline, itemId, '大纲条目');
  const outline = deck.outline.slice();
  outline.splice(idx, 1);
  const slides = deck.slides.filter((s) => s.outlineId !== itemId);
  return touch(deck, { outline, slides, meta: { ...deck.meta, pageCount: outline.length } });
}

export function moveOutlineItem(deck, itemId, dir) {
  const idx = requireId(deck.outline, itemId, '大纲条目');
  const outline = moved(deck.outline, idx, dir);
  const rank = new Map(outline.map((o, i) => [o.id, i]));
  const slides = deck.slides
    .slice()
    .sort((a, b) => (rank.get(a.outlineId) ?? 999) - (rank.get(b.outlineId) ?? 999));
  return touch(deck, { outline, slides });
}

/** 工作区新增一页：复用大纲新增逻辑（两者联动），调用方只需取回新 slide.id 选中即可。 */
export function addSlide(deck, afterId = null) {
  const afterOutlineId = afterId
    ? deck.slides.find((s) => s.id === afterId)?.outlineId ?? null
    : null;
  return addOutlineItem(deck, afterOutlineId);
}

/** AI 按描述新增页面：插入指定位置，并同步创建大纲条目保持两视图一致。 */
export function insertSlideAt(deck, at, rawSlide, rawOutlineItem = null) {
  const slides = deck.slides.slice();
  const outline = deck.outline.slice();
  const pos = Math.max(0, Math.min(at, slides.length));
  const slide = normalizeSlide(rawSlide, pos, slides.length + 1);
  if (rawOutlineItem) {
    const item = normalizeOutlineItem(
      { ...rawOutlineItem, pageType: slide.layout },
      pos,
      outline.length + 1,
    );
    slide.outlineId = item.id;
    outline.splice(Math.max(0, Math.min(pos, outline.length)), 0, item);
  }
  slides.splice(pos, 0, slide);
  return touch(deck, {
    slides,
    outline,
    meta: { ...deck.meta, pageCount: slides.length },
  });
}

export function removeSlide(deck, slideId) {
  const idx = requireId(deck.slides, slideId, '页面');
  const outlineId = deck.slides[idx].outlineId;
  return touch(deck, {
    slides: deck.slides.filter((s) => s.id !== slideId),
    outline: outlineId ? deck.outline.filter((o) => o.id !== outlineId) : deck.outline,
    meta: { ...deck.meta, pageCount: Math.max(0, deck.meta.pageCount - 1) },
  });
}

export function moveSlide(deck, slideId, dir) {
  const idx = requireId(deck.slides, slideId, '页面');
  const slides = moved(deck.slides, idx, dir);
  const order = new Map(slides.map((s, i) => [s.outlineId, i]));
  const outline = deck.outline.slice().sort(
    (a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999),
  );
  return touch(deck, { slides, outline });
}

export function addPoint(deck, slideId) {
  const idx = requireId(deck.slides, slideId, '页面');
  const points = [...deck.slides[idx].points, { text: '新的要点', detail: '' }];
  return patchSlide(deck, slideId, { points });
}

export function removePoint(deck, slideId, pointIndex) {
  const idx = requireId(deck.slides, slideId, '页面');
  const points = deck.slides[idx].points.filter((_, i) => i !== pointIndex);
  return patchSlide(deck, slideId, { points });
}

/** 表单/属性面板的统一绑定写口：所有编辑都按 id 落到精确的字段上。 */
export function setFieldByBind(deck, bind, value) {
  const p = String(bind).split(':');
  if (p[0] === 'meta' && p.length === 2) {
    const v = p[1] === 'pageCount' ? Math.max(1, Math.min(30, Number(value) || 1)) : value;
    return touch(deck, { meta: { ...deck.meta, [p[1]]: v } });
  }
  if (p[0] === 'outline' && p.length >= 3) return patchOutlineItem(deck, p[1], { [p[2]]: value });
  if (p[0] === 'slide' && p.length >= 3) {
    if (p[2] === 'points') {
      const idx = requireId(deck.slides, p[1], '页面');
      const points = deck.slides[idx].points.map((pt, i) =>
        i === Number(p[3]) ? { ...pt, [p[4] || 'text']: value } : pt,
      );
      return patchSlide(deck, p[1], { points });
    }
    if (p[2] === 'design' && p.length >= 4) {
      const idx = requireId(deck.slides, p[1], '页面');
      return patchSlide(deck, p[1], { design: { ...deck.slides[idx].design, [p[3]]: value } });
    }
    return patchSlide(deck, p[1], { [p[2]]: value });
  }
  throw new Error(`未知的数据绑定：${bind}`);
}

/** 把 AI 返回的页面数组合并进 Deck：按 outlineId 复用已有 slide.id。 */
export function mergeGeneratedSlides(deck, generated) {
  const idByOutline = new Map(deck.slides.filter((s) => s.outlineId).map((s) => [s.outlineId, s.id]));
  const decoByOutline = new Map(deck.slides.filter((s) => s.outlineId).map((s) => [s.outlineId, s.decorations || []]));
  const freeByOutline = new Map(deck.slides.filter((s) => s.outlineId).map((s) => [s.outlineId, s.freeLayout === true]));
  const slides = generated.map((g, i) =>
    normalizeSlide(
      {
        ...g,
        id: idByOutline.get(g.outlineId) || g.id || uid('sl'),
        // 重新生成全部页面时，用户手动插入的图标/配图不应被静默丢弃。
        decorations: Array.isArray(g.decorations) && g.decorations.length
          ? g.decorations
          : (decoByOutline.get(g.outlineId) || []),
        // 重新生成内容后沿用「自由布局」开关；旧坐标不沿用（渲染层会按新内容重建默认块）。
        freeLayout: g.freeLayout === true || freeByOutline.get(g.outlineId) === true,
        blocks: Array.isArray(g.blocks) ? g.blocks : [],
      },
      i,
      generated.length,
    ),
  );
  return touch(deck, { slides });
}

/** 修改前后对比用的轻量摘要，不含大段正文。 */
export function slideSummary(slide) {
  if (!slide) return null;
  const all = slide.elements || [];
  return {
    id: slide.id,
    title: slide.title,
    layout: slide.layout,
    points: (slide.points || []).length,
    elements: all.length,
    connectors: all.filter((e) => e.kind === 'connector').length,
    chars:
      String(slide.title || '').length +
      (slide.points || []).reduce((n, p) => n + String(p.text || '').length + String(p.detail || '').length, 0),
  };
}
