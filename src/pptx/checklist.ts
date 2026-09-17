import { FONT } from './grid.js'
import { DECK_SPEC_HELP } from './deck.js'
import { THEMES, themeAliasCatalog } from './theme.js'
import { styleIndex } from './styles.js'
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
  ── 结构性（致命）──
  1. 文字溢出：任何文字是否超出其卡片/色块边界？
  2. 越界：是否有元素被画布边缘裁掉？
  3. 对比度：浅色底上的浅色字、深色底上的深色字是否难辨认？
  4. 对齐：同一页内多个卡片的标题基线是否一致？
  5. 留白：内容是否顶到页边？四周应保留均匀呼吸位。
  6. 密度：单页元素是否过密（>6 个视觉块就该拆分）？反过来，留白是否「均匀稀薄」？
  7. 层级：数字锚点是否够醒目？关键结论是否有明确的视觉入口？
  8. 一致性：跨页的同类元素（卡片圆角、色块、字号）是否统一？
  9. 图表：图表是否被拉伸变形？数据标签是否互相压字？图例是否可读？
 10. 配图：图片是否拉伸变形（原图比例 ≠ 图槽比例）？是否盖住了文字？
 11. 图示：流程图节点文字是否清楚？连线有没有穿过节点？
 12. 全篇：相邻页版式是否重复？非对称版式是否够 30%？是否连续 3 页以上同一个节奏？
  ── 审美性（决定它是「合格」还是「好看」）──
 13. 字号层级：最大字号 ÷ 正文字号是否 ≥2.5？全篇是否至少 3 个可分辨的层级？（全篇字都差不多大 = 没有层级）
 14. 色彩克制：有彩色是否 ≤3 个 + 1 组中性色？有没有出现紫渐变、霓虹 glow、彩虹配色这类「通用 AI 味」？
 15. 字体克制：全篇是否 ≤2 个字体家族（标题一个 + 正文一个）？有没有字体回退成宋体的迹象？
 16. 风格一致性：所选流派的 anti-pattern 是否被违反？封面/章节页压在主色上的前景字读得清吗？
 17. 概念：盖住所有文字，还认得出这是讲什么主题的稿子吗？认不出说明视觉没在承担表达。`

/** 叙事与密度门禁。 */

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
    `\n\n也可以直接给主色：deck.theme = "#0F5EA6"，插件会按三步推导协议（采样 → 收敛 → 论证）` +
    `生成一套协调配色：主色 chroma 收进印刷油墨区间、辅色取邻近色、强调色取对比色、` +
    `其余色槽只做同色相明度阶与去饱和中性序列（有彩色收敛到 3 个 + 1 组中性），` +
    `并附一句 colorRationale 说明为什么是这组色。` +
    `\n⚠️ 更好的做法是同时给 deck.style.preset 一套风格（见 styles 节）—— ` +
    `主题只决定颜色，风格还决定字体、字号策略、装饰与版式取舍。`
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
  return `【样式注入】优先级从低到高：内置主题 → 模板 style → deck.style.preset（风格预设）→ deck.style 的 colors/fonts/typography
这里的每一层最终都编译成 officecli 的 --prop 落到 PPT 上（颜色走 theme.color.*，字体走 theme.font.*，字号写进每个 shape 的 size）：
  style.preset     视觉流派预设（见 styles 节），一次性落地配色/字体/字号/装饰/转场/页码。
                   用户给了品牌主色时它会做同源色相迁移，而不是整组换掉。
  style.vibe       "科技蓝风格"、"政务红"、"深色科技" 等口语，只影响主题（颜色），不影响流派
  style.colors     primary / secondary / accent / bg / text / muted / accent5 / accent6 / hyperlink
                   值支持 #RGB 与 #RRGGBB；改了 bg 会自动重判明暗模式（前景色跟着反转）
  style.colorRationale  一句话说明「为什么是这组色」（三步推导的第三步）。写了会覆盖插件
                   自动生成的论证句；这一步是防 slop 的自检门，不要跳过。
  style.fonts      title / body（同时作用于西文+中文），以及 titleLatin / titleEa / bodyLatin / bodyEa
  style.typography scale（0.6–1.6 整体倍数）或 coverTitle/pageTitle/cardTitle/body/quote/caption 绝对值
                   缩放会连带重算所有文本框的高度，所以放大字号不会溢出
  典型用法：用户说"字能不能再大点" → {"typography":{"scale":1.12}}
  用户说"用我们公司蓝 #0B4F9E" → {"preset":"bento","colors":{"primary":"#0B4F9E"}}
  用户说"要那种大字报的感觉" → {"preset":"大字报风格"}（别名同样能解析）`
}

/** office_design_guide 可单独索取的节。 */
export type GuideSection =
  | 'templates'
  | 'themes'
  | 'styles'
  | 'form'
  | 'story'
  | 'slop'
  | 'limits'
  | 'scale'
  | 'spec'
  | 'checklist'
  | 'style'
  | 'review'
  | 'custom'
  | 'elements'

/**
 * form 推导五问。
 *
 * 这一节回答的是「版式怎么来的」—— 比任何配色规则都更能决定成品质量。模板把
 * 坐标算好了，但**为什么这页该用这个版式**只有内容能回答。五问是「设计从内容
 * 长出来」的最小可执行形式。
 */
export const FORM_GUIDE = `【form 推导五问】决定每页版式之前，先答这五个问题（答不出的那页，说明内容还没想清）：
  ① 叙事角色  这页是 hero（视觉高潮：封面/章节/关键数据/结束）/ 常规内容 / 章节转场？
              全篇 hero 应占 20–30%，两个 hero 之间至少隔 1 页内容页。
  ② 观众距离  投屏（10m）/ 笔记本（1m）/ 手机（10cm）？—— 决定字号与信息密度。
              投屏稿每页只能有一个观点；阅读型稿可以密。
  ③ 视觉温度  安静 / 兴奋 / 冷静 / 权威 / 温柔？—— 决定选哪套风格与主题。
  ④ 容量估算  用纸笔画 3 个 5 秒 thumbnail，算一下这些内容塞得下吗？
              这步是防溢出/防挤压最有效的手段，比事后改字号便宜得多。
  ⑤ 视觉母题  这份内容**独有**的视觉母题是什么？找一个别的主题不会有的元素/结构/隐喻。
              这是「设计从内容长出来」的最小证据。
五问答完再定色彩/字体/版式节奏 —— 系统要服务于答案，不是先选系统再塞内容。
交付时写一句「form 来自内容的哪里」（写进 notes 或回复里）。写不出来 = 在套模板，回去重答第 ⑤ 问。

怎么把五问落到版式上（③④ 决定 hero/内容页的取舍）：
  第 ① 问是 hero    → cover / section / kpi / image-full / quote / ending
  第 ① 问是内容     → bullets / cards / compare / steps / table / swot / pricing / roadmap / agenda / timeline
  第 ① 问是转场     → section（不要用它凑页数）
  第 ② 问偏投屏     → 减少每页元素数、放大字号（style.typography.scale 1.05–1.16）
  第 ② 问偏阅读     → bullets 两栏 / table / 提高密度（scale 0.95–1.0）
  第 ⑤ 问答不出来   → 别急着选风格，先回到内容里找母题`

/**
 * 反 AI slop + 色彩推导协议。
 *
 * 这两件事放在同一节是因为它们同源：slop 的配色侧表现（紫渐变、霓虹 glow）
 * 正是「凭空发明颜色」的产物。一个是**不做错的事**，一个是**做对的事**。
 */
export const SLOP_GUIDE = `【反 AI slop】slop = 训练语料里的「视觉最大公约数」：不丑，但不携带任何信息量。
规避它不是审美洁癖，是保护你的稿子不被认成「又一个 AI 做的 PPT」。

禁区（命中会在生成前体检里被警告）：
  · 均匀深蓝底 #0D1117 + 通用青/紫霓虹 glow —— 这是最大 cliché（"GitHub-dark 偷懒解"）
  · 激进紫渐变万能公式（紫→粉→蓝当"科技感"用）
  · 圆角卡片 + 左侧彩色 border accent（2020–2024 的烂大街组合）
  · emoji 当图标；每个标题都配一个 icon
  · 每个背景都渐变、每个数字都配装饰、每张卡都加阴影
  · 封面图加个人署名/水印
⚠️ 不是「暗色一律禁」：电影级戏剧光影、暖色暗场、黑底数字剧场都是有作者意图的
   暗色，合法且好用 —— 要禁的只有「均匀深蓝底 + 通用霓虹 glow」这一种偷懒组合。

正向做法（这些是「有品味」的信号，也是 AI 最容易漏掉的细节）：
  · 一个细节做到 120%，其他做到 80% —— 品味是在合适的地方够精致，不是均匀用力
  · 删掉任何「因为好看所以加上去」的元素：删掉它设计会变差吗？不会就该删
  · 中文用「」引号不用 ""（排印细节是 AI 分不清的品味税）
  · 内容够多就用 bullets 两栏，不要为了「看起来丰富」切成四张卡

【色彩推导三步】不要凭空发明颜色 —— 从模型先验里抽签，抽出来的永远是那几个网红色。
  ① 采样  主色只能从三个来源取：用户品牌资产（logo/VI）｜内容自带的文化语境｜用户明说
          的色值。三者都没有时，先问用户要，或从内容里找一个有语义的色。
  ② 收敛  压到「2–3 个有彩色 + 1 组中性色」。有彩色之间色差 ΔE ≥ 0.15（或色相角 ≥60°、
          或明度差 ≥0.3），保证投屏上分得开。中性色写成明度序列（不是一堆孤立灰）。
  ③ 论证  写一句话说明「为什么是这个色」，填进 deck.style.colorRationale。
          ⚠️ 写不出这句话 = 你在抄配方。论证是防 slop 的自检门，不是仪式。
  本插件已经把 ②③ 自动化了一部分：给 deck.theme 一个主色（或 deck.style.colors.primary），
  插件会按 OKLCH 收敛出整套配色并生成论证句。你只需要负责 ① 和说明为什么选这个主色。

印刷色质感：屏幕色拉到满 chroma 会发荧光，PPT 投屏后尤其廉价 —— 人眼被印刷品训练出的
「高级感」，本质是 CMYK 色域更窄带来的那层灰度。
   大面积底色   chroma 0.01–0.04（纸感、不刺眼）
   品牌主色     chroma 0.08–0.15（油墨感，够醒目但不塑料）
   小面积点睛   chroma 0.15–0.22（保留活力，仅限小面积）
   >0.25 满版   慎用（屏幕荧光感）
同一色相换个语境就换了个身份：朱红（低 chroma、偏橙、更暗）= 传统/庄重；可乐红（高饱和
正红）= 消费/兴奋。蓝色尤其要警惕：#0066FF 系的「科技蓝」是模型的默认抽签结果，用之前
先问自己是不是在偷懒。`

/** 风格预设的使用说明（含流派索引）。 */
export function styleGuide(): string {
  return `【风格预设】用 deck.style.preset 指定一套**视觉流派**。它与 template 正交：
  template 管场景（这是开什么会用的稿子），preset 管流派（这份稿子的视觉语言是什么）。
填了 preset，插件会自动落地：配色（含品牌色同源迁移）/ 字体 / 字号策略 / 封面装饰 / 转场 / 页码。
流派索引（id　名称　密度　适配场景）：
${styleIndex()}

取某一套的完整定义（配色锚点、字体、字号、anti-pattern、色彩论证）：
  office_design_guide({ section: 'styles', style: '<id>' })
用法要点：
  · 用户给了品牌主色 → 同时填 style.colors.primary，插件会把该流派的**有彩色**整体迁到
    品牌色相上（中性灰阶不动），保留流派手工调过的色彩关系；
  · 优先级：preset 低于 style.colors / fonts / typography，高于 template 的样式与 deck.theme；
  · 每套流派的 anti-pattern 会被体检检查：出现它明确排除的版式会收到警告；
  · 拿不准选哪套时，先调 office_deck_directions 出三个差异化方向的真实初稿给用户挑。`
}

/**
 * 设计评审：6 个维度（含概念一票否决）+ 输出模板。
 *
 * 不进 `designGuide()` 的全量返回 —— 它只在「用户要求评审 / 你想主动质检」时才需要，
 * 占着每次生成的上下文预算不划算，按需索取即可。
 */
export const REVIEW_GUIDE = `【设计评审】用户提「评审 / 好不好看 / 打分 / review」，或你想主动质检时用，按文末模板输出。

第 0 维 · 概念/立意（权重最高，一票否决）
  先问「这个设计有没有一个 idea」，再看它做得好不好。执行是放大器，放大一个空洞的
  概念只会更空洞。
    9-10  有一个从内容里长出来的独有 idea，视觉母题不可替换
    7-8   立意明确，母题与内容相关
    5-6   只有风格没有概念：好看，但没说任何东西
    3-4   通用模板套皮，概念层为零
    1-2   连风格都没选对，纯装饰堆砌
  ⚠️ 一票否决：概念 ≤5 分时总评封顶 6.0。后面几维全是 execution，execution 再精致
     也拉不回一个没有 idea 的设计 —— 那只是把模板打磨得更亮。
  自检：盖住所有文字和 logo，还认得出主题吗？（文字即母题的排版设计除外，改问：
  这套文字处理换个主题还成立吗）换个客户名还成立吗？成立 = 模板，本维直接 ≤5。

第 1 维 风格一致性  是否贯彻了所选流派的标志性手法？有没有自相矛盾的元素（选了极简却塞满内容）？
第 2 维 视觉层级    最大字号 ÷ 正文字号 ≥2.5 且全篇至少 3 个可分辨层级；眯起眼看还分得出主次吗？
第 3 维 细节执行    间距是否统一（8pt 网格）｜颜色是否受控（≤3-4 种）｜字体家族 ≤2｜对齐是否精确
第 4 维 功能性      删掉任何一个元素设计会变差吗？不会就该删｜关键信息是否在最显眼的位置
第 5 维 创新性      是否避开了常见 cliché？有没有「意想不到但很合理」的设计决策？

PPT 场景的侧重：视觉层级与功能性最重要，细节执行次之，创新性可以放宽（清晰优先）。
评审设计，不评设计师。

输出模板：
## 设计评审报告
**总体评分** X.X/10 ［优秀 8+ / 良好 6-7.9 / 需改进 4-5.9 / 不合格 <4］
（概念 ≤5 时总评封顶 6 分，先修概念再谈执行）
**分项** 概念 X/10（一句话讲出它的 idea）｜风格一致性 X/10｜视觉层级 X/10｜细节执行 X/10｜功能性 X/10｜创新性 X/10
### 优点（Keep）
### 问题（Fix，按严重程度排序）
**1. [问题名称]** ⚠️致命 / ⚡重要 / 💡优化
  当前：｜问题：｜修复：（具体操作，含数值）
### 快速修复清单（Quick Wins）
如果只有 5 分钟，优先做这 3 件事：`

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
    styles: styleGuide(),
    form: FORM_GUIDE,
    story: NARRATIVE_GUIDE,
    slop: SLOP_GUIDE,
    limits: LENGTH_LIMITS,
    scale: TYPE_SCALE,
    spec: DECK_SPEC_HELP,
    checklist: VISUAL_CHECKLIST,
    style: styleCatalog(),
    review: REVIEW_GUIDE,
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

/**
 * 完整设计指南，给 office_design_guide 工具返回。
 *
 * ⚠️ 长度预算：全量约 1.4 万字符。新增内容必须与现有节**合并去重**（比如反 slop
 * 与叙事门禁同源，就不能两边各讲一遍卡片横排），否则模型读不完等于没写。
 * `review` 节刻意不进全量 —— 它只在评审场景需要，按需索取。
 */
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
    sections.styles,
    '',
    sections.style,
    '',
    sections.elements,
    '',
    sections.form,
    '',
    sections.story,
    '',
    sections.slop,
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

/** 完整指南的字符数（供 smoke 脚本盯着长度预算，别让它悄悄膨胀）。 */
export function designGuideSize(): { full: number; sections: Record<string, number> } {
  const sections = guideSections()
  const sizes: Record<string, number> = {}
  for (const [k, v] of Object.entries(sections)) sizes[k] = v.length
  return { full: designGuide().length, sections: sizes }
}
