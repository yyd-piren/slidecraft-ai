# SlideCraft AI

基于 **Anna 平台**开发的 AI 演示文稿编辑器。用户输入主题与要求，生成结构化大纲和逐页内容，在三栏工作区中用自然语言修改页面、切换布局与整体视觉风格，最终导出**真正可编辑的 PowerPoint（.pptx）文件**。

> 当前进度：**阶段 4 完成** — 接入 Anna 平台真实 AI（`anna.llm.complete`），并完成真实运行模式增强。
> 生产环境默认使用真实 Anna Provider；本地开发默认 Mock（配合 `--no-llm` 可做到 CU 消耗为 0）。
> 五类 AI 能力共用统一 Provider 契约，Mock 与真实模式使用同一套 Deck v2 数据结构；PPTX 全部在本地浏览器生成，不经过任何外部模型。
> 顶栏支持**选择模型**（28 个 text 模型）与**显示剩余 CU**；LLM 输出解析已针对真实模型的截断、Markdown 包裹、`bullets` 别名字段等做加固。

## 主要功能

| 能力 | 说明 |
| --- | --- |
| 创建任务 | 主题、用途、受众、页数、语言、风格、详细程度、补充要求；两套预设主题 |
| Anna AI | 生产默认调用 `anna.llm.complete`；大纲 / 逐页内容 / 单页修改 / 新增页面 / 全局主题五类能力；本地可切 Mock |
| 模型与额度 | 顶栏下拉选择模型（留空为平台默认路由）、实时显示剩余 CU、一键刷新；选择持久化到 localStorage |
| 结构化大纲 | AI 生成结构化条目，可新增、删除、编辑、上下移动、调整页面类型 |
| 三栏工作区 | 左侧缩略图、中间 16:9 画布、右侧属性面板（内容编辑 / AI 修改 / 页面设计） |
| 自然语言改页 | 按描述修改当前页；Mock 按中文意图返回架构图连线、流程图、时间轴、对比、看板等结构 |
| 三个独立入口 | A 重新生成页面（按大纲）、B 按描述修改页面、C 按描述新增页面（可选插入位置） |
| 动态主题 | 预设切换、自然语言设计、颜色/字体/字号/间距/圆角/装饰风格自定义；深色背景自动浅色文字 |
| 12 种布局 | title / agenda / content / two-column / image-text / chart / comparison / timeline / flowchart / architecture / dashboard / summary |
| 撤销与恢复 | 页面修改、主题修改、新增页面均可撤销；草稿与撤销栈写入 `anna.storage`，刷新后可恢复 |
| 真实 PPTX 导出 | 文本框、形状、连接线、原生图表均为可编辑对象；本地浏览器下载 |

## 快速开始

```bash
anna-app validate --strict       # 校验 manifest / app.json
anna-app dev --no-llm            # 本地 harness：http://localhost:5180/，强制 Mock、零 CU
anna-app dev                     # 真实 LLM 桥接（需已登录的 PAT），会按实际用量计费
```

- **生产/Staging**：默认使用真实 `AnnaAIProvider`，只有用户点击「生成」才调用模型。
- **本地开发**：默认 Mock；`--no-llm` 会禁用 LLM 桥接，双重保证零 CU。
- 本地如需显式验证真实 Provider，可在 **dashboard 页面** URL 加 `?aiReal=1`（应用 iframe 与 dashboard 同源，会读取父页面参数）；本地默认硬性限制 **1 次** `llm.complete`，防误烧额度。
- 需要连续验证多项能力时加 `&aiMaxCalls=N`（最大 50），例如 `http://localhost:5180/?aiReal=1&aiMaxCalls=20`；顶栏 badge 会显示剩余次数，刷新页面可重置计数。
- 没有 Anna 宿主时应用会明确提示并切到演示模式（不会假装 AI 调用成功）。

## 目录结构

```
manifest.json / app.json       Anna 应用清单与商店元数据
bundle/
  index.html, styles.css       静态 SPA 入口与设计系统
  app.js                       启动、Runtime 握手、事件路由
  core/
    deck.js                    统一 Deck JSON、Theme JSON、稳定 slide.id、全部结构操作
    store.js                   render / visual / status 三通道状态容器
    actions.js                 业务编排（三个 AI 入口、撤销、导出）
    platform.js                Anna SDK 连接与 storage 抽象
  ai/
    adapter.js                 Provider 选择、串行队列、调用日志（model / usage / quotaConsumed）
    mock.js                    MockAIProvider（保留，零 CU）
    anna-provider.js           唯一封装 anna.llm.complete 的地方
    prompts.js                 7 类任务的独立 Prompt 与 Deck 结构约束
    parser.js                  LLM 文本 → JSON → 严格校验 → Deck normalize
    errors.js                 错误分类与中文可读提示
    logbook.js                写入 anna.storage 的调用日志（不含任何凭据）
  render/
    themes.js, layouts.js      HTML 预览（主题 CSS 变量 + 12 布局）
    pptx-*.js                  PPTX 渲染引擎（见下）
    vendor/                    自包含 PptxGenJS 浏览器 ESM 包
  export/exporter.js           导出流程编排
  ui/                          顶栏、浮层、四个视图、三栏工作区
executas/slidecraft-ai/         CLI 生成的 ping 脚手架，保留但不作为业务依赖
```

## 数据契约

**Deck**（唯一数据源）：`{ id, version, meta, theme, outline, slides, createdAt, updatedAt, exportInfo }`。

- `meta`：`topic / purpose / audience / pageCount / language / style / depth / extra`
- `theme`：**完整 Theme JSON**（不是 CSS、也不是字符串 ID），字段包括 `name / background / primaryColor / secondaryColor / accentColor / titleColor / bodyColor / fontFamily / titleSize / subtitleSize / bodySize / spacing / borderRadius / decorationStyle`
- `outline`：`{ id, chapter, title, keyPoint, pageType }`；`pageType` 沿用六种建议值
- `slides`：`{ id, outlineId, type, layout, title, subtitle, points, evidence, visualHint, chart, notes, chapter, design, elements }`
- `elements` 的真实 `kind`：`layer / node / connector / step / column / metric / bar / note / label`，并兼容 `module / edge / text / shape / chart / image` 等别名

所有写操作都按 `slide.id` 精确定位；旧版字符串主题和 `cover / visual` 布局名会被自动归一化，不破坏旧草稿。Mock 与真实 Anna AI 共用 `createAiAdapter` 的七个业务方法：`generateOutline / generateSlides / regenerateSlide / editSlideByInstruction / createSlideByInstruction / generateThemeByInstruction / changeSlideLayout`。

## AI Provider 架构（阶段 4）

| 层 | 文件 | 职责 |
| --- | --- | --- |
| 业务编排 | `core/actions.js` | 只依赖 adapter 的七个业务方法，不接触 SDK |
| 适配器 | `ai/adapter.js` | 模式选择、串行队列、调用日志、失败不覆盖 Deck |
| Provider | `ai/mock.js` / `ai/anna-provider.js` | 同一契约；只有后者调用 `anna.llm.complete` |
| Prompt | `ai/prompts.js` | 7 类任务独立 Prompt，明确 12 布局与合法元素类型 |
| 解析校验 | `ai/parser.js` | 剥离 Markdown 代码块 → `JSON.parse`（禁用 eval）→ 字段校验 → `deck.normalize*` |
| 错误 | `ai/errors.js` | 禁用 / 额度不足 / 超时 / 服务异常 / 格式异常 → 中文可读提示 |

**Anna SDK 调用依据**：官方文档 `reference/host-api-llm.md`、平台 SDK 0.27.0 源码、`methods.json`（dispatcher 0.33.0）。`anna.llm.complete({messages, maxTokens, temperature, systemPrompt}, opts?)` 的返回值由 SDK `rt.call()` **直接 resolve `msg.result`**，不再解包 `{result}`；返回含 `model / content.text / usage / _meta.quotaConsumed`。平台没有可用的 JSON-schema 结构化输出参数，因此采用「严格 JSON Prompt + 本地校验」。

**安全与额度**：所有真实调用串行、零自动重试、禁止并行；`maxCalls` 闸门用于本地验收（默认 1 次），生产不限。每次调用记录模型名、输入输出 token、实际 `quotaConsumed`（失败记为 `null`，绝不虚构 CU）；失败一律抛出可读错误，**不静默退回 Mock、不覆盖已有内容**。日志中不含 PAT、Token 或任何凭据。

**数据修复**：模型输出缺字段或轻微越界时做本地安全修复并留痕（`summary.repairs`）；结构性非法（未知布局 / 未知元素 / 试图更换 `slide.id` / 页数不符）直接报错，不写入 Deck。本地修复与「再次调用 LLM」严格区分，解析层永不重新发起请求。

**真实模型兼容（阶段 4 实测加固）**：
- 逐页生成的 `maxTokens` 从 2200 提高到 **3200**（平台单次默认上限 4096）。实测 4 页批量输出约 1780 tokens，原 2200 仅剩 417 余量，内容稍复杂即被截断成不完整 JSON。
- `parseJsonLoose` 用**括号配平扫描**取代 `lastIndexOf('}')`，支持 Markdown 代码块、前后说明文字、`//`/`/* */` 注释、尾随逗号、顶层数组，以及**截断后自动补齐括号**救回已完整部分；无法救回时明确提示「疑似被 maxTokens 截断」。
- 真实模型常把要点写成 `bullets` 而非 `points`，解析器会映射并留痕，避免静默丢掉全部要点；`outline/pages/items`、`theme/design` 等顶层别名同样兼容。
- 解析失败时把脱敏的原文头尾片段、字符数、`stopReason` 写进调用日志，便于区分截断与格式错误。

**动态布局内容不空白**：真实模型常把 `column / layer / step / node` 的内容写成 `bullets`、`name`、`text` 等字段，甚至只给 `kind` 空壳；旧渲染器只认 `title + items`，会画出两个空白框（右侧属性面板却有要点）。现在 `core/deck.js` 的 `normalizeElements` 在**数据入口**做别名归一（`name/label/heading→title`、`bullets/points/content/text→items`，换行/分号自动拆条），`render/element-utils.js` 在**渲染入口**再做一次统一取值；若目标类型元素仍全为空壳，则一律回退到 `slide.points` 生成结构，HTML 预览与 PPTX 导出都不会出现空白卡片。涉及 `two-column / comparison / timeline / flowchart / architecture / dashboard` 六种动态布局。

**模型选择**：`llm.catalog({})` 返回 `models[]` 与 `quota.remainingCU`（能力发现，不推理、不扣 CU）。顶栏只列出 `serviceTypes` 含 `text` 的模型；选择通过 **`modelPreferences: { hints: [{ name }] }`** 传给平台——**必须是数组格式**，实测 `{hints:{name}}` 会被忽略并回退默认路由。每次真实调用后自动刷新余额，也可点 ↻ 手动刷新；目录不可用只影响该区域显示，不阻断应用。

## PPTX 渲染架构

统一入口：`renderDeckToPptx(deck, options)` → `{ buffer, bytes, fileName, warnings, stats }`。UI 与业务层不接触 PPTX 库 API。

| 模块 | 职责 |
| --- | --- |
| `pptx-engine.js` | 懒加载 PptxGenJS，创建 16:9 演示文稿，逐页渲染并输出 ArrayBuffer |
| `pptx-theme.js` | Theme JSON → HEX 颜色、Office 字体回退、px→pt、深色对比度保护 |
| `pptx-coords.js` | 0~1 归一化坐标 → 英寸；统一页边距、标题/正文安全区、等分与越界回收 |
| `pptx-text.js` | 中英文混排行数估算、有限档位自适应字号、溢出警告（不静默截断） |
| `element-utils.js` | **HTML 预览与 PPTX 渲染共用**的元素取值层：统一 `title/items/text/value`，兼容模型别名并用 `slide.points` 兜底 |
| `pptx-elements.js` | 动态元素 → 原生形状、文本、带箭头连接线、指标卡、原生图表 |
| `pptx-layouts.js` | 12 种布局各自独立的构图逻辑 |
| `pptx-validator.js` | 导出前校验，区分阻断错误与可展示警告 |
| `pptx-export.js` | Export Adapter：Blob 本地下载；预留未来 `anna.upload.inline` 上传接口 |

**技术选型**：PptxGenJS **4.0.1**（MIT）。官方 `dist/pptxgen.es.js` 依赖外部 `jszip`，Anna 沙箱没有包解析器且 CSP 禁止外部 CDN，因此用 esbuild 把 ESM 构建与 JSZip 打成单文件 `bundle/vendor/pptxgen.bundle.esm.js`（约 529 KB，**0 个外部 import**），随 bundle 一起发布。

重新生成该 vendor 文件（如需升级版本）：

```bash
npm install pptxgenjs@4.0.1 jszip esbuild
npx esbuild entry.js --bundle --format=esm --platform=browser --target=es2020 --outfile=pptxgen.bundle.esm.js
# entry.js: import PptxGenJS from 'pptxgenjs'; export default PptxGenJS;
```

**预览与导出一致性**：`pptx-coords.js` 的归一化区域由网页 CSS 在 960×540 逻辑画布上的实际尺寸换算（眉标 y=52px、标题 81px、规则线 139px、要点 164px、案例条 bottom 64px、页脚细线 490px）；要点列表按「编号 / 标题 / 说明」三列独立文本框 + 15px 条目间距渲染，案例条为中性浅灰底 + 左侧蓝色竖条，页脚带上边细线。已用 `python-pptx` 读取导出文件的形状坐标做数值对照，关键位置误差 ≤ 0.004 英寸，字号按 CSS px→pt 换算。

**导出排版不重叠（阶段 4 实测修复）**：`renderSlideToPptx` 曾对**所有**布局额外叠加一遍「带归一化坐标的自由元素」，而动态布局已通过 `parts()` 消费过 `elements`，导致真实 AI 在目录页生成的 `step` 元素被二次绘制（蓝色圆形编号 + 卡片文字大面积压叠）。现已移除全局叠加，`renderFreeElements` 保留为可显式调用的扩展能力。同时：
- 目录页改用统一 `REGIONS.body` 安全区排 2 列 × 3 行卡片，编号 / 标题 / 说明分区，并补上网页同款的左侧蓝色竖线；
- 架构层标题文本框原来占满整卡，与右侧子项 100% 重叠 → 改为只占左侧 28% 标签列；
- 指标卡的数值与标签两行留出明确间隙，不再轻微相交。

用 `python-pptx` 读取导出文件的形状坐标做了**逐页两两重叠扫描**（阈值 >12%）：12 种布局合计 **0 对显著重叠**；目录页 `prst="ellipse"` 叠加圆形为 0，4 个章节标题与案例条均完整。回归单测会用 ZIP 结构对比「带/不带自由元素的目录页形状数必须一致」防止复发。

导出文件名格式为 `SlideCraft_主题名称_日期.pptx`。本阶段只做**本地浏览器下载**，不调用 `anna.upload.inline` / `files.download`；平台上传链路留到后续阶段，通过 `createExportAdapter()` 注入即可，无需改动渲染器。

**可编辑性边界**：连接线是 PowerPoint 原生线条形状（带箭头），不是 `p:cxnSp` 连接符，因此不会随节点移动自动重连；图表使用 OOXML 原生 chart part，可在 PowerPoint 中继续编辑数据。导出结果中没有任何整页截图。

## 测试

```bash
# 逻辑与渲染单测（95 项）
node <测试脚本>            # 阶段 2 的 24 项 + 阶段 2.5 的 14 项 + 阶段 3 的 12 项 + 阶段 4 的 23 项 + 真实输出/模型/动态布局/PPTX 排版 22 项

# 浏览器端到端（43 项，需先启动 anna-app dev --no-llm 与无头 Edge CDP）
node <E2E 脚本>
```

阶段 4 的单测与 E2E 全部使用**注入的假 SDK**（零真实 RPC、零 CU），覆盖 Provider 接口一致性、7 类 Prompt、Markdown 代码块解析、缺字段 / 非法布局 / 非法元素 / 中文长文本、五类 AI 能力、单页隔离、新增页 ID 唯一、主题不覆盖内容、失败不破坏 Deck、撤销、串行与调用闸门、错误分类、日志记录，以及「真实 AI 返回结构经阶段 3 PPTX 引擎渲染」。

阶段 3 的文件级验证用 `python-pptx` + OOXML 结构检查完成：构造含 12 种布局的综合中文 Deck，导出后可正常打开、页数与顺序正确、16:9、中文字体正确、0 张图片、原生图表与箭头存在。环境中没有安装 LibreOffice / PowerPoint，因此未做 GUI 打开与 PDF 转换验证。

## 后续阶段

- 阶段 5：平台联调，验证 `anna.upload.inline` 下载链路与 Staging 安装
- 阶段 6：`apps push → cut → submit-review → release` 发布上架

## 安全与配置

- `.gitignore` 已排除 `.anna/`、`.backup/`、`.workbuddy/`、凭据、`*.key`、`.env`、`.venv/` 等，任何 PAT / credentials 都不得入库
- `manifest.json` 已移除未注册的 `tool-dev-*` Executa 依赖；主视图 1360×860
- 不修改 Anna Runtime 初始化与握手逻辑；草稿通过 `anna.storage` 持久化
