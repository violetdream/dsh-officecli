/**
 * PPT 风格库（艺术指导预设层）。
 *
 * 与 `templates.ts` 的分工：**模板管场景**（咨询简报 / 政务报告 / 教学课件 —— "这是
 * 什么场合用的稿子"），**风格管流派**（新瑞士大字报 / Bento / 断言-证据 —— "这份
 * 稿子的视觉语言是什么"）。两者正交：换风格不动场景，换场景不动流派。
 *
 * ## 从哪来
 *
 * 移植自 huashu-design 的 `references/design-styles.md`（MIT，Copyright (c) 2026
 * alchaincyf）的「PPT 风格库」半区，并做了三处必要改造：
 *
 * 1. **只保留原生 pptx 可表达的流派。** 原库 20 种里有若干种灵魂在「AI 生图 /
 *    手绘插画」（玩味手绘极简、Y2K 膨胀大字、杂志撞色数据页的部分做法）—— 本
 *    插件没有配图生成能力，硬推只会让模型做出一版劣化品。这些流派**整体剔除**，
 *    而不是标个 `needsImages` 放在池子里等误选。因此本库默认池里没有一条依赖配图。
 * 2. **网格不可破。** huashu 的「不羁玩梗流行版」靠打破网格取胜，而本插件的版式
 *    强制吸附 12 栏网格。这类流派保留色彩与内容节奏的部分，并在 `degrade` 里
 *    **如实标注降级点** —— 不假装做出了原版质感。
 * 3. **色板全部走 OKLCH 推导。** 每条风格给的是**锚点**（示例色值），用户给了品牌
 *    主色时由 `applyStyle` 走 {@link rebaseColor} 做同源色相迁移 —— 保留这套风格
 *    手工调过的色相关系（谁是邻近色、谁是对比色），只把色相整体搬过去。直接把
 *    hex 写死会让 100 个用户拿到 100 份同色产出，色彩的信息量归零。
 *
 * 字体一律取 Windows 必装项（已在本机 Fonts 目录逐一核实存在），保证打开后不回退。
 */

import type { LayoutId } from './layouts.js'
import type { ContentDecor } from './templates.js'
import { hexToOklch, normalizeHex, rebaseColor, type Theme } from './theme.js'

/** 风格温度：决定三方向推荐里的角色（安静底盘 / 中性主力 / 大胆破局）。 */
export type StyleTemp = '大胆' | '中性' | '安静'

/** 风格的字号策略（缺省项沿用 `grid.ts` 的阶梯）。 */
export interface StyleTypography {
  scale?: number
  coverTitle?: number
  sectionTitle?: number
  anchor?: number
  pageTitle?: number
  cardTitle?: number
  body?: number
  quote?: number
  caption?: number
}

/** 一套 PPT 视觉流派的完整定义。 */
export interface PptStyle {
  id: string
  /** 中文名（用户与模型都用这个称呼）。 */
  name: string
  /** 灵感出处 —— 写清楚"这不是我编的"，模型据此判断取舍。 */
  origin: string
  temp: StyleTemp
  /** 视觉 DNA，一句话。 */
  dna: string
  /** 适配场景关键词，同时用于「内容 → 风格」的自动匹配。 */
  fit: string[]
  /** 内容写法要求：这套风格要求**内容怎么组织**，不只是配色。 */
  write: string
  /** 诚实降级说明（原流派有而 pptx 载体做不出的部分）。 */
  degrade?: string
  /**
   * 点睛色是「压在主色块上」设计的。
   *
   * 这类风格的 `accent` 在白底上对比度必然很低（荧光黄压白纸本来就不成立），
   * 但它压在满版主色块上是对的。标了本字段的风格，页面上的强调请改用
   * `secondary`；检查脚本与评审也会跳过它的 accent/bg 对比度校验。
   */
  accentOnPlate?: boolean
  dark: boolean
  /** 色板锚点（6 位 hex、不带 `#`）。 */
  palette: {
    primary: string
    secondary: string
    accent: string
    bg: string
    text: string
    muted: string
    accent5: string
    accent6: string
    hyperlink?: string
  }
  /** hero 页渐变（`C1-C2-ANGLE`），缺省由 primary 向深色 25% 生成。 */
  heroGradient?: string
  fonts: { titleLatin: string; titleEa: string; bodyLatin: string; bodyEa: string }
  typography?: StyleTypography
  /** 密度档：影响每页字数下限（sparse 放宽、dense 收紧）。 */
  density: 'sparse' | 'normal' | 'dense'
  /** 内容页装饰。 */
  decor?: ContentDecor
  coverDecor: 'circles' | 'grid' | 'band' | 'none'
  transition?: string
  pageNumber?: boolean | string
  /** 推荐版式（按优先级）。 */
  prefer: LayoutId[]
  /** 这套风格下明显不成立的版式。 */
  avoid: LayoutId[]
  /** 决定版式时顺手记下的「这页不能怎么排」。 */
  anti: string[]
  /**
   * 色彩论证：为什么是这组色。
   *
   * 三步推导协议（采样 → 收敛 → 论证）的最后一步。写不出这句话 = 在抄配方，
   * 所以它是必填。用户给了品牌色时，{@link applyStyle} 会在这句后面追加迁移说明。
   */
  rationale: string
}

/**
 * 内置风格库。
 *
 * 温度配比故意让**大胆款占多数**：模型的确定性偏差天然偏安静极简，库里如果
 * 安静款居多，推荐出来的永远是「白底 + 留白 + 一个点缀色」。配比本身就是校正项。
 */
export const PPT_STYLES: readonly PptStyle[] = [
  // -------------------------------------------------------------------------
  // 大胆派
  // -------------------------------------------------------------------------
  {
    id: 'neo-swiss',
    name: '新瑞士大字报',
    origin: 'AI/SaaS 路演 deck 的 Big-Number Editorial 流派（Scribe、Flock Safety 级别）；Bloomberg Businessweek 信息图；Pentagram',
    temp: '大胆',
    dna: '纯白或近黑底 + 单一高饱和强调色 + 中性网格线；标题占半屏，数字用等宽收紧字距',
    fit: ['融资', '路演', 'BP', 'QBR', '复盘', '年度', '趋势', '战略', '关键页', '发布', '汇报', '经营'],
    write: '标题写成断言整句（"三年复购率翻倍"不是"复购率分析"）；每页只留一个大数字当锚点；正文克制到 1-2 行，宁少勿多。',
    dark: false,
    palette: {
      primary: '0A0A0A', secondary: '2D5BFF', accent: 'FF5A1F',
      bg: 'FFFFFF', text: '0A0A0A', muted: '6B7280', accent5: '5B5B5B', accent6: 'E5E5E5',
    },
    fonts: { titleLatin: 'Bahnschrift', titleEa: '黑体', bodyLatin: 'Segoe UI', bodyEa: '微软雅黑' },
    typography: { scale: 1.14, coverTitle: 66, pageTitle: 32, anchor: 82, body: 16 },
    density: 'normal',
    decor: { footerRule: true },
    coverDecor: 'none',
    transition: 'fade',
    prefer: ['cover', 'kpi', 'chart', 'section', 'compare', 'bullets', 'table', 'ending'],
    avoid: ['pricing', 'swot'],
    anti: [
      '不要把核心数字塞进等宽卡片横排 —— 这套风格的数字要独占版面',
      '不要给标题配图标或装饰线，字重与字号本身就是层级',
      '不要用渐变，锐利感来自纯色块与网格线',
    ],
    rationale: '主色取近黑 #0A0A0A 承担大色块与标题；强调色取电光蓝 #2D5BFF（内容多偏融资与数据，需要冷静的科技信号）；第二系列用信号橙 #FF5A1F 与蓝拉开约 140° 色相角，保证图表双系列在投屏上分得开；其余降为中性灰阶，让标题自然成为唯一主角。',
  },
  {
    id: 'black-stage',
    name: '黑底巨型数字剧场',
    origin: 'Steve Jobs 2007 iPhone Keynote、小米 SU7 发布会、Spotify Wrapped、Presentation Zen',
    temp: '大胆',
    dna: '纯黑底 + 纯白字高反差，一页只点亮一个品牌色；一屏一个超大数字或一句话',
    fit: ['发布', '主题演讲', 'Keynote', '全员', 'town hall', '情绪', '年度回顾', '里程碑', '愿景'],
    write: '一页只承载一个数字或一句断言；数字后面必须跟一行小注说明它意味着什么；用大量负空间，不要试图填满。',
    dark: true,
    palette: {
      primary: '000000', secondary: '2997FF', accent: 'FF6900',
      bg: '000000', text: 'FFFFFF', muted: '8A8A93', accent5: '5A5A5F', accent6: '3A3A3F',
    },
    fonts: { titleLatin: 'Bahnschrift', titleEa: '黑体', bodyLatin: 'Segoe UI', bodyEa: '等线' },
    typography: { scale: 1.16, coverTitle: 68, anchor: 90, pageTitle: 30, body: 16 },
    density: 'sparse',
    coverDecor: 'none',
    transition: 'fade',
    pageNumber: false,
    prefer: ['cover', 'kpi', 'quote', 'section', 'compare', 'ending'],
    avoid: ['cards', 'swot', 'table', 'diagram'],
    anti: [
      '一页只放一个数字或一句话，不要塞第二条信息',
      '不要用卡片网格 —— 黑场的张力来自负空间',
      '不要给数字加渐变或 3D 效果，扁平大字就够',
    ],
    rationale: '纯黑 #000000 是这套风格的载体（对应发布会暗场），白字保证投屏与录像都清晰；只保留品牌蓝 #2997FF 一个强调色，用来点亮当页唯一的关键数字；没有第四个颜色 —— 黑场里多一个颜色就破功。',
  },
  {
    id: 'mono-pop',
    name: '高饱和单色品牌撞色海报',
    origin: 'Spotify Wrapped 视觉系统、Mailchimp Brand Book（Collins）、Netflix 红黑、COLLINS 品牌系统',
    temp: '大胆',
    dna: '单一品牌主色满版铺底 + 黑或白反差字，字体本身当主视觉',
    fit: ['品牌', '营销', 'campaign', '活动', '文化', '宣讲', '主视觉', '传播'],
    write: '标题用超大字顶天立地（形式即内容）；一页一个口号，不要解释性正文；用两色块上下或左右分割制造撞击。',
    accentOnPlate: true,
    dark: false,
    palette: {
      primary: 'E01B24', secondary: '111111', accent: 'FFCC00',
      bg: 'FFFFFF', text: '111111', muted: '6B7280', accent5: 'A3121A', accent6: 'FFCC00',
    },
    fonts: { titleLatin: 'Impact', titleEa: '黑体', bodyLatin: 'Arial', bodyEa: '微软雅黑' },
    typography: { scale: 1.1, coverTitle: 76, anchor: 88, pageTitle: 34, body: 16 },
    density: 'sparse',
    coverDecor: 'none',
    transition: 'push',
    prefer: ['cover', 'section', 'kpi', 'quote', 'ending'],
    avoid: ['table', 'swot', 'diagram', 'timeline'],
    anti: [
      '不要在白底上用小色块点缀 —— 满版撞色才是这套风格',
      '同页不要出现第三种颜色，撞色只有两方',
      '正文不要用彩色，反差字只有黑或白两种',
    ],
    rationale: '主色取品牌红 #E01B24 满版铺底（这套风格的核心是"色块即版面"）；文字只用黑/白两档做反差，不再引入第二个有彩色；黄色 #FFCC00 仅作小面积点睛。颜色越少，撞色越狠。',
  },
  {
    id: 'gradient-manifesto',
    name: '全幅渐变宣言版式',
    origin: 'Zuora「Tell a Different Story」销售 deck（Andy Raskin 拆解）、Nike 宣言 campaign、National Geographic 跨页',
    temp: '大胆',
    dna: '满版渐变出血铺底 + 反白宣言大字；一页就是一句话',
    fit: ['使命', '愿景', '宣言', '提案', '转折页', '品牌', '战略', '开源', '号召'],
    write: '宣言页只放一句话（≤20 字），不要配 bullet；渐变的暗端承载反白字，字压在最暗处才读得出来。',
    degrade: '原流派靠纪实大照片铺底，本插件无配图生成能力，降级为 CSS 式纯渐变铺底 + 大字 —— 视觉张力约损失 15%，请勿把它当"有图版"使用。',
    dark: false,
    palette: {
      primary: 'D2471F', secondary: '8B5CF6', accent: '0E7490',
      bg: 'FFFFFF', text: '1C1917', muted: '78716C', accent5: '7C2D12', accent6: 'FFD166',
    },
    heroGradient: 'D2471F-9F1239-135',
    fonts: { titleLatin: 'Bahnschrift', titleEa: '黑体', bodyLatin: 'Segoe UI', bodyEa: '微软雅黑' },
    typography: { scale: 1.1, coverTitle: 64, pageTitle: 32, anchor: 80, body: 16 },
    density: 'normal',
    coverDecor: 'none',
    transition: 'fade',
    prefer: ['cover', 'section', 'quote', 'kpi', 'bullets', 'ending'],
    avoid: ['table', 'swot', 'timeline'],
    anti: [
      '宣言页只放一句话，不要配 bullet 列表',
      '渐变只用于整幅铺底，不要给单个色块加渐变',
      '不要把正文压在渐变最亮的位置 —— 反白字需要足够暗的底',
    ],
    rationale: '内容偏使命与提案，主色取暖橙 #D2471F 铺满版渐变（比冷色更有"该动起来"的情绪）；强调色用冷青 #0E7490 与暖调对撞，保证在白底页上写得出字（原流派的亮黄点睛挪到 accent6，只压在渐变块上用）；辅色紫罗兰与主色 ΔE 拉开，承载第二系列。',
  },
  {
    id: 'candy-lecture',
    name: 'CS50 单概念糖果舞台',
    origin: 'Harvard CS50（David Malan）、Lessig Method / 高桥流、Presentation Zen',
    temp: '大胆',
    dna: '深黑底 + 一页一个高饱和糖果色大字；强舞台聚光，文字极少',
    fit: ['教学', '课件', '讲座', '概念', '培训', '科普', '入门', '原理'],
    write: '一屏一个概念，标题就是那个概念本身（≤8 字）；只讲一个因果，不要并列三个论点；代码或公式单独占一页。',
    dark: true,
    palette: {
      primary: '0A0A0A', secondary: '00E5FF', accent: 'FF2D95',
      bg: '0A0A0A', text: 'FFFFFF', muted: '9098A1', accent5: 'FFD500', accent6: '4A4A52',
    },
    fonts: { titleLatin: 'Segoe UI', titleEa: '微软雅黑', bodyLatin: 'Segoe UI', bodyEa: '等线' },
    typography: { scale: 1.12, coverTitle: 70, anchor: 92, pageTitle: 30, body: 17 },
    density: 'sparse',
    coverDecor: 'none',
    transition: 'fade',
    prefer: ['cover', 'kpi', 'quote', 'section', 'bullets', 'diagram', 'ending'],
    avoid: ['table', 'cards', 'pricing', 'swot'],
    anti: [
      '一屏一个概念，不要在一页里讲两件事',
      '糖果色每页只用一种、逐页轮换，不要同页混用',
      '不要用卡片承载概念 —— 深黑场上的大字本身就是版面',
    ],
    rationale: '深黑底 + 单色大字是这套风格的舞台聚光（观众的注意力只剩一个焦点）；糖果色每页轮换一种，避免荧光色互撞；正文用暖白而非纯白，长时间投影不刺眼。',
  },
  {
    id: 'irreverent-pop',
    name: '不羁玩梗流行版',
    origin: 'Reddit Ads 销售 deck、David Carson 式不羁排版、90 年代 web 复古、Memphis 玩味',
    temp: '大胆',
    dna: '橙红撞色 + 口语化玩梗标题，fun 页与 facts 页交替制造节奏反转',
    fit: ['社区', '创作者', 'Z世代', '玩梗', '增长', '运营', '社群', '年轻'],
    write: '标题可以口语化甚至可以玩梗，但正文必须给出严肃事实；全篇必须安排"严肃数据页"做节奏反转，不能一路玩到底。',
    degrade: '原流派靠"打破网格 / 混合字号 / 错位叠放"制造不羁感，本插件版式强制吸附 12 栏网格，这部分降级为"靠标题字号与撞色造反差"。',
    dark: false,
    palette: {
      primary: 'FF4500', secondary: '1A1A1A', accent: '3B82F6',
      bg: 'FFFBF5', text: '1A1A1A', muted: '6B7280', accent5: 'C2410C', accent6: 'FDE047',
    },
    fonts: { titleLatin: 'Trebuchet MS', titleEa: '黑体', bodyLatin: 'Segoe UI', bodyEa: '微软雅黑' },
    typography: { scale: 1.08, coverTitle: 64, pageTitle: 34, anchor: 78, body: 17 },
    density: 'normal',
    decor: { badge: true },
    coverDecor: 'none',
    transition: 'push',
    prefer: ['cover', 'kpi', 'bullets', 'compare', 'cards', 'quote', 'ending'],
    avoid: ['table', 'diagram'],
    anti: [
      '标题可以玩梗，正文必须严肃 —— 反差才是这套风格的笑点',
      '全篇至少安排一页"严肃数据页"，节奏反转是它的关键',
      '不要给每一页都加梗，会变成廉价',
    ],
    rationale: '主色取橙红 #FF4500（社区与创作者语境的色彩记忆）；底色用暖白 #FFFBF5 而非纯白，呼应 90s web 的复古质感；蓝 #3B82F6 是唯一的冷色对比，专门用来标记"严肃数据页"。',
  },

  // -------------------------------------------------------------------------
  // 中性派
  // -------------------------------------------------------------------------
  {
    id: 'bento',
    name: 'Bento 便当格模块网格',
    origin: 'Apple Keynote 的 Bento Grid 时代、新一代 MBB Bento/Big-Type deck、Stripe 年报指标卡矩阵',
    temp: '中性',
    dna: '浅灰底 + 不等高卡片网格，每格一个洞见（数字 / sparkline / 一句话）',
    fit: ['产品', '功能', 'QBR', '成果', '指标', '汇总', '矩阵', '能力', '数据汇报'],
    write: '每张卡只放一个洞见，不要在一张卡里讲两件事；卡片大小要不等高（大卡承载主洞见，小卡做补充）；KPI 数字用等宽数字。',
    dark: false,
    palette: {
      primary: '2563EB', secondary: '0EA5E9', accent: 'C2410C',
      bg: 'F5F5F7', text: '111827', muted: '6B7280', accent5: '1E40AF', accent6: 'E5E7EB',
    },
    fonts: { titleLatin: 'Segoe UI', titleEa: '微软雅黑', bodyLatin: 'Segoe UI', bodyEa: '微软雅黑' },
    typography: { scale: 1.05, pageTitle: 30, cardTitle: 20, body: 16, anchor: 76 },
    density: 'dense',
    decor: { footerRule: true },
    coverDecor: 'circles',
    transition: 'fade',
    prefer: ['cards', 'kpi', 'chart', 'table', 'roadmap', 'compare', 'bullets'],
    avoid: ['quote', 'image-full'],
    anti: [
      '不要让所有格子等高 —— Bento 的关键是不等高带来的呼吸感',
      '每张卡只放一个洞见，不要塞两件事',
      '不要给卡片加圆角以外的装饰',
    ],
    rationale: '底色取浅灰 #F5F5F7 而非纯白，让卡片"浮起来"而不是靠边框分隔；主色蓝承载标题与主体，KPI 数字用焦橙 #C2410C（冷暖互补才跳得出来 —— 原流派的琥珀黄在浅灰底上对比度只有 1.97，读不出字，已按可读性下调色阶）；其余为中性灰阶，承担卡片底与说明文字。',
  },
  {
    id: 'dark-terminal',
    name: 'Neo-Swiss 暗色终端美学',
    origin: 'Linear pitch deck、Vercel 设计语言、CS50 深黑舞台课件',
    temp: '中性',
    dna: '中性近黑底 + 1px hairline 网格 + 单一紫蓝强调 + 等宽字标签',
    fit: ['开发者', '工具', '技术', '工程', '架构', 'SDK', 'API', '基础设施', '技术路演'],
    write: '标题一句话说清，配一行等宽小标签（如 v2.4 / latency / SLA）；数据用表格与细线网格，不要卡片；全篇留白要够。',
    dark: true,
    palette: {
      primary: '5B5BD6', secondary: '7C7CFF', accent: '22D3EE',
      bg: '0D0D0F', text: 'EDEDF0', muted: '8B8B96', accent5: '4338CA', accent6: '6B7280',
    },
    fonts: { titleLatin: 'Consolas', titleEa: '黑体', bodyLatin: 'Segoe UI', bodyEa: '微软雅黑' },
    typography: { scale: 1.0, coverTitle: 54, pageTitle: 28, anchor: 70, body: 15 },
    density: 'normal',
    decor: { footerRule: true },
    coverDecor: 'grid',
    transition: 'fade',
    prefer: ['chart', 'table', 'diagram', 'bullets', 'kpi', 'cover', 'section', 'ending'],
    avoid: ['pricing', 'cards', 'quote'],
    anti: [
      '不要用霓虹发光 —— 这套高级感来自 1px 细线而不是 glow',
      '数据页用表格或图表，不要用卡片拼',
      '不要用纯黑 #000，中性近黑 #0D0D0F 才有质感',
    ],
    rationale: '底色取中性近黑 #0D0D0F，刻意避开烂大街的深蓝 #0D1117（那是"GitHub-dark 偷懒解"的禁区组合）；主色紫蓝 #5B5BD6 只用于标签与细线；青色 #22D3EE 仅作数据点睛，不做发光。',
  },
  {
    id: 'two-font-consulting',
    name: '双字体咨询版',
    origin: 'McKinsey 2019 品牌系统（Wolff Olins，Bower 衬线 + 无衬线）、BCG Executive Perspectives',
    temp: '中性',
    dna: '深蓝 × 白二元 + 衬线大标题与无衬线正文高对比并置 + 结论式 action-title',
    fit: ['咨询', '研究', '行业', '高管', '提案', '权威', '分析', '评估', '尽调'],
    write: '每页标题写成结论式 action-title（一句话给判断），不要写"现状分析"这种名词短语；先给结论再给论据；证据用数据而非装饰大图。',
    dark: false,
    palette: {
      primary: '051C2C', secondary: '00805A', accent: 'B45309',
      bg: 'FFFFFF', text: '051C2C', muted: '6B7280', accent5: '0C3A52', accent6: 'D1D5DB',
    },
    fonts: { titleLatin: 'Georgia', titleEa: '宋体', bodyLatin: 'Segoe UI', bodyEa: '微软雅黑' },
    typography: { scale: 1.0, coverTitle: 52, pageTitle: 30, anchor: 72, body: 17 },
    density: 'dense',
    decor: { footerRule: true },
    coverDecor: 'none',
    transition: 'fade',
    pageNumber: '{n} / {total}',
    prefer: ['bullets', 'table', 'chart', 'compare', 'kpi', 'roadmap', 'agenda', 'cover', 'section', 'ending'],
    avoid: ['image-full', 'pricing'],
    anti: [
      '标题写成结论式 action-title，不要写名词短语',
      '先结论后论据，不要"背景-分析-结论"倒着讲',
      '不要用装饰性大图 —— 咨询稿的证据是数据',
    ],
    rationale: '主色取 McKinsey 深蓝 #051C2C（行业研究的色彩记忆）；衬线标题承担"权威"信号、无衬线正文承担"可读"，这是咨询排版的标准分工；品牌绿 #00805A 只用于结论高亮，绝不铺面。',
  },
  {
    id: 'isotype',
    name: '图谱箭头企业版',
    origin: 'Salesforce 销售 deck、Isotype（Otto Neurath）谱系、Gene Zelazny《Say It With Charts》',
    temp: '中性',
    dna: '企业蓝主线 + 分色区分产品线/能力层 + 箭头流程与分层架构盒',
    fit: ['架构', '流程', '平台', '方法论', '生态', '旅程', '地图', '体系', '能力'],
    write: '流程与架构一律用 diagram 版式画出来，不要用文字描述流程；每个模块给统一描边；分层结构用 steps/compare 表达层级关系。',
    dark: false,
    palette: {
      primary: '0B5FA5', secondary: '0E9F6E', accent: 'E8590C',
      bg: 'FFFFFF', text: '1A2733', muted: '6B7280', accent5: '1E40AF', accent6: '94A3B8',
    },
    fonts: { titleLatin: 'Corbel', titleEa: '微软雅黑', bodyLatin: 'Segoe UI', bodyEa: '微软雅黑' },
    typography: { scale: 1.0, coverTitle: 52, pageTitle: 28, anchor: 70, body: 16 },
    density: 'dense',
    decor: { footerRule: true },
    coverDecor: 'none',
    transition: 'fade',
    prefer: ['steps', 'diagram', 'roadmap', 'compare', 'swot', 'timeline', 'table', 'cover', 'section', 'ending'],
    avoid: ['image-full', 'quote'],
    anti: [
      '流程与架构必须画出来（diagram 版式），不要写成文字段落',
      '同一页的模块描边风格要统一',
      '不要给图标加渐变或阴影',
    ],
    rationale: '企业蓝 #0B5FA5 作为架构与流程的主线色；绿与橙用于区分产品线或能力分层（与蓝的色相角均 > 60°，投屏可分辨）；中性灰阶承载表格与说明文字。',
  },
  {
    id: 'golden-circle',
    name: '单图母图概念图解',
    origin: 'Simon Sinek 黄金圆环 TED、Bauhaus 几何抽象、信息建筑「一图定全场」',
    temp: '中性',
    dna: '极简白底 + 黑 + 一个强调色；唯一几何母图承载全部概念',
    fit: ['理论', '框架', '模型', '思想', '方法论', 'TED', '概念', '原理', '培训'],
    write: '一个概念配一张几何母图（同心圆 / 三角 / 矩阵），标签直接压在图形上；不要一页放三张图，母图是唯一主角。',
    dark: false,
    palette: {
      primary: '111827', secondary: '2563EB', accent: 'E11D48',
      bg: 'FFFFFF', text: '111827', muted: '9CA3AF', accent5: '4B5563', accent6: 'E5E7EB',
    },
    fonts: { titleLatin: 'Calibri', titleEa: '微软雅黑', bodyLatin: 'Segoe UI', bodyEa: '微软雅黑' },
    typography: { scale: 1.0, coverTitle: 50, pageTitle: 28, anchor: 72, body: 16 },
    density: 'sparse',
    coverDecor: 'none',
    transition: 'fade',
    prefer: ['diagram', 'compare', 'steps', 'bullets', 'cover', 'section', 'ending'],
    avoid: ['table', 'swot', 'pricing', 'timeline'],
    anti: [
      '一个概念配一张母图，不要一页塞三张图',
      '标签直接压在图形上，不要另起一栏文字',
      '不要用照片或插画替代几何母图',
    ],
    rationale: '「一图定全场」要求色彩极度克制：黑 + 白 + 一个强调色就够，任何第二个有彩色都会把注意力从母图上引开。',
  },
  {
    id: 'sparkline',
    name: 'Sparkline 叙事波形',
    origin: 'Nancy Duarte《Resonate》的 Sparkline 叙事图谱、Al Gore《An Inconvenient Truth》数据叙事',
    temp: '中性',
    dna: '深墨蓝铺底 + 一条横贯全屏的波形线 + 橙色标注转折点',
    fit: ['叙事', '变革', '对照', 'before after', '历程', '复盘', '趋势', '故事线'],
    write: '每页只有一条主线（一条波形 / 一组对比）；标注点直接压在波形上，不要另作图例；橙色只用来标"转折点"，全篇不超过 3 处。',
    dark: false,
    palette: {
      primary: '0F172A', secondary: '38BDF8', accent: 'EA580C',
      bg: 'FFFFFF', text: '0F172A', muted: '94A3B8', accent5: '475569', accent6: 'E2E8F0',
    },
    fonts: { titleLatin: 'Georgia', titleEa: '宋体', bodyLatin: 'Segoe UI', bodyEa: '微软雅黑' },
    typography: { scale: 1.0, coverTitle: 52, pageTitle: 28, anchor: 74, body: 16 },
    density: 'normal',
    decor: { footerRule: true },
    coverDecor: 'none',
    transition: 'fade',
    prefer: ['chart', 'timeline', 'compare', 'quote', 'cover', 'section', 'ending'],
    avoid: ['swot', 'pricing', 'table', 'cards'],
    anti: [
      '每页一条主线，标注点直接压在波形上',
      '橙色只标"转折点"，全篇不超过 3 处',
      '不要用网格线和图例 —— 标注点自己就是图例',
    ],
    rationale: '深墨蓝 #0F172A 铺暗场叙事，唯一的暖色橙 #EA580C 是"转折"的语义色（全篇不复用于其他地方）；第二系列天蓝承载对照波形。每个颜色各自绑定一个语义，没有一个是装饰。',
  },

  // -------------------------------------------------------------------------
  // 安静派
  // -------------------------------------------------------------------------
  {
    id: 'assertion-evidence',
    name: '断言-证据',
    origin: 'Michael Alley 的 Assertion-Evidence 结构（Penn State 实证）、Tufte 数据墨水比、Minto 金字塔原理',
    temp: '安静',
    dna: '白底黑字 + 整句断言标题 + 标题下独占一张证据图；零 bullet、零 chartjunk',
    fit: ['学术', '工程', '评审', '严谨', '政策', '研报', '技术评审', '结题', '论证'],
    write: '标题必须是完整的一句话（断言），不是"市场分析"这种名词短语；标题下面直接给证据图或表，不要三段 bullet；去掉图表的所有装饰。',
    dark: false,
    palette: {
      primary: '1F2937', secondary: '0F4C81', accent: '9A3412',
      bg: 'FFFFFF', text: '1F2937', muted: '6B7280', accent5: '374151', accent6: 'E5E7EB',
    },
    fonts: { titleLatin: 'Cambria', titleEa: '宋体', bodyLatin: 'Segoe UI', bodyEa: '微软雅黑' },
    typography: { scale: 0.98, coverTitle: 48, pageTitle: 30, anchor: 68, body: 16 },
    density: 'normal',
    coverDecor: 'none',
    transition: 'fade',
    prefer: ['chart', 'table', 'diagram', 'bullets', 'compare', 'cover', 'section', 'ending'],
    avoid: ['cards', 'timeline'],
    anti: [
      '标题必须是完整的一句话（断言），不是名词短语',
      '标题下面直接给证据，不要三段 bullet',
      '去掉图表的所有装饰：网格线、图例、边框、渐变',
    ],
    rationale: '白底 + 近黑正文把"数据墨水比"顶到最高；颜色只保留两处语义色 —— 深蓝 #0F4C81 表示证据、砖红 #9A3412 表示异常值与风险；无装饰色、无背景色块。',
  },
  {
    id: 'institutional-swiss',
    name: '瑞士机构极简',
    origin: 'Sequoia 官方 10 页 pitch 模板、Airbnb 2009 种子轮 deck、Müller-Brockmann 网格、Vignelli「少即是多」',
    temp: '安静',
    dna: '纯白底 + 黑灰正文 + 单一品牌强调色；顶部标题带 + 三栏对仗 + 一页一信息',
    fit: ['路演', '提案', '标准', '去装饰', '品牌', '融资', '商业计划', '极简'],
    write: '一页一信息，不要为填满而加内容；所有元素左对齐吸附栏线，不要居中与右对齐混排；用三栏对仗结构讲并列论点。',
    dark: false,
    palette: {
      primary: '111111', secondary: 'FF5A3C', accent: '0057FF',
      bg: 'FFFFFF', text: '222222', muted: '767676', accent5: '444444', accent6: 'E5E5E5',
    },
    fonts: { titleLatin: 'Arial', titleEa: '黑体', bodyLatin: 'Arial', bodyEa: '微软雅黑' },
    typography: { scale: 0.98, coverTitle: 50, pageTitle: 27, anchor: 68, body: 16 },
    density: 'sparse',
    coverDecor: 'none',
    transition: 'fade',
    prefer: ['cover', 'section', 'bullets', 'kpi', 'compare', 'table', 'roadmap', 'ending'],
    avoid: ['pricing', 'swot'],
    anti: [
      '一页一信息，不要为了填满而加内容',
      '所有元素左对齐吸附栏线，不要居中与右对齐混排',
      '不要用装饰图形 —— 网格线本身是唯一的视觉元素',
    ],
    rationale: '纯白底 + 近黑字把"少即是多"落到实处；珊瑚红 #FF5A3C 来自该流派的经典用例（Airbnb 种子轮 deck），只用于一个关键数字；蓝色仅作链接与次要强调，不铺面。',
  },
  {
    id: 'editorial-longform',
    name: '杂志编辑长文流',
    origin: 'Stripe Annual Letter、Amazon 六页叙事备忘录、Benedict Evans「X eats the world」、Stripe Press',
    temp: '安静',
    dna: '奶白纸底 + 深墨字 + 品牌色点睛；散文体段落 + 内联数据卡',
    fit: ['年度信', '复盘', '叙事', '深度', '长文', '研报', '内部信', '出版物'],
    write: '正文用散文体段落（bullets 两栏模式），不要切成四张卡片；用超大显示数字做段落锚点；标题是刊头不是口号。',
    dark: false,
    palette: {
      primary: '635BFF', secondary: '1A1A1A', accent: 'B45309',
      bg: 'FBFAF8', text: '1F1F1F', muted: '767676', accent5: '4F46E5', accent6: 'E7E5E4',
    },
    fonts: { titleLatin: 'Georgia', titleEa: '宋体', bodyLatin: 'Georgia', bodyEa: '宋体' },
    typography: { scale: 1.0, coverTitle: 50, pageTitle: 28, anchor: 66, body: 17, quote: 26 },
    density: 'dense',
    decor: { footerRule: true },
    coverDecor: 'none',
    transition: 'fade',
    pageNumber: '{n} / {total}',
    prefer: ['bullets', 'quote', 'chart', 'table', 'kpi', 'cover', 'section', 'ending'],
    avoid: ['pricing', 'swot', 'roadmap'],
    anti: [
      '正文用散文体段落，不要切成四张卡片',
      '每段一个判断，数字直接嵌进段落里',
      '不要用大字报式标题 —— 这套风格的标题是刊头，不是喊口号',
    ],
    rationale: '底色取奶白 #FBFAF8（出版物纸色）而非纯白，长文阅读不刺眼；正文走衬线体给"阅读级排印"的节奏（行宽与字号都要为连续阅读服务）；紫色 #635BFF 只作点睛，不铺面。',
  },
  {
    id: 'dense-research',
    name: '研报密集图表',
    origin: 'Mary Meeker《Internet Trends》（BOND）、CB Insights《State of AI》、McKinsey Global Institute《Year in Charts》',
    temp: '安静',
    dna: '白底 + 阶梯单色高亮、其余灰化；几乎零留白，结论句标题 + 满页单图',
    fit: ['研报', '趋势', '行业', '数据', '市场', '密集', '季度', '经营分析', '周报'],
    write: '标题写成结论句（"某指标同比下滑 12%"），不要写"数据概览"；每页至少一张图或一张表，不要纯文字页；数据必须给来源脚注。',
    dark: false,
    palette: {
      primary: '0066FF', secondary: '0B4C9E', accent: 'D97706',
      bg: 'FFFFFF', text: '1A1A1A', muted: '6B7280', accent5: '66A3FF', accent6: '9CA3AF',
    },
    fonts: { titleLatin: 'Arial', titleEa: '黑体', bodyLatin: 'Segoe UI', bodyEa: '微软雅黑' },
    typography: { scale: 0.96, coverTitle: 46, pageTitle: 26, anchor: 64, body: 15, caption: 12 },
    density: 'dense',
    decor: { footerRule: true },
    coverDecor: 'none',
    transition: 'fade',
    pageNumber: '{n} / {total}',
    prefer: ['chart', 'table', 'kpi', 'bullets', 'compare', 'cover', 'section', 'ending'],
    avoid: ['quote', 'image-full', 'pricing'],
    anti: [
      '标题写成结论句，不要写"数据概览"',
      '每页至少一张图或一张表，不要纯文字页',
      '必须给数据来源脚注（chart.source）—— 不给来源的研报没有可信度',
    ],
    rationale: '纯白底把信息密度顶到最高；主色亮蓝 #0066FF 做"高亮系列"，其余系列降为同色相阶梯 + 灰阶（单色阶梯高亮是研报的标准做法，避免彩虹色乱飞）；橙色仅用于标记异常值。',
  },
  {
    id: 'all-text-manifesto',
    name: '纯文字宣言备忘录',
    origin: 'Netflix Culture Deck（2009，125 页）、Amazon 六页叙事备忘录、Tufte 反 PowerPoint 主张',
    temp: '安静',
    dna: '纯白或纯黑底 + 阅读级排印；一页一个观点，零图零 bullet',
    fit: ['文化', '价值观', '宣言', '备忘录', '制度', '内部', '反PPT', '文档'],
    write: '一页一个观点，用整句断言，不要 bullet 列表；零图零表 —— 任何图表都违背这套风格；唯一强调色只用来高亮关键短语。',
    dark: false,
    palette: {
      primary: 'E50914', secondary: '262626', accent: 'E50914',
      bg: 'FFFFFF', text: '1A1A1A', muted: '6B7280', accent5: 'B20710', accent6: 'E5E5E5',
    },
    fonts: { titleLatin: 'Georgia', titleEa: '宋体', bodyLatin: 'Georgia', bodyEa: '宋体' },
    typography: { scale: 1.0, coverTitle: 52, pageTitle: 30, body: 18, quote: 26 },
    density: 'sparse',
    coverDecor: 'none',
    transition: 'fade',
    prefer: ['quote', 'bullets', 'section', 'cover', 'ending'],
    avoid: ['chart', 'table', 'diagram', 'image-split', 'image-full', 'kpi', 'cards', 'swot', 'pricing', 'roadmap', 'timeline'],
    anti: [
      '一页一个观点，用整句断言，不要 bullet 列表',
      '零图零表 —— 任何图表都违背这套风格',
      '唯一强调色只用来高亮关键短语，全篇不超过 5 处',
    ],
    rationale: '纯白底 + 近黑正文是"反 PPT"的宣言体（Netflix Culture Deck 路线），阅读级排印承载全部信息；唯一的红 #E50914 只做短语高亮，其余颜色一律不用 —— 颜色在这里是强调，不是装饰。',
  },
]

/** 风格别名 / 口语说法表（`resolveStyle` 的二级索引）。 */
export const STYLE_ALIASES: Record<string, string[]> = {
  'neo-swiss': ['新瑞士', '大字报', '瑞士大字报', '大字报风', 'billboard', 'big type', '路演风', 'big-number', '数字大字'],
  'black-stage': ['黑底', '黑底剧场', '发布会', 'keynote', '乔布斯', '巨幕', '数字剧场', '黑场'],
  'mono-pop': ['撞色海报', '单色满版', '满版撞色', '品牌色海报', '海报风', 'wrapped', '单色'],
  'gradient-manifesto': ['渐变宣言', '渐变', '宣言版式', '满幅渐变', '愿景页', 'manifesto', 'gradient'],
  'candy-lecture': ['糖果舞台', '糖果色', '课件风', 'cs50', '单概念', '深黑糖果', '教学风'],
  'irreverent-pop': ['玩梗', '不羁', '流行版', '社区风', 'reddit', 'z世代', '口语化'],
  bento: ['便当格', 'bento', '便当盒', '卡片网格', '苹果风', '模块网格', '指标卡'],
  'dark-terminal': ['暗色终端', '终端美学', 'developer', '开发者风', '暗色细线', 'hairline', 'linear 风', 'vscode'],
  'two-font-consulting': ['双字体', '咨询版', '麦肯锡', 'mckinsey', 'bower', '衬线标题', '咨询报告'],
  isotype: ['图谱', '箭头', '企业版', '架构图', 'isotype', '流程风', '平台架构', '生态图'],
  'golden-circle': ['黄金圆环', '单图', '母图', '同心圆', '概念图', 'ted', '框架图'],
  sparkline: ['波形', 'sparkline', '叙事波形', 'duarte', '故事线', '转折点'],
  'assertion-evidence': ['断言证据', '断言', 'tufte', '学术风', '严谨', '证据', 'research', '数据墨水'],
  'institutional-swiss': ['瑞士极简', '机构极简', '极简', 'sequoia', 'swiss', '少即是多', '去装饰', 'vignelli'],
  'editorial-longform': ['长文流', '编辑长文', '杂志风', '年度信', 'stripe', '散文体', '阅读级'],
  'dense-research': ['研报', '密集图表', 'meeker', 'cb insights', '行业研报', '数据密集', '零留白'],
  'all-text-manifesto': ['纯文字', '宣言备忘录', 'netflix', '文档风', '反ppt', '全文字', '六页备忘录'],
}

/** 归一化查询串：小写、去空白与常见分隔符。 */
function normalizeQuery(input: string): string {
  return input.toLowerCase().replace(/[\s_\-+·、,，。/\\()（）【】"']/g, '')
}

/**
 * 解析风格：精确 id → 归一化 id → 别名精确 → 别名最长子串。
 *
 * 与 {@link resolveTheme} 同构（也给"别名子串按长度打分"），因为模型填的是人话：
 * 用户说"用那个大字报风格"时，`deck.style.preset` 大概率就是"大字报风格"。
 *
 * @returns 命中的风格；无法识别返回 undefined（调用方决定回退）。
 */
export function findStyle(input: string | undefined | null): PptStyle | undefined {
  if (input === undefined || input === null) return undefined
  const raw = input.trim()
  if (!raw) return undefined

  const exact = PPT_STYLES.find((s) => s.id === raw)
  if (exact) return exact

  const q = normalizeQuery(raw)
  const byId = PPT_STYLES.find((s) => normalizeQuery(s.id) === q)
  if (byId) return byId

  for (const [id, aliases] of Object.entries(STYLE_ALIASES)) {
    if (aliases.some((a) => normalizeQuery(a) === q)) return PPT_STYLES.find((s) => s.id === id)
  }

  let best: { id: string; score: number } | undefined
  for (const [id, aliases] of Object.entries(STYLE_ALIASES)) {
    for (const alias of aliases) {
      const a = normalizeQuery(alias)
      if (a.length < 2 || !q.includes(a)) continue
      const score = a.length * 10
      if (!best || score > best.score) best = { id, score }
    }
  }
  if (best) return PPT_STYLES.find((s) => s.id === best!.id)
  return undefined
}

/** 按 id 精确取风格。 */
export function getStyle(id: string | undefined): PptStyle | undefined {
  if (!id) return undefined
  return PPT_STYLES.find((s) => s.id === id)
}

/** 全部风格 id。 */
export function styleIds(): string[] {
  return PPT_STYLES.map((s) => s.id)
}

/**
 * 把风格预设立成一套主题。
 *
 * @param style  - 风格预设。
 * @param base   - 基底主题。只借用它的**非视觉**字段（字体族兜底、图表配色等）；
 *   所有视觉槽位与 hero 渐变都由本风格接管，不继承基底 —— 否则换风格等于没换。
 * @param opts.primary - 用户/品牌主色。给了就走 {@link rebaseColor} 做同源迁移：
 *   本风格里所有**有彩色**槽位按色相差整体搬过去，**中性槽位原样不动** ——
 *   这是「品牌色优先」与「风格不外流」唯一能同时成立的解法。
 */
export function applyStyle(style: PptStyle, base: Theme, opts: { primary?: string } = {}): Theme {
  const brand = opts.primary ? normalizeHex(opts.primary) : undefined
  const p = style.palette
  const slot = (v: string): string => (brand ? rebaseColor(p.primary, brand, v) : v)

  const theme: Theme = {
    ...base,
    id: brand ? `style-${style.id}-${brand}` : `style-${style.id}`,
    name: `${style.name}${brand ? `（品牌色 #${brand}）` : ''}`,
    dark: style.dark,
    bg: slot(p.bg),
    primary: brand ?? p.primary,
    secondary: slot(p.secondary),
    accent: slot(p.accent),
    text: slot(p.text),
    muted: slot(p.muted),
    accent5: slot(p.accent5),
    accent6: slot(p.accent6),
    hyperlink: slot(p.hyperlink ?? p.secondary),
    coverDecor: style.coverDecor,
    fontTitle: { latin: style.fonts.titleLatin, ea: style.fonts.titleEa },
    fontBody: { latin: style.fonts.bodyLatin, ea: style.fonts.bodyEa },
    styleId: style.id,
    colorRationale: brand
      ? `${style.rationale}\n  ⤷ 主色已替换为用户指定的 #${brand}：整套有彩色按色相差同源迁移（中性灰阶不动），保留本风格手工调过的色彩关系。`
      : style.rationale,
  }
  // hero 渐变必须属于本风格。风格自带就用自己的；没带就置空，交给
  // heroBackground() 从**本风格自己的 primary** 派生 —— 绝不能留着基底主题的
  // 渐变，否则选「黑底剧场」会得到一张商务蓝封面（风格被基底偷偷接管）。
  // 给了品牌主色时同样置空：渐变要跟着品牌色走，而不是跟着原风格。
  theme.heroGradient = !brand && style.heroGradient ? style.heroGradient : undefined
  return theme
}

/** 风格索引（紧凑，供设计指南全量返回 —— 详情按需取）。 */
export function styleIndex(): string {
  const order: StyleTemp[] = ['大胆', '中性', '安静']
  const lines: string[] = []
  for (const temp of order) {
    const group = PPT_STYLES.filter((s) => s.temp === temp)
    lines.push(`  ── ${temp}派（${group.length} 种）`)
    for (const s of group) {
      lines.push(`  ${s.id.padEnd(21)} ${s.name}　${s.density === 'sparse' ? '疏' : s.density === 'dense' ? '密' : '中'}　${s.fit.slice(0, 5).join('/')}`)
    }
  }
  return lines.join('\n')
}

/** 单条风格的完整详情（色板、字体、字号、anti-pattern、论证）。 */
export function styleDetail(style: PptStyle): string {
  const p = style.palette
  const t = style.typography ?? {}
  const hex = (v: string): string => `#${v}`
  return [
    `【${style.name}】id=${style.id} · ${style.temp}派 · 密度${style.density === 'sparse' ? '疏（留白优先）' : style.density === 'dense' ? '密（信息优先）' : '中'}`,
    `视觉 DNA：${style.dna}`,
    `出处：${style.origin}`,
    `适配：${style.fit.join('、')}`,
    `写法要求：${style.write}`,
    style.degrade ? `⚠️ 降级说明：${style.degrade}` : '',
    `配色锚点：primary ${hex(p.primary)} / secondary ${hex(p.secondary)} / accent ${hex(p.accent)} / bg ${hex(p.bg)} / text ${hex(p.text)} / muted ${hex(p.muted)}`,
    `  （写在 deck.style.preset 里即可，无需手填这些色值；用户给了品牌主色时会自动做同源迁移）`,
    `字体：标题 ${style.fonts.titleLatin} + ${style.fonts.titleEa}；正文 ${style.fonts.bodyLatin} + ${style.fonts.bodyEa}`,
    t.scale || t.coverTitle || t.pageTitle || t.body
      ? `字号：${t.scale ? `整体 ×${t.scale}` : ''}${t.coverTitle ? ` 封面 ${t.coverTitle}pt` : ''}${t.pageTitle ? ` 页标题 ${t.pageTitle}pt` : ''}${t.anchor ? ` 数字锚点 ${t.anchor}pt` : ''}${t.body ? ` 正文 ${t.body}pt` : ''}`
      : '',
    `推荐版式：${style.prefer.join(' → ')}`,
    style.avoid.length > 0 ? `这套风格下不成立：${style.avoid.join('、')}` : '',
    `anti-pattern：\n${style.anti.map((a) => `  · ${a}`).join('\n')}`,
    `色彩论证：${style.rationale}`,
  ]
    .filter(Boolean)
    .join('\n')
}

/** 列出风格摘要（供工具回执与错误提示）。 */
export function listStyles(): { id: string; name: string; temp: StyleTemp }[] {
  return PPT_STYLES.map((s) => ({ id: s.id, name: s.name, temp: s.temp }))
}

/**
 * 从内容里推三个差异化方向（对应 huashu 的「三方向硬门」）。
 *
 * 做法：把稿件的文字压成一个串，按每条风格的 `fit` 关键词命中数打分，
 * 再在**三个温度档各取最高分**一条。这样三个方向天然有温度梯度（安静底盘 /
 * 中性主力 / 大胆破局），不会出现"三个都是白底极简"的典型失败模式。
 *
 * 命中的关键词会作为理由回传，让模型能向用户解释"为什么推荐这个方向"。
 * 同分时按 `seed` 轮换，避免同一份内容永远推出同一组方向。
 */
export function pickDirections(
  content: string,
  seed = 0,
): { style: PptStyle; temp: StyleTemp; score: number; matched: string[] }[] {
  const text = content.toLowerCase()
  const scored = PPT_STYLES.map((style) => {
    const matched = style.fit.filter((k) => text.includes(k.toLowerCase()))
    return { style, temp: style.temp, score: matched.length, matched }
  })
  const out: { style: PptStyle; temp: StyleTemp; score: number; matched: string[] }[] = []
  for (const temp of ['安静', '中性', '大胆'] as StyleTemp[]) {
    const pool = scored.filter((s) => s.temp === temp)
    if (pool.length === 0) continue
    const max = Math.max(...pool.map((s) => s.score))
    const top = pool.filter((s) => s.score === max)
    out.push(top[seed % top.length]!)
  }
  // 三个方向必须互不相同
  const seen = new Set<string>()
  return out.filter((d) => (seen.has(d.style.id) ? false : (seen.add(d.style.id), true)))
}

/** 风格对应的字号策略：可直接当 `style.typography` 用。 */
export function styleTypography(style: PptStyle): StyleTypography | undefined {
  return style.typography
}

/** 密度档 → 每页字数下限的倍数（与 `lint.ts` 的 WORD_FLOOR 相乘）。 */
export function densityFactor(style: PptStyle | undefined): number {
  if (!style) return 1
  return style.density === 'sparse' ? 0.6 : style.density === 'dense' ? 1.25 : 1
}

/**
 * 风格主色的 OKLCH 摘要，供评审报告说明"这套色的明度/彩度分布"。
 *
 * 同时统计**有彩色槽位数**：huashu 的收敛要求是「2–3 个有彩色 + 1 组中性色」，
 * 超过 3 个有彩色就是配色失控的信号（直接引用 `deck.style.colors` 手填色值的
 * 情况不在本函数管辖内，这里只看风格预设自身）。
 */
export function paletteSummary(style: PptStyle): string {
  const slots: [string, string][] = [
    ['主色', style.palette.primary],
    ['辅色', style.palette.secondary],
    ['强调', style.palette.accent],
    ['点睛', style.palette.accent5],
    ['反差', style.palette.accent6],
  ]
  const chromatic = slots.filter(([, v]) => hexToOklch(v).C >= 0.03).length
  const detail = slots
    .slice(0, 3)
    .map(([label, v]) => {
      const o = hexToOklch(v)
      return `${label} L${o.L.toFixed(2)}/C${o.C.toFixed(2)}/H${o.h.toFixed(0)}°`
    })
    .join('　')
  return `${detail}　｜有彩色 ${chromatic}/5 ${chromatic <= 3 ? '（符合 2–3 个的收敛要求）' : '（超出 2–3 个，配色偏乱）'}`
}
