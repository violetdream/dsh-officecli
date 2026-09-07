import { FONT } from './grid.js'
import { DECK_SPEC_HELP } from './deck.js'
import { THEMES } from './theme.js'

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
  bullets.items[].title   ≤ 22 字
  bullets.items[].desc    ≤ 46 字
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
  table.rows        行数 ≤ 8`

/** 叙事结构建议。 */
export const STORY_GUIDE = `【叙事结构】一份 7-10 页的汇报推荐节奏：
  1. cover      封面：主题 + 副标题 + 日期/作者
  2. section    章节页：第一部分
  3. kpi 或 bullets   现状 / 问题 / 背景
  4. cards      并列方案或能力矩阵（3-4 张卡最稳）
  5. steps      实施路径或流程
  6. timeline   里程碑排期
  7. compare    方案对比或取舍说明
  8. quote      客户/用户原话（可选）
  9. table      明细数据（可选）
  10. ending    致谢
节奏原则：不要连续两页同为 cards 或同为 bullets；深色整幅页（cover/section/ending）之间至少隔一页浅色内容页。`

/** 生成后的视觉自检清单，供 office_screenshot 拿到图后逐条核对。 */
export const VISUAL_CHECKLIST = `【视觉自检清单】拿到截图后逐条核对，任一条不通过就用 office_batch 修正，最多改 3 轮：
  1. 文字溢出：任何文字是否超出其卡片/色块边界？
  2. 越界：是否有元素被画布边缘裁掉？
  3. 对比度：浅色底上的浅色字、深色底上的深色字是否难辨认？
  4. 对齐：同一页内多个卡片的标题基线是否一致？
  5. 留白：内容是否顶到页边？四周应保留均匀呼吸位。
  6. 密度：单页元素是否过密（>6 个视觉块就该拆分）？
  7. 层级：标题字号是否明显大于正文？数字锚点是否够醒目？
  8. 一致性：跨页的同类元素（卡片圆角、色块、字号）是否统一？`

/** 字号阶梯，让模型知道模板已经定好了，不要试图自己指定字号。 */
export const TYPE_SCALE = `【字号阶梯】模板已按此固定，无需自己指定字号：
  封面主标题 ${FONT.coverTitle}pt  章节标题 ${FONT.sectionTitle}pt  数字锚点 ${FONT.anchor}pt
  页面标题 ${FONT.pageTitle}pt  卡片标题 ${FONT.cardTitle}pt  正文 ${FONT.body}pt  引文 ${FONT.quote}pt  脚注 ${FONT.caption}pt
  画布 960×540pt（16:9），12 栏网格，栏宽 60pt、槽宽 16pt，基线 8pt。`

/** 主题清单。 */
export function themeCatalog(): string {
  return `【主题】用 deck.theme 指定：\n` + THEMES.map((t) => `  ${t.id.padEnd(16)} ${t.name}`).join('\n')
}

/** office_design_guide 可单独索取的节。 */
export type GuideSection = 'themes' | 'story' | 'limits' | 'scale' | 'spec' | 'checklist'

/**
 * 按节返回指南片段。
 *
 * 结构化分段而非事后用子串匹配切全文 —— 后者会把「版式字段契约」这类跨段落的
 * 内容切碎（曾经 spec 节只剩 111 字符，模型看不到 layout 字段表）。
 */
export function guideSections(): Record<GuideSection, string> {
  return {
    themes: themeCatalog(),
    story: STORY_GUIDE,
    limits: LENGTH_LIMITS,
    scale: TYPE_SCALE,
    spec: DECK_SPEC_HELP,
    checklist: VISUAL_CHECKLIST,
  }
}

/** 完整设计指南，给 office_design_guide 工具返回。 */
export function designGuide(section?: GuideSection): string {
  const sections = guideSections()
  if (section !== undefined) return sections[section]
  return [
    '# PPT 设计指南',
    '',
    sections.themes,
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
