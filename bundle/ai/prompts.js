/**
 * Prompt 管理（阶段 4）—— 所有 Prompt 集中在本文件，业务层与 UI 不拼接 Prompt 字符串。
 *
 * 依据：Anna SDK 0.27.0 的 anna.llm.complete({messages, maxTokens, temperature, systemPrompt})。
 * 平台没有可用的「结构化输出 / JSON schema」参数，因此采用明确 JSON Prompt + 本地严格校验
 * （见 parser.js）。所有 maxTokens 都低于平台默认单次上限 4096，避免静默 clamp。
 */
import { LAYOUT_TYPES, PAGE_TYPES, normalizeTheme } from '../core/deck.js';

export const SYSTEM_PERSONA = [
  '你是一名专业的 PPT 内容策划与演示文稿设计专家，擅长把主题拆解成逻辑清晰、每页只讲一个核心观点的演示结构。',
  '你的输出会被程序直接解析并写入演示文稿数据，因此必须严格遵守给定的 JSON 结构。',
].join('\n');

/** 与 core/deck.js 的真实定义保持一致；禁止模型发明渲染器不支持的类型。 */
export const LAYOUT_LIST = LAYOUT_TYPES.join(' / ');
export const PAGE_TYPE_LIST = PAGE_TYPES.join(' / ');
export const ELEMENT_KINDS = [
  'layer', 'node', 'connector', 'step', 'column', 'metric', 'bar', 'note', 'label',
  'module', 'edge', 'text', 'shape', 'chart', 'image',
].join(' / ');

export const DECK_CONTRACT = [
  '【当前应用的数据结构约束（Deck v2）】',
  `- 页面布局 layout 只能取这 ${LAYOUT_TYPES.length} 种之一：${LAYOUT_LIST}。不得发明其它名称，也不要用 cover / visual 这类旧名。`,
  `- 大纲的 pageType 只能取：${PAGE_TYPE_LIST}。`,
  `- 页面元素 elements[].kind 只能取：${ELEMENT_KINDS}。connector / edge 用 from、to 引用同页其它元素的 id。`,
  '- 每条要点形如 {"text":"短标题","detail":"一句说明"}；text 不超过 60 字，detail 不超过 120 字。',
  '- 标题不超过 60 字；一页 2–4 条要点；页脚/备注不超过 160 字。不要为了填满页面写冗余套话。',
  '- Theme 必须包含 background / primaryColor / secondaryColor / accentColor / titleColor / bodyColor（均为 #RRGGBB）、fontFamily、titleSize / subtitleSize / bodySize（数字，20–48）、spacing（compact|normal|spacious）、borderRadius（数字）、decorationStyle（minimal|rules|grid|blocks|tech）。',
  '- 颜色必须是 6 位十六进制；深色背景时 titleColor / bodyColor 要用浅色，保证可读。',
  '- 元素坐标 x/y/w/h 若提供，必须是 0～1 的归一化小数；也可以完全省略。',
].join('\n');

export const OUTPUT_RULE = [
  '【输出规则（必须严格遵守）】',
  '只输出一个合法的 JSON 对象。不要输出 Markdown 代码块、不要加解释文字、不要加注释、不要输出多个 JSON。',
  '中文内容要自然、准确、专业，避免空洞套话；不同页面应有明显不同的信息结构与呈现方式。',
  '不要修改任何未被要求修改的字段；不要输出 id 字段（除非任务明确要求）。',
].join('\n');

export const PROMPT_TASKS = [
  'generateOutline', 'generateSlides', 'regenerateSlide', 'editSlideByInstruction',
  'createSlideByInstruction', 'generateThemeByInstruction', 'changeSlideLayout',
];

/**
 * 逐页生成分批（串行），控制单次输入输出长度与 CU 消耗。
 * 实测 4 页批量输出约 1780 tokens；maxTokens 已提高到 3200（平台单次默认上限 4096），
 * 留足余量避免 JSON 被截断导致解析失败。
 */
export const SLIDES_BATCH_SIZE = 4;

function compact(value, limit = 6000) {
  let s;
  try { s = JSON.stringify(value ?? null); } catch { s = 'null'; }
  if (s.length <= limit) return s;
  return `${s.slice(0, limit)}…（已按长度上限裁剪）`;
}

function briefSlide(slide) {
  if (!slide) return null;
  // 业务层可能传完整 Slide（points 为数组），也可能传 slideSummary（points 为数量）。
  // 两种形态都要兼容，否则真实 Provider 构造 Prompt 时会抛错。
  const points = Array.isArray(slide.points)
    ? slide.points.slice(0, 4).map((p) => (typeof p === 'string' ? p : p?.text ?? ''))
    : [];
  return {
    id: slide.id ?? null,
    title: slide.title ?? '',
    layout: slide.layout || slide.type || '',
    points,
    chapter: slide.chapter ?? '',
  };
}

function build(task, systemExtra, userBody, maxTokens) {
  return {
    task,
    systemPrompt: `${SYSTEM_PERSONA}\n\n${DECK_CONTRACT}\n\n${systemExtra}\n\n${OUTPUT_RULE}`,
    messages: [{ role: 'user', content: userBody }],
    maxTokens,
    temperature: 0.4,
  };
}

/** 1. 大纲生成：结构化页面清单，直接进现有大纲编辑界面。 */
export function buildOutlinePrompt({ meta = {} } = {}) {
  const count = Math.max(3, Math.min(20, Number(meta.pageCount) || 8));
  return build(
    'generateOutline',
    [
      '【任务】根据下面的需求生成 PPT 大纲。',
      '要求：每页只讲一个核心观点；章节顺序有起承转合；第 1 页为封面、第 2 页为目录、最后一页为总结；',
      '中间页面根据内容需要安排论证、数据、路径、对比等，不要让所有页面都是「标题 + 三条要点」。',
      'keyPoint 要写清这一页的核心观点与建议的呈现方式（例如「用时间轴展示五个阶段」），供后续页面生成参考。',
      `只输出：{"outline":[{"chapter":"章节","title":"页面标题","keyPoint":"核心观点","pageType":"${PAGE_TYPES[0]}"}]}，数组长度必须恰好为 ${count}。`,
    ].join('\n'),
    `【用户需求】\n${compact({
      topic: meta.topic, purpose: meta.purpose, audience: meta.audience,
      pageCount: count, language: meta.language, style: meta.style,
      depth: meta.depth, extra: meta.extra,
    })}`,
    1600,
  );
}

/** 2. 页面内容生成：按大纲分批产出完整 Slide 数据。 */
export function buildSlidesPrompt({ meta = {}, outline = [], batch = [], existingSlides = [] } = {}) {
  const outlineBrief = batch.map((o) => ({
    id: o.id, chapter: o.chapter, title: o.title, keyPoint: o.keyPoint, pageType: o.pageType,
  }));
  const existing = existingSlides
    .filter((s) => batch.some((o) => o.id === s.outlineId))
    .map((s) => ({ outlineId: s.outlineId, title: s.title }));
  return build(
    'generateSlides',
    [
      '【任务】根据确认后的大纲，为下面这批页面生成完整 Slide 数据。',
      `每页的 outlineId 必须与给定大纲条目的 id 完全一致（共 ${batch.length} 页，顺序一致）。`,
      '根据内容主动选择合适的 layout：论证用 two-column / comparison，阶段用 timeline，流程用 flowchart，',
      '系统分层用 architecture，数字表现用 chart / dashboard，配图说明用 image-text，收束用 summary。',
      '需要结构化图形的页面必须同时给出 elements：',
      'architecture 用 3–4 个 layer + connector 连线；flowchart 用 node + connector；',
      'timeline 用 step；comparison / two-column 用 column；dashboard 用 metric；chart 用 bar 或 chart。',
      'chart / dashboard 页面可给出 chart 对象 {"type":"bar","labels":[...],"series":[{"name":"...","values":[...]}]}。',
      '每页要有 evidence（一句数据或案例）、visualHint（呈现建议）、notes（演讲者备注）、design（视觉层级）。',
      '字段名必须严格使用 points（数组，元素为 {"text","detail"}）；禁止使用 bullets / items / keyPoints。',
      '不要输出 id、pageType 等额外字段；不要输出省略号或占位符；字符串必须用双引号，不要写注释。',
      '必须一次性输出完整、闭合的 JSON，不要在最后一个对象处省略内容。',
      `只输出一个形如下例的 JSON 对象（slides 数组长度必须恰好为 ${batch.length}）：`,
      '{"slides":[{"outlineId":"<对应大纲 id>","layout":"content","title":"页面标题","subtitle":"",' +
      '"points":[{"text":"要点","detail":"说明"}],"evidence":"","visualHint":"","notes":"","chapter":"",' +
      '"design":{"emphasis":"balanced","decoration":"minimal","density":"normal","alignment":"left"},' +
      '"elements":[],"chart":null}]}',
    ].join('\n'),
    [
      '【整份 PPT 需求】', compact({
        topic: meta.topic, purpose: meta.purpose, audience: meta.audience,
        language: meta.language, style: meta.style, depth: meta.depth, extra: meta.extra,
      }),
      '\n【本批大纲（必须逐条对应）】', compact(outlineBrief),
      '\n【已有页面标题（可沿用衔接，不要照抄内容）】', compact(existing),
      '\n【完整大纲顺序（仅作上下文）】', compact(outline.map((o) => ({ id: o.id, title: o.title })), 2500),
    ].join('\n'),
    3200,
  );
}

/** 3. 重新生成单页（按原始大纲与上下文）。 */
export function buildRegenerateSlidePrompt({ meta = {}, slide, outlineItem, prevSlide = null, nextSlide = null, theme = null } = {}) {
  return build(
    'regenerateSlide',
    [
      '【任务】按原始大纲重新撰写这一页的内容（内容表达要更新，但仍紧扣大纲的核心观点）。',
      '只输出：{"patch":{...要替换的字段...}}。patch 内不得出现 id。',
      'patch 可包含 layout/type/title/subtitle/points/evidence/visualHint/notes/design/elements/chart。',
      '未列出的字段会保留原值；不要输出与当前页完全相同的文字。',
    ].join('\n'),
    [
      '【整份 PPT 需求】', compact({ topic: meta.topic, purpose: meta.purpose, audience: meta.audience, language: meta.language }),
      '\n【本页对应的大纲条目】', compact(outlineItem),
      '\n【当前页完整数据】', compact(slide),
      '\n【前一页 / 后一页】', compact({ prev: briefSlide(prevSlide), next: briefSlide(nextSlide) }),
      '\n【当前全局主题（不要输出主题字段）】', compact(theme ? {
        name: normalizeTheme(theme).name,
        background: normalizeTheme(theme).background,
        decorationStyle: normalizeTheme(theme).decorationStyle,
      } : null),
    ].join('\n'),
    1800,
  );
}

/** 4. 自然语言修改单页：只改目标页，不改 ID，不改其它页。 */
export function buildEditSlidePrompt({ instruction = '', slide, meta = {}, theme = null, prevSlide = null, nextSlide = null, outlineItem = null } = {}) {
  return build(
    'editSlideByInstruction',
    [
      '【任务】严格按用户的自然语言指令修改当前这一页，只输出这一页的变更字段。',
      '只输出：{"patch":{...}}。patch 内绝对不能出现 id（页面 ID 由程序保留）。',
      '若指令要求改变结构，必须同步修改 layout/type 与 elements，让图形结构真实变化，而不是只改文字。',
      '指令要求「精简」就减少要点条数与字数；要求「丰富」就补充论据或数据；要求「改风格」就调整 design。',
      '未要求修改的内容尽量保留；不要输出与本页无关的新页面。',
    ].join('\n'),
    [
      '【用户修改指令】', String(instruction).slice(0, 800),
      '\n【整份 PPT 需求】', compact({ topic: meta.topic, purpose: meta.purpose, audience: meta.audience, language: meta.language }),
      '\n【当前页完整数据】', compact(slide),
      '\n【本页大纲条目】', compact(outlineItem),
      '\n【前一页 / 后一页（避免内容重复）】', compact({ prev: briefSlide(prevSlide), next: briefSlide(nextSlide) }),
      '\n【当前全局主题】', compact(theme ? {
        name: normalizeTheme(theme).name,
        background: normalizeTheme(theme).background,
        primaryColor: normalizeTheme(theme).primaryColor,
      } : null),
    ].join('\n'),
    1800,
  );
}

/** 5. 自然语言新增页面：产出完整新页 + 对应大纲条目。 */
export function buildAddSlidePrompt({ instruction = '', meta = {}, theme = null, prevSlide = null, nextSlide = null } = {}) {
  return build(
    'createSlideByInstruction',
    [
      '【任务】根据用户描述生成一张全新的页面，内容要与前后页自然衔接，不能与已有页面重复。',
      '只输出：{"slide":{...完整 Slide，不含 id...},"outlineItem":{"chapter":"...","title":"...","keyPoint":"...","pageType":"content"}}。',
      '根据描述选择合适 layout 并给出配套 elements；不要输出 id 字段（程序会生成唯一 ID）。',
    ].join('\n'),
    [
      '【用户对新页面的描述】', String(instruction).slice(0, 800),
      '\n【整份 PPT 需求】', compact({ topic: meta.topic, purpose: meta.purpose, audience: meta.audience, language: meta.language, style: meta.style }),
      '\n【前一页 / 后一页】', compact({ prev: briefSlide(prevSlide), next: briefSlide(nextSlide) }),
      '\n【当前全局主题】', compact(theme ? { name: normalizeTheme(theme).name, background: normalizeTheme(theme).background } : null),
    ].join('\n'),
    1600,
  );
}

/** 6. 自然语言修改全局主题：只返回 Theme JSON。 */
export function buildThemePrompt({ instruction = '', currentTheme = null } = {}) {
  return build(
    'generateThemeByInstruction',
    [
      '【任务】根据用户描述重新设计整套 PPT 的视觉主题。',
      '只输出：{"theme":{...完整 Theme...}}，不要输出任何 Slide 或页面内容。',
      '深色背景必须配浅色 titleColor / bodyColor；所有颜色用 6 位 #RRGGBB；字号为 20–48 的数字。',
      'fontFamily 优先使用常见中文字体串，例如 "Microsoft YaHei", "PingFang SC", sans-serif。',
      '未明确要求的字段沿用当前主题的值（已在输入中给出）。',
    ].join('\n'),
    [
      '【用户的视觉风格描述】', String(instruction).slice(0, 800),
      '\n【当前主题（作为字段兜底）】', compact(normalizeTheme(currentTheme)),
    ].join('\n'),
    1000,
  );
}

/** 7. 只切换布局：保留原文，重建结构元素。 */
export function buildChangeLayoutPrompt({ slide, layout, instruction = '' } = {}) {
  return build(
    'changeSlideLayout',
    [
      '【任务】把当前页改成指定布局，只调整结构与视觉元素，保留原有文字、图表与备注。',
      `目标布局：${layout}。只输出：{"patch":{"type":"${layout}","layout":"${layout}","elements":[...],"visualHint":"...","design":{...}}}。`,
      'patch 内不得出现 id、title、points、evidence、notes、chart（这些字段由程序保留原值）。',
      'elements 要与目标布局匹配，且 connector 的 from/to 必须引用本页 elements 内存在的 id。',
    ].join('\n'),
    [
      '【当前页完整数据（文字需保留）】', compact(slide),
      '\n【补充说明】', String(instruction || '（无）').slice(0, 300),
    ].join('\n'),
    1600,
  );
}

export const PROMPT_BUILDERS = {
  generateOutline: buildOutlinePrompt,
  generateSlides: buildSlidesPrompt,
  regenerateSlide: buildRegenerateSlidePrompt,
  editSlideByInstruction: buildEditSlidePrompt,
  createSlideByInstruction: buildAddSlidePrompt,
  generateThemeByInstruction: buildThemePrompt,
  changeSlideLayout: buildChangeLayoutPrompt,
};
