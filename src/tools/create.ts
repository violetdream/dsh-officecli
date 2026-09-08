import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { existsSync } from 'node:fs'
import { cliError, getSessionCwd, getSessionId, notify, textCard, warmWatch } from './common.js'
import type { PluginDeps } from '../routes.js'

/** office_create / office_list */
export function registerCreateTools(ctx: Context, deps: PluginDeps): void {
  ctx.tools.register(
    defineTool({
      name: 'office_create',
      description:
        '在当前会话工作区创建一个新的 Office 文档（docx/xlsx/pptx）。创建后可用 office_add 添加内容、office_view 查看。',
      parameters: {
        filename: { type: 'string', required: true, description: '文件名（如 report.docx、data.xlsx、slides.pptx），只允许简单文件名' },
        type: { type: 'string', required: true, enum: ['docx', 'xlsx', 'pptx'] as const, description: '文档类型' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (args, value) =>
          textCard(
            `已创建 ${args.filename}（${args.type}）`,
            `根路径: ${(value as { rootPath?: string }).rootPath ?? ''}`,
            '下一步: office_add 添加内容',
          ),
      },
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        const sessionId = getSessionId(exec)
        const cwd = getSessionCwd(exec)
        const abs = deps.workspace.resolve(sessionId, args.filename, cwd)
        if (existsSync(abs)) throw new Error(`文件已存在: ${args.filename}。请换一个文件名。`)
        const res = await deps.cli.run(sessionId, ['create', abs, '--type', args.type])
        if (!res.ok) throw cliError(res)
        notify(deps, sessionId, { file: args.filename, tool: 'office_create' }, cwd)
        warmWatch(deps, sessionId, args.filename, cwd)
        const rootPath = args.type === 'docx' ? '/body' : args.type === 'xlsx' ? '/Sheet1' : '/slide[1]'
        return { filename: args.filename, type: args.type, rootPath }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'office_list',
      description: '列出当前会话工作区中的所有 Office 文档（文件名、类型、大小、修改时间）。',
      parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => {
          const files = (value as { files: Array<{ name: string; type: string; size: number; mtime: number }> }).files ?? []
          if (files.length === 0) return textCard('当前会话暂无文档。用 office_create 创建一个。')
          return textCard(
            '会话文档:',
            ...files.map((f) => {
              const kb = (f.size / 1024).toFixed(1)
              const time = new Date(f.mtime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
              return `  ${f.name}  ${f.type}  ${kb}KB  修改于 ${time}`
            }),
          )
        },
      },
      isConcurrencySafe: () => true,
      async execute(_args, exec) {
        const sessionId = getSessionId(exec)
        const cwd = getSessionCwd(exec)
        return { files: deps.workspace.listFiles(sessionId, cwd) }
      },
    }),
  )
}
