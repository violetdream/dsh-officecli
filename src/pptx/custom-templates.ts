import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { DeckTemplate, TemplateStyle } from './templates.js'
import { LAYOUT_IDS, type LayoutId } from './layouts.js'
import { slugifyId } from './templates.js'

/**
 * 用户自定义模板：把「企业 VI / 个人偏好」变成一等公民。
 *
 * 内置模板写死在代码里，用户想加一套"公司深蓝 + 思源黑体 + 底部金线"就必须改插件
 * 源码。这里的做法是外置 JSON：会话里工具被调用时按需扫描若干约定路径，把合法的
 * 模板定义合并进模板库，office_design_guide 随即能列出它们。
 *
 * 约定路径（后者覆盖前者的同名 id）：
 *   1. $DSH_OFFICECLI_TEMPLATES 指向的 .json（多个用 `;` 分隔）
 *   2. ~/.dsh/officecli/templates.json          —— 全局个人模板
 *   3. <会话目录>/.dsh/officecli/templates.json —— 项目级模板（随仓库走）
 *
 * 单文件格式二选一：数组 `[ {...}, {...} ]`，或 `{ "templates": [ ... ] }`。
 */

/** 用户模板的原始定义（相比 DeckTemplate 更宽松，容错面向手写场景）。 */
export interface UserTemplateSpec {
  id?: string
  name?: string
  description?: string
  /** 继承某个内置/已加载模板的字段，其余作为增量覆盖。 */
  extends?: string
  theme?: string
  transition?: string
  pageNumber?: boolean | string
  contentDecor?: Record<string, boolean>
  layouts?: string[]
  style?: TemplateStyle
}

const ID_RE = /^[a-z0-9][a-z0-9_-]{1,40}$/
const DECOR_KEYS = ['rail', 'topbar', 'corner', 'badge', 'footerRule'] as const

/** 候选文件路径（去重）。cwd 为会话工作区。 */
function buildPaths(cwd?: string): string[] {
  const out: string[] = []
  const env = process.env.DSH_OFFICECLI_TEMPLATES
  if (env) out.push(...env.split(';').map((s) => s.trim()).filter(Boolean))
  const home = homedir()
  if (home) out.push(join(home, '.dsh', 'officecli', 'templates.json'))
  if (cwd) out.push(join(cwd, '.dsh', 'officecli', 'templates.json'))
  return [...new Set(out)]
}

/** 抽出文件里的模板数组，容忍 `[...]` 与 `{templates:[...]}` 两种写法。 */
function extractSpecs(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') {
    const t = (raw as { templates?: unknown }).templates
    if (Array.isArray(t)) return t
  }
  return []
}

interface CacheEntry {
  mtimeMs: number
  size: number
}

/**
 * 用户模板注册表。
 *
 * 按 mtime+size 做指纹缓存：工具调用会顺带触发 refresh()，文件没变就只有几次
 * stat 的开销。解析失败只记录错误，绝不因为一个坏 JSON 拖垮整个模板库。
 */
export class TemplateRegistry {
  private extra = new Map<string, DeckTemplate>()
  private styles = new Map<string, TemplateStyle>()
  private cache = new Map<string, CacheEntry>()
  private errors: string[] = []

  /**
   * 扫描约定路径并按需重载。
   * @param cwd - 会话工作区；不同会话的 cwd 不同，这里同时也用于淘汰失效路径。
   */
  refresh(cwd?: string): { count: number; errors: string[]; sources: string[] } {
    const paths = buildPaths(cwd)
    const alive = new Set(paths)
    for (const p of [...this.cache.keys()]) {
      if (!alive.has(p) || !existsSync(p)) {
        this.dropFile(p)
        this.cache.delete(p)
      }
    }
    for (const p of paths) {
      try {
        if (!existsSync(p)) continue
        const st = statSync(p)
        const prev = this.cache.get(p)
        if (prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size) continue
        this.dropFile(p)
        this.cache.set(p, { mtimeMs: st.mtimeMs, size: st.size })
        this.loadFile(p)
      } catch (err) {
        this.errors.push(`${p}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    return {
      count: this.extra.size,
      errors: [...this.errors],
      sources: [...new Set([...this.extra.values()].map((t) => t.source).filter((s): s is string => Boolean(s)))],
    }
  }

  private dropFile(p: string): void {
    for (const [id, t] of [...this.extra]) {
      if (t.source === p) {
        this.extra.delete(id)
        this.styles.delete(id)
      }
    }
    this.errors = this.errors.filter((e) => !e.startsWith(`${p}:`))
  }

  private loadFile(p: string): void {
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(p, 'utf8'))
    } catch (err) {
      this.errors.push(`${p}: JSON 解析失败 — ${err instanceof Error ? err.message : String(err)}`)
      return
    }
    for (const spec of extractSpecs(raw)) {
      const parsed = this.parse(spec, p)
      if (!parsed) continue
      const { template, style } = parsed
      if (this.extra.has(template.id)) {
        this.errors.push(`${basename(p)}: 模板 id 重复 "${template.id}"，已忽略后一个`)
        continue
      }
      this.extra.set(template.id, template)
      if (style) this.styles.set(template.id, style)
    }
  }

  /** 校验并规范化单条定义；非法返回 undefined（错误已入列）。 */
  private parse(input: unknown, source: string): { template: DeckTemplate; style?: TemplateStyle } | undefined {
    if (!input || typeof input !== 'object') return undefined
    const s = input as UserTemplateSpec
    const rawId = typeof s.id === 'string' ? s.id : ''
    const id = slugifyId(rawId)
    if (!id) {
      this.errors.push(`${basename(source)}: 模板缺少合法 id，已跳过`)
      return undefined
    }
    if (!ID_RE.test(id)) {
      this.errors.push(`${basename(source)}: id "${rawId}" 非法（只接受小写字母/数字/-/_，2–41 字符）`)
      return undefined
    }
    const template: DeckTemplate = {
      id,
      name: typeof s.name === 'string' && s.name ? s.name : id,
      description: typeof s.description === 'string' && s.description ? s.description : '用户自定义模板',
      themeId: typeof s.theme === 'string' ? s.theme : '',
      source,
      custom: true,
    }
    if (typeof s.transition === 'string') template.transition = s.transition
    if (typeof s.pageNumber === 'boolean' || typeof s.pageNumber === 'string') template.pageNumber = s.pageNumber
    if (Array.isArray(s.layouts)) template.layouts = s.layouts.map(String).filter((l): l is LayoutId => LAYOUT_IDS.includes(l as LayoutId))
    if (typeof s.extends === 'string' && s.extends) template.extends = s.extends
    if (s.contentDecor && typeof s.contentDecor === 'object') {
      const decor: Record<string, boolean> = {}
      for (const k of DECOR_KEYS) if (s.contentDecor[k] === true) decor[k] = true
      if (Object.keys(decor).length) template.contentDecor = decor as DeckTemplate['contentDecor']
    }
    // 样式既要单独留档（便于按 id 反查），也要挂到模板对象上 —— allTemplates()
    // 只搬 DeckTemplate，忘了挂这一份就永远读不到自定义模板的配色/字体。
    const style = parseStyle(s.style)
    if (style) template.style = style
    return { template, style }
  }

  /** 已加载的用户模板（不含内置）。 */
  list(): DeckTemplate[] {
    return [...this.extra.values()]
  }

  /** 某个用户模板附带的样式覆盖。 */
  styleOf(id: string): TemplateStyle | undefined {
    return this.styles.get(id)
  }

  /** 已加载文件是否包含错误（用于在设计指南里提示用户去修）。 */
  lastErrors(): string[] {
    return [...this.errors]
  }

  clear(): void {
    this.extra.clear()
    this.styles.clear()
    this.cache.clear()
    this.errors = []
  }
}

function parseStyle(input: TemplateStyle | undefined): TemplateStyle | undefined {
  if (!input || typeof input !== 'object') return undefined
  const out: TemplateStyle = {}
  if (input.colors && typeof input.colors === 'object') out.colors = { ...input.colors }
  if (input.fonts && typeof input.fonts === 'object') out.fonts = { ...input.fonts }
  if (input.typography && typeof input.typography === 'object') out.typography = { ...input.typography }
  return Object.keys(out).length ? out : undefined
}

/** 全局注册表实例：templates.ts 的查表入口。 */
export const templateRegistry = new TemplateRegistry()
