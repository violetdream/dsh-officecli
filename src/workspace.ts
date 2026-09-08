import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import type { Config } from './index.js'

export type OfficeFileType = 'docx' | 'xlsx' | 'pptx'

export type SessionFile = {
  name: string
  type: OfficeFileType
  size: number
  mtime: number
}

/**
 * 允许中文文件名，只拒绝路径分隔符、Windows 保留字符与控制字符。
 * 注意 \w 不含中文，旧正则会让「季度汇报.pptx」这类文件名直接被拒。
 * 排除 . 与空格之外的非法字符后，其余 Unicode（含 CJK、emoji）一律放行。
 */
const FILENAME_RE = /^[^\\/:*?"<>|\r\n]+\.(docx|xlsx|pptx)$/i
const SESSION_RE = /^[a-zA-Z0-9_-]+$/
const DEFAULT_ROOT = join(tmpdir(), 'dsh-officecli')

/**
 * 把工作区根目录规范化为绝对路径。
 * 空配置回退到系统临时目录下的默认值：相对路径会让 officecli 在其自身 cwd
 * （即会话目录）下二次解析文件参数，拼出 `<sessionId>/<sessionId>/` 的重复层级。
 */
function normalizeRoot(dir: string): string {
  const trimmed = typeof dir === 'string' ? dir.trim() : ''
  return trimmed ? resolve(trimmed) : DEFAULT_ROOT
}

function sanitizeSession(sessionId: string): string {
  return SESSION_RE.test(sessionId) ? sessionId : 'default'
}

/**
 * 会话隔离的工作区管理：目录解析、文件名校验（防路径逃逸）、文件列表。
 *
 * 目录优先级（从高到低）：
 *  1. 会话 cwd —— DSH 会话创建时的工作区（exec.agent.session.cwd），工具侧
 *     带 cwd 解析文件时登记进注册表，之后的 HTTP 路由（只有 sessionId）也能复用；
 *  2. 注册表中已登记的会话 cwd（同会话内路由先于工具运行前不适用，但工具必然先跑）；
 *  3. 配置的 <workspaceDir>/<sessionId>/。
 * 这样生成的 PPT 落在用户真正的 DSH 工作区里，而不是系统临时目录。
 */
export class WorkspaceManager {
  private readonly root: string
  private readonly sessionCwd = new Map<string, string>()

  constructor(config: Config) {
    this.root = normalizeRoot(config.workspaceDir)
  }

  /** 会话目录（懒创建）：优先会话 cwd（DSH 工作区），否则 <root>/<sessionId>/。 */
  sessionDir(sessionId: string, cwd?: string): string {
    const dir = this.pickDir(sessionId, cwd)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    return dir
  }

  /** 当前生效的会话目录（注册表或回退根），供路由/日志展示，不创建目录。 */
  currentDir(sessionId: string): string {
    const known = this.sessionCwd.get(sanitizeSession(sessionId))
    if (known !== undefined) return known
    return join(this.root, sanitizeSession(sessionId))
  }

  /**
   * 校验文件名并解析为会话内绝对路径。
   * 拒绝路径分隔符、`..` 及白名单扩展名之外的任何输入。
   */
  resolve(sessionId: string, filename: string, cwd?: string): string {
    if (typeof filename !== 'string' || !FILENAME_RE.test(filename)) {
      throw new Error(
        `非法文件名: ${JSON.stringify(filename)}。需为以 .docx/.xlsx/.pptx 结尾的简单文件名，`
        + `支持中文，但不得包含路径分隔符或 \\ / : * ? " < > | 等字符。`,
      )
    }
    if (filename.includes('..')) throw new Error(`非法文件名: ${filename}`)
    return join(this.sessionDir(sessionId, cwd), filename)
  }

  /** 列出会话内的 office 文档（目录：会话 cwd > 注册表 > 配置根）。 */
  listFiles(sessionId: string, cwd?: string): SessionFile[] {
    const dir = this.sessionDir(sessionId, cwd)
    const files: SessionFile[] = []
    for (const name of readdirSync(dir)) {
      if (!FILENAME_RE.test(name)) continue
      const st = statSync(join(dir, name))
      if (!st.isFile()) continue
      files.push({
        name,
        type: name.slice(name.lastIndexOf('.') + 1).toLowerCase() as OfficeFileType,
        size: st.size,
        mtime: st.mtimeMs,
      })
    }
    files.sort((a, b) => b.mtime - a.mtime)
    return files
  }

  private pickDir(sessionId: string, cwd?: string): string {
    const sid = sanitizeSession(sessionId)
    if (cwd !== undefined && isAbsolute(cwd)) {
      this.sessionCwd.set(sid, cwd)
      return cwd
    }
    const known = this.sessionCwd.get(sid)
    if (known !== undefined) return known
    return join(this.root, sid)
  }
}
