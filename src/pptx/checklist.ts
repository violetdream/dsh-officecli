import { FONT } from './grid.js'
import { DECK_SPEC_HELP } from './deck.js'
import { THEMES, themeAliasCatalog } from './theme.js'
import { allTemplates, templateRegistry } from './templates.js'

/**
 * 交给模型的设计约束与自检清单。
 *
 * 版式模板已经把坐标算好，模型不需要（也不应该）自己摆位置。但**内容长度**
 * 是模板算不出来的 —— 标题写 30 个字、卡片正文塞 80 个字，再好的版式也会溢出。
 * 所以这一层的约束全部集中在「写多少字」，以及生成后的视觉自查项。
 */

/** 每类字段的字数红线。超出会在 PPT 里溢出或缩排成小字。 */
export const LENGTH_LIMITS = `【字数红线】超出会在幻灯片里溢出，务必遵守：
  cover.title      ≤ 18 字（主标题，可含 1 个换行）
  cover.subtitle   ≤ 40 字
  cover.eyebrow    ≤ 12 字（如"2026 年度规划"）
  section.title    ≤ 16 字
  bullets.items[].title   ≤ 22 字（columns:2 两栏 ≤ 18 字）
  bullets.items[].desc    ≤ 46 字（columns:2 两栏 ≤ 34 字）
  bullets.items           ≤ 6 条（columns:2 两栏 ≤ 8 条）
  cards.cards[].title     ≤ 12 字
  cards.cards[].desc      ≤ 60 字（2-3 张卡可放宽到 80）
  kpi.metrics[].value     ≤ 6 字符（如 "3.2x"、"92%"、"1.8亿"）
  kpi.metrics[].label     ≤ 10 字
  steps.steps[].title     ≤ 10 字（放进色块里，长了会撑破）
  steps.steps[].desc      ≤ 34 字
  compare.*.points[]      ≤ 30 字/条
  timeline.events[].title ≤ 12 字
  timeline.events[].desc  ≤ 40 字
  quote.quote       ≤ 70 字
  table.headers[]   ≤ 8 字/列，列数 ≤ 5
  table.rows        行数 ≤ 8
  agenda.items[].title    ≤ 14 字
  agenda.items[].desc     ≤ 40 字
  swot 每象限 ≤ 4 条，每条 ≤ 18 字
  pricing.plans[]         ≤ 4 个方案
  pricing.features[]      ≤ 5 条/方案，每条 ≤ 12 字
  pricing.price           ≤ 8 字符（如 "¥9,900/年"）
  roadmap.phases[].phase  ≤ 6 字（阶段标签，如 "阶段一"）
  roadmap.phases[].title  ≤ 12 字
  roadmap.phases[].desc   ≤ 36 字
  chart.title       ≤ 20 字
  chart.insight     ≤ 60 字（这页数据的判断，必填）
  chart.bullets     ≤ 3 条，每条 ≤ 34 字
  chart.source      ≤ 30 字
  image-split.title     ≤ 20 字
  image-split.desc      ≤ 60 字
  image-split.points    ≤ 4 条，title ≤ 12 字、desc ≤ 26 字
  image-full.title      ≤ 24 字（全幅页，可以更长）
  image-full.subtitle   ≤ 40 字
  diagram.title     ≤ 20 字
  diagram.mermaid   节点 ≤ 8 个、每个节点文字 ≤ 10 字（再多会缩到看不清）
  diagram.caption   ≤ 50 字`

/**
 * 叙事与密度门禁。
 *
 * 这一节是「没有下限」的补丁：早期版本只规定字数上限，模型于是学会了
 * 「每页写 3 个短语就交差」—— 版式没错、字数没超，但整份稿子是信息板不是汇报稿。
 * 下限、页面角色、版式多样性三件事必须显式写出来，否则模型不会自觉。
 */
export const NARRATIVE_GUIDE = `【叙事与密度】只守字数上限会产出「排版正确但内容稀薄」的稿子，下面每一条都要落实：

① 页面角色（生成前先在脑子里给每页标一个）
   hero       视觉高潮：封面、章节页、关键数据页、结束页。占全篇 20–30%，且两个 hero 之间至少隔 1 页普通内容页
   supporting 信息承载：绝大多数内容页
   transition 章节转场：章节切换处
   连续 ≥3 页都是同一种版式或同样信息密度 → 必须插入一页 hero 打破沉闷。

② 版式多样性
   相邻两页不要用同一种 layout；
   cards 全篇最多用 2 次（等宽卡片横排是「AI 味」最重的版式）；
   章节页（section）不要连续用，也不要用它凑页数。

③ 非对称优先
   全篇至少 30% 的页面用**非对称版式**：chart / image-split / image-full。
   其余才用对称版式（cards / compare / steps / swot / pricing 这类等宽排布）。
   全篇清一色等宽卡片 = 流水线感，必须避免。

④ 密度下限（内容稀薄同样是失败）
   普通内容页正文字数 ≥ 120 字；卡片组每张卡 ≥ 60 字；
   数据页至少 1 张图表 + 1 句判断；封面 ≥ 20 字且要有副标题。
   留白只允许围绕焦点元素（大图 / 大数字）出现；
   「每两个元素之间都差不多空」= 均匀稀薄，需要补内容或合并页面。

⑤ 数据必须落点（用 chart 版式的 insight 字段承载）
   写了数字就必须给判断，三选一：
     含义解释 —— 这个数字说明行业/技术处于什么状态
     业务影响 —— 这个数字对业务或决策意味着什么
     管理启示 —— 据此该做什么判断
   只摆数字不给结论的是信息板，不是汇报稿。

⑥ 配图分级与风格统一
   L1 主视觉（image-split / image-full 的图，承担叙事，占一栏完整高度）
   L2 支撑图（与某段正文并排）
   L3 角标装饰（≤64pt 的小徽标，全篇位置固定）
   不要用 L3 小装饰顶替 L1；同一份 PPT 的配图风格要统一（全摄影或全插画）；
   正文页不要用全屏背景图（大图要以独立元素出现，四周留出页面底色）。
   图片必须是本地文件路径，officecli 不支持 http URL，也不做裁切 —— 请按图槽比例准备原图。

⑦ anti_pattern（决定版式时顺手写下「这页不能怎么排」）
   数据页   → 不要把核心数字塞进等宽卡片横排
   章节页   → 不要铺满正文段落、不要四卡片预览
   场景/产品页 → 不要 50:50 等分双栏、不要把主图缩成小贴片
   列表页   → 不要等宽四卡，改用 bullets 两栏或 compare`

/**
 * 元素能力清单。
 *
 * 这些能力都走**版式字段**，模型不需要（也不应该）自己去 office_add 拼：
 * 图表/表格/图片的坐标、字号、配色都由插件算好。
 */
export const ELEMENT_GUIDE = `【元素能力】officecli 原生支持下列元素，插件已把坐标与样式包好，直接用对应版式/字段：
  chart 版式       原生图表（可编辑的图表对象，不是图片）
                   类型：column/bar/line/pie/doughnut/area/scatter/bubble/radar/stock/combo/
                   waterfall/funnel/treemap/sunburst/boxWhisker/histogram/pareto
                   可加修饰：3d（如 column3d）、stacked、percentStacked
                   选型：趋势用 line；构成用 stackedArea 或百分之堆积；对比用 column/bar；
                   占比用 pie/doughnut（仅单系列）；静态明细用 table，不要硬做成图表
  table 版式       原生表格（主色表头 + 交替行）
  image-split 版式 一栏大图 + 一栏文字，side 控制图在左还是右
  image-full 版式  全幅底图 + 骑线文字，用于封面与章节高潮（overlay 控制压暗强度）
  diagram 版式     mermaid 源码编译成**原生可编辑图形**（不依赖远程渲染服务）
                   支持 flowchart / graph / sequenceDiagram（内置合成器的子集）
  slides[i].notes  演讲者备注：放映时只有演讲者看得到。汇报稿建议每页都写「这页该说什么」
  slides[i].animate 本页入场动画：true 用默认 fade，也可给效果名（fade/fly/zoom/wipe/bounce/...）
                   只挂在本页的视觉锚点上（图表 / 页面标题 / 巨型数字），不要逐条挂列表；
                   混用多种效果是廉价感的来源，全篇统一一种；正文密集页不要加动画

注意事项：
  · 图片用本地路径（绝对路径或相对当前工作目录），**不支持 http URL**
  · officecli 的 picture 不做裁切，原图比例要与图槽一致，否则会拉伸
  · 动画不能挂在图片或图示上（officecli 只允许顶层 shape / chart 挂动画），
    插件会自动选本页的图表或标题作为动画目标
  · 演讲者备注与动画都是「可选但强烈建议」的——notes 让稿子能直接拿去讲`

/** 生成后的视觉自检清单，供 office_screenshot 拿到图后逐条核对。 */
export const VISUAL_CHECKLIST = `【视觉自检清单】拿到截图后逐条核对，任一条不通过就用 office_batch 修正，最多改 3 轮：
  1. 文字溢出：任何文字是否超出其卡片/色块边界？
  2. 越界：是否有元素被画布边缘裁掉？
  3. 对比度：浅色底上的浅色字、深色底上的深色字是否难辨认？
  4. 对齐：同一页内多个卡片的标题基线是否一致？
  5. 留白：内容是否顶到页边？四周应保留均匀呼吸位。
  6. 密度：单页元素是否过密（>6 个视觉块就该拆分）？反过来，留白是否「均匀稀薄」？
  7. 层级：标题字号是否明显大于正文？数字锚点是否够醒目？
  8. 一致性：跨页的同类元素（卡片圆角、色块、字号）是否统一？
  9. 图表：图表是否被拉伸变形？数据标签是否互相压字？图例是否可读？
 10. 配图：图片是否拉伸变形（原图比例 ≠ 图槽比例）？是否盖住了文字？
 11. 图示：流程图节点文字是否清楚？连线有没有穿过节点？
 12. 全篇：相邻页版式是否重复？非对称版式是否够 30%？是否连续 3 页以上同一个节奏？`

/** 字号阶梯，让模型知道模板已经定好了，不要试图自己指定字号。 */
export const TYPE_SCALE = `【字号阶梯】模板已按此固定，无需自己指定字号（可用 style.typography 整体缩放）：
  封面主标题 ${FONT.coverTitle}pt  章节标题 ${FONT.sectionTitle}pt  数字锚点 ${FONT.anchor}pt
  页面标题 ${FONT.pageTitle}pt  卡片标题 ${FONT.cardTitle}pt  正文 ${FONT.body}pt  引文 ${FONT.quote}pt  脚注 ${FONT.caption}pt
  画布 960×540pt（16:9），12 栏网格，栏宽 60pt、槽宽 16pt，基线 8pt。`

/** 主题清单 + 会被自动识别的说法（用户说"科技蓝"时不需要模型自己翻译）。 */
export function themeCatalog(): string {
  return (
    `【主题】用 deck.theme 指定（缺省随模板或 business-blue）。除 id 外，中文说法、`
    + `行业关键词、十六进制主色都能直接填，插件自动匹配：\n` +
    THEMES.map((t) => `  ${t.id.padEnd(16)} ${t.name}`).join('\n') +
    `\n\n【口语 → 主题对照】用户怎么说都会被识别（写进 deck.theme 即可，无需翻译）：\n` +
    themeAliasCatalog() +
    `\n\n也可以直接给主色：deck.theme = "#0F5EA6"，插件会按色轮派生辅色/强调色/底色，生成一套协调配色。`
  )
}

/** 模板清单（内置 + 用户自定义）。 */
export function templateCatalog(): string {
  const all = allTemplates()
  const builtin = all.filter((t) => !t.custom)
  const custom = all.filter((t) => t.custom)
  const lines = [
    `【模板】用 deck.template 指定，一键获得「专业感外衣」（主题基调 + 内容页装饰 + 页码格式 + 默认转场 + 可选样式微调）：\n` +
      builtin.map((t) => `  ${t.id.padEnd(20)} ${t.name} — ${t.description}`).join('\n') +
      `\n模板与版式正交：换模板不动版式，换版式不动模板；deck.theme 与 deck.style 可覆盖模板默认值。`,
  ]
  if (custom.length > 0) {
    lines.push(
      `\n【自定义模板】（用户/企业放在 ~/.dsh/officecli/templates.json 或项目 .dsh/officecli/templates.json，优先用这些）：\n` +
        custom.map((t) => `  ${t.id.padEnd(20)} ${t.name} — ${t.description}`).join('\n'),
    )
  }
  const errs = templateRegistry.lastErrors()
  if (errs.length > 0) {
    lines.push(`\n⚠️ 自定义模板文件有问题（其余模板不受影响）：\n` + errs.map((e: string) => `  ${e}`).join('\n'))
  }
  return lines.join('\n')
}

/**
 * 样式注入说明：哪些视觉参数开放给用户/模型微调，以及优先级的降序链。
 * 各层之间是**逐级部分覆盖**，不是整层替换。
 */
export function styleCatalog(): string {
  return `【样式注入】优先级从低到高：内置主题 → 模板 style → deck.style → slides[i] 的 background/transition
这里的每一层最终都编译成 officecli 的 --prop 落到 PPT 上（颜色走 theme.color.*，字体走 theme.font.*，字号写进每个 shape 的 size）：
  style.vibe        "科技蓝风格"、"政务红"、"深色科技" 等口语，自动匹配最接近的主题
  style.colors      primary / secondary / accent / bg / text / muted / accent5 / accent6 / hyperlink
                    值支持 #RGB 与 #RRGGBB；改了 bg 会自动重判明暗模式（前景色跟着反转）
  style.fonts       title / body（同时作用于西文+中文），以及 titleLatin / titleEa / bodyLatin / bodyEa
  style.typography  scale（0.6–1.6 整体倍数）或 coverTitle/pageTitle/cardTitle/body/quote/caption 绝对值
                    缩放会连带重算所有文本框的高度，所以放大字号不会溢出
  典型用法：用户说"字能不能再大点" → {"typography":{"scale":1.12}}
  用户说"用我们公司蓝 #0B4F9E" → {"colors":{"primary":"#0B4F9E"}}（辅色/强调色按主色自动派生）`
}

/** office_design_guide 可单独索取的节。 */
export type GuideSection =
  | 'templates'
  | 'themes'
  | 'story'
  | 'limits'
  | 'scale'
  | 'spec'
  | 'checklist'
  | 'style'
  | 'custom'
  | 'elements'

/**
 * 按节返回指南片段。
 *
 * 结构化分段而非事后用子串匹配切全文 —— 后者会把「版式字段契约」这类跨段落的
 * 内容切碎（曾经 spec 节只剩 111 字符，模型看不到 layout 字段表）。
 */
export function guideSections(): Record<GuideSection, string> {
  return {
    templates: templateCatalog(),
    themes: themeCatalog(),
    story: NARRATIVE_GUIDE,
    limits: LENGTH_LIMITS,
    scale: TYPE_SCALE,
    spec: DECK_SPEC_HELP,
    checklist: VISUAL_CHECKLIST,
    style: styleCatalog(),
    custom: CUSTOM_TEMPLATE_HELP,
    elements: ELEMENT_GUIDE,
  }
}

/** 自定义模板的写法说明（面向「把这个规范固化下来」的需求）。 */
export const CUSTOM_TEMPLATE_HELP = `【自定义模板】把企业 VI / 个人偏好固化成模板，之后一句"用 xx 模板"即可复用。
文件位置（均可选，同名 id 后者覆盖前者）：
  $DSH_OFFICECLI_TEMPLATES  多个 .json 路径，用 ; 分隔
  ~/.dsh/officecli/templates.json          全局个人模板
  <项目目录>/.dsh/officecli/templates.json 项目级模板（随仓库提交）
文件格式（数组或 {"templates":[...]} 均可）：
[
  {
    "id": "corp-vi",                  // 必填，小写字母/数字/-/_
    "name": "公司标准汇报",             // 展示名
    "description": "深蓝主色 + 底部金线",
    "extends": "consulting",          // 可选：继承内置模板，只覆盖差异字段
    "theme": "business-blue",         // 主题 id / 中文说法 / 主色 hex 均可
    "transition": "fade",
    "pageNumber": "{n} / {total}",
    "contentDecor": { "rail": true, "footerRule": true, "badge": true },
    "layouts": ["cover", "bullets", "kpi", "cards", "ending"],
    "style": {
      "colors": { "primary": "#0B4F9E", "accent": "#C8A45C" },
      "fonts":  { "title": "微软雅黑", "body": "等线" },
      "typography": { "scale": 1.05 }
    }
  }
]
装饰可选值：rail（左侧色轨）/ topbar（顶部色条）/ corner（右上装饰圆）/ badge（左上页码徽章）/ footerRule（页脚细线）。
改完文件无需重启插件：下一次 office_* 调用会自动重载（按文件修改时间判定）。`

/** 完整设计指南，给 office_design_guide 工具返回。 */
export function designGuide(section?: GuideSection): string {
  const sections = guideSections()
  if (section !== undefined) return sections[section]
  return [
    '# PPT 设计指南',
    '',
    sections.templates,
    '',
    sections.themes,
    '',
    sections.style,
    '',
    sections.elements,
    '',
    sections.story,
    '',
    sections.limits,
    '',
    sections.scale,
    '',
    sections.spec,
    '',
    sections.checklist,
  ].join('\n')
}
