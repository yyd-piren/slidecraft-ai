/**
 * 阶段 2.5 的 Mock AI 提供者（仍然不调用任何 Anna Host API，CU 消耗为 0）。
 *
 * 七个业务方法与阶段 4 的真实 AI 提供者共用同一契约，返回同一套 Deck 数据片段；
 * 业务层（core/actions.js）不区分 Mock / Real，阶段 4 只需替换注入的 provider。
 *
 * 意图解析：editSlideByInstruction 按中文关键词识别「架构图 / 流程图 / 时间轴 /
 * 对比 / 双栏 / 看板 / 图表 / 精简 / 视觉层次 / 装饰」等意图，返回**结构明显不同**
 * 的 layout + elements + design，而不是随机改几个文字字段。
 */
import {
  uid, defaultTypeFor, normalizeOutlineItem, normalizeSlide,
  normalizeTheme, toLayout, LAYOUT_LABELS,
} from '../core/deck.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const cut = (s, n) => (String(s || '').length > n ? `${String(s).slice(0, n)}…` : String(s || ''));

// ---------------- 常用修改建议 / 主题示例（UI 与 Mock 共用） ----------------

export const SLIDE_EDIT_SUGGESTIONS = [
  '精简文字，突出核心观点',
  '将文字列表改为图表',
  '将普通内容改为流程图',
  '将页面改为左右双栏布局',
  '增强页面视觉层次',
  '增加关键数据展示',
  '减少装饰，让页面更简洁',
  '改成三层技术架构图，突出前端、业务服务和数据存储之间的调用关系',
  '改成横向时间轴，展示项目从立项到上线的五个阶段',
  '改成左右对比布局，左侧展示传统方案，右侧展示 AI 方案',
];

export const THEME_PROMPT_EXAMPLES = [
  '将整套 PPT 改为深色科技风，采用深蓝背景和紫色点缀，标题更加突出，正文保持简洁。',
  '将整套 PPT 改为学术答辩风格，使用白色背景、深蓝标题和简洁的数据图表。',
  '把整套 PPT 改成高端商务咨询风格，减少装饰，使用大标题和清晰的数据对比。',
];

// ---------------- 意图解析 ----------------

const RULES = [
  { key: 'architecture', re: /架构|三层|分层|调用关系|技术栈|层次结构|层级/ },
  { key: 'flowchart', re: /流程图|流程|流转|步骤图|节点连线/ },
  { key: 'timeline', re: /时间轴|时间线|里程碑|五个阶段|阶段展示/ },
  { key: 'comparison', re: /对比|比较|对照|\bvs\b|左右对比/ },
  { key: 'two-column', re: /双栏|两栏|左右布局|左右双栏|分栏/ },
  { key: 'dashboard', re: /看板|数据展示|关键数据|指标卡|数据卡片/ },
  { key: 'chart', re: /图表|柱状|数据图|可视化|曲线|柱图/ },
  { key: 'image-text', re: /图文|配图|图片/ },
];

export function parseIntent(instruction = '') {
  const text = String(instruction || '');
  let layout = null;
  for (const rule of RULES) {
    if (rule.re.test(text)) { layout = rule.key; break; }
  }
  return {
    raw: text,
    layout,
    simplify: /精简|凝练|删减|减少文字|缩短|去掉多余|更简洁的文字/.test(text),
    minimal: /减少装饰|去装饰|极简|更多留白|更简洁/.test(text),
    emphasis: /视觉层次|层次感|突出标题|强调标题|大标题|更加突出|高端/.test(text),
    darkTech: /深色|暗色|科技风|紫色|深蓝背景/.test(text),
    academic: /学术|答辩|白色背景|深蓝标题/.test(text),
    consulting: /商务咨询|咨询风|减少装饰|清晰的数据对比/.test(text),
    moreData: /增加.*数据|关键数据|数据对比|补充数据/.test(text),
  };
}

// ---------------- 结构化元素生成（不同意图 → 明显不同的页面结构） ----------------

function architectureElements() {
  return [
    { id: 'L1', kind: 'layer', title: '前端 / 交互层', items: ['Web 编辑工作区', '移动端预览', '统一 API 网关'] },
    { id: 'L2', kind: 'layer', title: '业务服务层', items: ['任务编排服务', '内容生成服务', '权限与审计'] },
    { id: 'L3', kind: 'layer', title: '数据与存储层', items: ['结构化 Deck 库', '向量检索引擎', '文件对象存储'] },
    { id: 'C1', kind: 'connector', from: 'L1', to: 'L2', title: 'HTTPS / RPC 调用' },
    { id: 'C2', kind: 'connector', from: 'L2', to: 'L3', title: '读写 / 检索' },
  ];
}

function flowElements(slide) {
  const texts = (slide.points || []).map((p) => p.text).filter(Boolean);
  const names = texts.length >= 3 ? texts.slice(0, 4) : ['需求输入', '意图解析', '内容编排', '结果交付'];
  const nodes = names.map((t, i) => ({
    id: `N${i}`, kind: 'node', title: cut(t, 14),
    text: (slide.points || [])[i]?.detail || `环节 ${i + 1}`, level: i,
  }));
  const links = nodes.slice(0, -1).map((n, i) => ({
    id: `F${i}`, kind: 'connector', from: n.id, to: nodes[i + 1].id, title: '顺序流转',
  }));
  return [...nodes, ...links];
}

function timelineElements() {
  return ['立项', '需求调研', '方案设计', '开发验证', '正式上线'].map((name, i) => ({
    id: `T${i}`, kind: 'step', title: name,
    text: ['明确目标与范围', '访谈与资料归集', '结构与视觉设计', '联调与验收', '发布与复盘'][i],
  }));
}

function comparisonElements(instruction) {
  const isAI = /AI|智能|传统/.test(instruction || '');
  return [
    { id: 'A', kind: 'column', title: isAI ? '传统方案' : '方案 A', items: ['人工整理，耗时较长', '信息分散，难以复用', '结果依赖个人经验'] },
    { id: 'B', kind: 'column', title: isAI ? 'AI 方案' : '方案 B', items: ['自动生成，秒级完成', '结构化沉淀，可复用', '结果稳定、可追溯'] },
  ];
}

function twoColumnElements(slide) {
  const texts = (slide.points || []).map((p) => p.text).filter(Boolean);
  return [
    { id: 'A', kind: 'column', title: '核心观点', items: texts.slice(0, 3).length ? texts.slice(0, 3) : ['目标与背景', '关键结论', '适用范围'] },
    { id: 'B', kind: 'column', title: '支撑依据', items: texts.slice(3, 6).length ? texts.slice(3, 6) : ['数据来源', '实施路径', '衡量指标'] },
  ];
}

function dashboardElements(slide) {
  const texts = (slide.points || []).map((p) => p.text).filter(Boolean);
  const names = texts.length >= 3 ? texts.slice(0, 3) : ['覆盖团队', '平均提效', '交付周期'];
  return [
    { id: 'M1', kind: 'metric', title: cut(names[0], 12), value: '86' },
    { id: 'M2', kind: 'metric', title: cut(names[1], 12), value: '42%' },
    { id: 'M3', kind: 'metric', title: cut(names[2], 12), value: '3.2×' },
  ];
}

export function buildElements(layout, slide, instruction = '') {
  switch (layout) {
    case 'architecture': return architectureElements();
    case 'flowchart': return flowElements(slide);
    case 'timeline': return timelineElements();
    case 'comparison': return comparisonElements(instruction);
    case 'two-column': return twoColumnElements(slide);
    case 'dashboard': return dashboardElements(slide);
    default: return [];
  }
}

function layoutTitle(layout, slide, intent) {
  const base = String(slide.title || '本页内容').replace(/[·｜|].*$/, '').trim();
  const suffix = {
    architecture: '技术架构与调用关系',
    flowchart: '流程与执行路径',
    timeline: '阶段路线图',
    comparison: '方案对比分析',
    'two-column': '要点与依据',
    chart: '数据表现',
    dashboard: '关键指标看板',
    'image-text': '结构示意',
  }[layout];
  if (suffix) return `${cut(base, 18)} · ${suffix}`;
  if (intent.simplify) return cut(base, 16) || '核心结论';
  if (intent.emphasis) return `${cut(base, 18)} · 关键洞察`;
  return `${cut(base, 18)} · 优化版`;
}

function designFor(intent, previous = {}) {
  return {
    emphasis: intent.emphasis ? 'title' : intent.moreData ? 'data' : previous.emphasis || 'balanced',
    decoration: intent.minimal ? 'minimal' : intent.darkTech ? 'tech' : previous.decoration || 'minimal',
    density: intent.simplify ? 'spacious' : previous.density || 'normal',
    alignment: previous.alignment || 'left',
  };
}

function pointsFor(intent, slide) {
  const pts = (slide.points || []).map((p) => ({ ...p }));
  if (!intent.simplify) return pts;
  return pts.slice(0, 2).map((p) => ({ text: cut(p.text, 18), detail: '' }));
}

// ---------------- 阶段 2 原有的三个方法（行为保持不变） ----------------

const CHAPTERS = ['背景与现状', '核心框架', '实施路径', '实践与验证', '结论与展望'];
const CONTENT_TITLES = [
  (t) => `为什么需要关注${t}`,
  (t) => `${t}的核心框架`,
  () => '关键路径与实施步骤',
  (t) => `${t}的典型场景`,
  () => '成效衡量与数据表现',
  () => '风险、边界与应对',
  (t) => `${t}的价值归纳`,
  () => '延展思考与行动建议',
];
const KEY_POINTS = [
  (t) => `从真实诉求出发，界定${t}要解决的问题`,
  (t) => `把${t}拆解为可执行的若干环节`,
  () => '明确优先级，先做影响面最大的部分',
  () => '用案例说明方法在场景中的落地方式',
  () => '用可量化的指标观察变化',
  () => '识别约束条件并准备备选方案',
  () => '沉淀可复用的结论与经验',
  () => '给出下一步的具体行动建议',
];
const EVIDENCE = [
  (t) => `示例案例：某团队围绕${t}梳理流程后，将沟通成本明显降低（演示数据）`,
  (t) => `示例数据：关于${t}的调研中，多数受访者认为目标不清晰是首要障碍（演示数据）`,
  () => '示例数据：分阶段推进时的完成度对比（演示数据）',
  () => '示例案例：一次小范围试点的执行记录（演示数据）',
];

function chapterFor(i, total) {
  if (i <= 1) return '开篇';
  if (i === total - 1) return '收束';
  const span = Math.max(1, (total - 3) / CHAPTERS.length);
  return CHAPTERS[clamp(Math.floor((i - 2) / span), 0, CHAPTERS.length - 1)];
}

function titleFor(i, type, topic, total) {
  const t = topic || '本主题';
  if (type === 'cover') return t;
  if (type === 'agenda') return '内容导览';
  if (type === 'summary') return '总结与下一步';
  if (i === 1 && total >= 4) return `关于${t}的整体视角`;
  return CONTENT_TITLES[(i - 2 + CONTENT_TITLES.length * 4) % CONTENT_TITLES.length](t);
}

function failMaybe(opts) {
  const forced = opts.fail || (typeof location !== 'undefined' && /[?&]mockFail=1/.test(location.search));
  if (forced) return Promise.reject(new Error('演示模式：模拟的生成失败（用于验证错误处理）'));
  return Promise.resolve();
}

function pointCount(depth) {
  if (depth === '精简') return 2;
  if (depth === '详尽') return 4;
  return 3;
}

function buildPoints(i, meta) {
  const t = meta.topic || '本主题';
  return Array.from({ length: pointCount(meta.depth) }, (_, k) => ({
    text: KEY_POINTS[(i + k) % KEY_POINTS.length](t),
    detail: k === 0
      ? `面向${meta.audience || '听众'}，${meta.purpose || '本次分享'}中先给出结论。`
      : `结合${meta.style || '整体风格'}展开说明，注意与上一页的衔接。`,
  }));
}

function sampleChart(topic) {
  return {
    type: 'bar', unit: '示例指数',
    labels: ['阶段一', '阶段二', '阶段三', '阶段四'],
    series: [{ name: topic || '本主题', values: [38, 56, 74, 91] }],
    note: '演示数据 · 阶段 4 接入真实 AI 后由内容生成',
  };
}

function buildSlide(item, i, total, meta, existingId) {
  const t = meta.topic || '本主题';
  const type = item.pageType;
  return normalizeSlide(
    {
      id: existingId || uid('sl'),
      outlineId: item.id,
      type,
      title: item.title,
      subtitle:
        type === 'cover'
          ? `${meta.purpose} · ${meta.audience}`
          : type === 'agenda'
            ? `共 ${total} 页 · ${meta.language}`
            : type === 'summary'
              ? `${t} · 结论回顾`
              : item.chapter,
      points:
        type === 'agenda'
          ? [
              { text: '背景与问题', detail: '为什么值得讨论' },
              { text: '方法与路径', detail: '如何推进落地' },
              { text: '验证与结论', detail: '如何衡量成效' },
            ]
          : buildPoints(i, meta),
      evidence: EVIDENCE[i % EVIDENCE.length](t),
      visualHint:
        type === 'visual'
          ? `建议放置一张与「${t}」相关的结构示意图或流程图`
          : type === 'chart'
            ? '建议使用分组柱状图展示阶段性变化'
            : '保持留白，避免堆叠文字',
      chart: type === 'chart' ? sampleChart(t) : null,
      notes: `演讲提示（演示内容）：用 1 分钟说明「${item.keyPoint || item.title}」，再过渡到下一页。`,
      chapter: item.chapter,
    },
    i,
    total,
  );
}

export async function generateOutline({ meta }, opts = {}) {
  await failMaybe(opts);
  await sleep(620);
  const total = clamp(Number(meta.pageCount) || 8, 3, 20);
  const outline = Array.from({ length: total }, (_, i) => {
    const pageType = defaultTypeFor(i, total);
    const t = meta.topic || '本主题';
    return normalizeOutlineItem(
      {
        id: uid('out'),
        chapter: chapterFor(i, total),
        title: titleFor(i, pageType, t, total),
        keyPoint: pageType === 'cover'
          ? `围绕${t}展开${meta.purpose}`
          : pageType === 'agenda'
            ? '说明整份演示的结构与阅读顺序'
            : pageType === 'summary'
              ? '回收核心结论，给出可执行的下一步'
              : KEY_POINTS[(i - 2 + KEY_POINTS.length * 4) % KEY_POINTS.length](t),
        pageType,
      },
      i,
      total,
    );
  });
  return { outline, summary: { pages: total, source: 'mock' } };
}

export async function generateSlides({ meta, outline, existingSlides = [] }, opts = {}) {
  await failMaybe(opts);
  await sleep(880);
  const byOutline = new Map(existingSlides.filter((s) => s.outlineId).map((s) => [s.outlineId, s.id]));
  const slides = outline.map((item, i) =>
    buildSlide(item, i, outline.length, meta, byOutline.get(item.id)),
  );
  return { slides, summary: { pages: slides.length, source: 'mock' } };
}

export async function regenerateSlide({ meta, slide, outlineItem }, opts = {}) {
  await failMaybe(opts);
  await sleep(520);
  const total = Math.max(3, Number(meta.pageCount) || 8);
  const item = outlineItem
    ? { ...outlineItem, pageType: slide.type, id: outlineItem.id }
    : { id: slide.outlineId, title: slide.title, keyPoint: '', pageType: slide.type, chapter: slide.chapter };
  const fresh = buildSlide(item, 2, total, meta, null);
  return {
    patch: {
      title: fresh.title, subtitle: fresh.subtitle, points: fresh.points,
      evidence: fresh.evidence, visualHint: fresh.visualHint, chart: fresh.chart,
      notes: `${fresh.notes}（本页已单独重新生成）`,
    },
    summary: { pages: 1, source: 'mock' },
  };
}

// ---------------- 阶段 2.5 新增的四个业务方法 ----------------

/** A/B 之外的第三个入口核心：按自然语言修改当前页，返回 patch（不含 id）。 */
export async function editSlideByInstruction(
  { instruction, slide, meta, theme, prevSlide, nextSlide, outlineItem },
  opts = {},
) {
  await failMaybe(opts);
  await sleep(560);
  if (!slide || !String(instruction || '').trim()) {
    throw new Error('缺少页面数据或修改指令');
  }
  const intent = parseIntent(instruction);
  const currentLayout = toLayout(slide.layout || slide.type);
  const layout = intent.layout || currentLayout;
  const elements = buildElements(layout, slide, instruction);
  const points = pointsFor(intent, slide);
  const design = designFor(intent, slide.design);
  const topic = meta?.topic || '本主题';

  return {
    patch: {
      type: layout,
      layout,
      title: layoutTitle(layout, slide, intent),
      points,
      elements,
      design,
      evidence: intent.moreData
        ? `示例数据：围绕「${topic}」的关键指标对比（演示数据，由修改指令补充）`
        : slide.evidence,
      visualHint: elements.length
        ? `${LAYOUT_LABELS[layout]}：${elements.length} 个结构化元素，其中 ${elements.filter((e) => e.kind === 'connector').length} 条连线`
        : `已按指令「${cut(instruction, 24)}」优化文字与视觉层级`,
      chart: layout === 'chart' || layout === 'dashboard' ? (slide.chart || sampleChart(topic)) : slide.chart,
      notes: `${String(slide.notes || '').slice(0, 90)}${slide.notes ? ' ' : ''}〔按描述修改：${cut(instruction, 30)}〕`,
    },
    summary: {
      intent: { layout: intent.layout, simplify: intent.simplify, emphasis: intent.emphasis, minimal: intent.minimal },
      layout, elements: elements.length,
      context: {
        prev: prevSlide?.title || '', next: nextSlide?.title || '',
        outline: outlineItem?.title || '', themeName: normalizeTheme(theme).name,
      },
      source: 'mock',
    },
  };
}

/** 按描述创建新页面：位置由 UI 选择、由 actions 计算，这里只产出页面数据。 */
export async function createSlideByInstruction(
  { instruction, meta, theme, prevSlide, nextSlide },
  opts = {},
) {
  await failMaybe(opts);
  await sleep(620);
  if (!String(instruction || '').trim()) throw new Error('请描述要新增的页面内容');
  const intent = parseIntent(instruction);
  const layout = intent.layout || 'content';
  const topic = meta?.topic || '本主题';
  const base = normalizeSlide(
    {
      id: uid('sl'),
      type: layout,
      title: `${cut(instruction, 20)}`,
      subtitle: `${topic} · 新增页面`,
      points: [
        { text: cut(instruction, 26), detail: `由自然语言生成 · ${normalizeTheme(theme).name}` },
        { text: `承接上一页：${cut(prevSlide?.title || '开篇', 16)}`, detail: '保持上下文连贯' },
        { text: `衔接下一页：${cut(nextSlide?.title || '总结', 16)}`, detail: '留出过渡空间' },
      ],
      evidence: `示例数据：与「${topic}」相关的补充观察（演示数据）`,
      visualHint: '按描述生成的结构化页面',
      notes: `演讲提示：本页由指令「${cut(instruction, 24)}」生成。`,
      chapter: 'AI 新增',
      design: designFor(intent),
      elements: buildElements(layout, { points: [] }, instruction),
    },
    0,
    3,
  );
  const outlineItem = normalizeOutlineItem(
    { id: uid('out'), chapter: 'AI 新增', title: base.title, keyPoint: cut(instruction, 30), pageType: 'content' },
    0,
    3,
  );
  return { slide: base, outlineItem, summary: { layout, source: 'mock' } };
}

/** 自然语言 → 完整 Theme JSON（直接写进 deck.theme）。 */
export async function generateThemeByInstruction({ instruction, currentTheme }, opts = {}) {
  await failMaybe(opts);
  await sleep(540);
  const intent = parseIntent(instruction);
  const base = normalizeTheme(currentTheme);
  let next;

  if (intent.darkTech) {
    next = normalizeTheme({
      ...base,
      id: 'custom', name: '深色科技风',
      background: '#0B1224', primaryColor: '#8B5CF6', secondaryColor: '#6366F1',
      accentColor: '#22D3EE', titleColor: '#F8FAFC', bodyColor: '#CBD5E1',
      titleSize: 38, subtitleSize: 20, bodySize: 18,
      spacing: 'spacious', borderRadius: 8, decorationStyle: 'tech',
    });
  } else if (intent.academic) {
    next = normalizeTheme({
      ...base,
      id: 'academic', name: '学术答辩 · 定制',
      background: '#FFFFFF', primaryColor: '#1E4E8C', secondaryColor: '#163A68',
      accentColor: '#E8EEF7', titleColor: '#12233B', bodyColor: '#2C3E55',
      titleSize: 30, subtitleSize: 18, bodySize: 17,
      spacing: 'normal', borderRadius: 4, decorationStyle: 'rules',
    });
  } else if (intent.consulting || intent.emphasis) {
    next = normalizeTheme({
      ...base,
      id: 'custom', name: intent.consulting ? '高端商务咨询' : '强调标题版',
      background: '#FFFFFF', primaryColor: '#0F2C5C', secondaryColor: '#1D4ED8',
      accentColor: '#EEF2F8', titleColor: '#0B1B33', bodyColor: '#334155',
      titleSize: 40, subtitleSize: 19, bodySize: 17,
      spacing: 'spacious', borderRadius: 2, decorationStyle: 'minimal',
    });
  } else {
    next = normalizeTheme({
      ...base,
      id: 'custom', name: `自定义 · ${cut(instruction, 10) || '微调'}`,
      titleSize: clamp(base.titleSize + 2, 20, 48),
      decorationStyle: intent.minimal ? 'minimal' : base.decorationStyle,
    });
  }
  return { theme: next, summary: { name: next.name, dark: next.background, source: 'mock' } };
}

/** 只换布局：保留本页全部文字、图表与备注，按新布局生成元素。 */
export async function changeSlideLayout({ slide, layout, instruction }, opts = {}) {
  await failMaybe(opts);
  await sleep(420);
  const target = toLayout(layout);
  const elements = buildElements(target, slide, instruction || '');
  return {
    patch: {
      type: target,
      layout: target,
      elements,
      visualHint: `${LAYOUT_LABELS[target] || target} · 保留原有文字与图表，仅调整结构`,
      design: { ...(slide.design || {}), emphasis: target === 'dashboard' ? 'data' : (slide.design?.emphasis || 'balanced') },
    },
    summary: { layout: target, elements: elements.length, preservedText: true, source: 'mock' },
  };
}

export const mockProvider = {
  id: 'mock',
  generateOutline,
  generateSlides,
  regenerateSlide,
  editSlideByInstruction,
  createSlideByInstruction,
  generateThemeByInstruction,
  changeSlideLayout,
};
