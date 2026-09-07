import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-tools'
import { cliError, getSessionId, requireFile, textCard, truncate } from './common.js'
import type { PluginDeps } from '../routes.js'

/** 把 officecli view 各模式的 data 结构转成可读文本。 */
function renderViewText(value: unknown): string {
  if (value === null || typeof value !== 'object') return String(value)
  const v = value as Record<string, unknown>
  // text 模式: { totalElements, elements: [{path, type, text}] }
  if (Array.isArray(v.elements)) {
    const lines = (v.elements as Array<Record<string, unknown>>).map(
      (el) => `${el.text ?? ''}${el.type ? `  [${el.type}]` : ''}`,
    )
    return lines.join('\n')
  }
  // annotated 模式: { view, content }
  if (typeof v.content === 'string') return v.content
  return JSON.stringify(v, null, 1)
}

/** office_view / office_get / office_query / office_dump */
export function registerReadTools(ctx: Context, deps: PluginDeps): void {
  ctx.tools.register(
    defineTool({
      name: 'office_view',
      description:
        '以指定模式查看文档内容: text（纯文本）、annotated（带结构标注）、outline（大纲）、stats（统计）、issues（问题检查）。大文档可配合 page/range 参数。',
      parameters: {
        filename: { type: 'string', required: true, description: '文件名' },
        mode: {
          type: 'string',
          required: true,
          enum: ['text', 'annotated', 'outline', 'stats', 'issues'] as const,
          description: '查看模式',
        },
        page: { type: 'number', description: '页码/幻灯片号（从 1 开始，pptx 常用）' },
        range: { type: 'string', description: '单元格范围（xlsx，如 Sheet1!A1:C10）' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (args, value) => textCard(truncate(renderViewText((value as { data?: unknown }).data ?? value), args.mode === 'text' ? 6000 : 3000)),
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const sessionId = getSessionId(exec)
        const abs = requireFile(deps.workspace, sessionId, args.filename)
        const cliArgs = ['view', abs, args.mode]
        if (args.page !== undefined) cliArgs.push('--page', String(args.page))
        if (args.range) cliArgs.push('--range', args.range)
        const res = await deps.cli.run<unknown>(sessionId, cliArgs)
        if (!res.ok) throw cliError(res)
        return { data: res.data as JsonValue }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'office_get',
      description:
        '按路径读取文档内部结构的 JSON 数据。路径示例: docx 段落 /body/p[3]；xlsx 单元格 /Sheet1/A1。可用 depth 控制层级深度。',
      parameters: {
        filename: { type: 'string', required: true, description: '文件名' },
        path: { type: 'string', description: '文档内部路径（如 /body、/Sheet1/A1）。省略则返回根结构概览' },
        depth: { type: 'number', description: '展开深度（默认 2）' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => textCard(truncate(JSON.stringify((value as { data?: unknown }).data ?? value, null, 1), 4000)),
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const sessionId = getSessionId(exec)
        const abs = requireFile(deps.workspace, sessionId, args.filename)
        const cliArgs = ['get', abs]
        if (args.path) cliArgs.push(args.path)
        if (args.depth !== undefined) cliArgs.push('--depth', String(args.depth))
        const res = await deps.cli.run(sessionId, cliArgs)
        if (!res.ok) throw cliError(res)
        return { data: res.data as JsonValue }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'office_query',
      description: '用选择器查询文档元素（比 office_get 更精确的定位方式），返回匹配的元素数据。',
      parameters: {
        filename: { type: 'string', required: true, description: '文件名' },
        selector: { type: 'string', required: true, description: '选择器表达式' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => textCard(truncate(JSON.stringify((value as { data?: unknown }).data ?? value, null, 1), 4000)),
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const sessionId = getSessionId(exec)
        const abs = requireFile(deps.workspace, sessionId, args.filename)
        const res = await deps.cli.run(sessionId, ['query', abs, args.selector])
        if (!res.ok) throw cliError(res)
        return { data: res.data as JsonValue }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'office_dump',
      description: '导出文档（或指定路径子树）的完整 JSON 树。适合需要完整结构信息的场景，输出可能很大。',
      parameters: {
        filename: { type: 'string', required: true, description: '文件名' },
        path: { type: 'string', description: '可选的子树路径' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => textCard(truncate(JSON.stringify((value as { data?: unknown }).data ?? value, null, 1), 4000)),
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const sessionId = getSessionId(exec)
        const abs = requireFile(deps.workspace, sessionId, args.filename)
        const cliArgs = ['dump', abs]
        if (args.path) cliArgs.push(args.path)
        const res = await deps.cli.run(sessionId, cliArgs)
        if (!res.ok) throw cliError(res)
        return { data: res.data as JsonValue }
      },
    }),
  )
}
