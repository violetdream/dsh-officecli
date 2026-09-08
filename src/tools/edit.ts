import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { OfficeCLIService } from '../service.js'
import { cliError, getSessionCwd, getSessionId, notify, requireFile, textCard, truncate, warmWatch } from './common.js'
import type { PluginDeps } from '../routes.js'

/** office_set / office_add / office_remove / office_move / office_batch */
export function registerEditTools(ctx: Context, deps: PluginDeps): void {
  ctx.tools.register(
    defineTool({
      name: 'office_set',
      description:
        '修改文档中指定路径元素的属性。常用属性: docx 段落 text/style；xlsx 单元格 value/formula。用 office_get 先查看可设置属性。',
      parameters: {
        filename: { type: 'string', required: true, description: '文件名' },
        path: { type: 'string', required: true, description: '目标路径（如 /body/p[2]、/Sheet1/B3）' },
        props: {
          type: 'object',
          required: true,
          additionalProperties: true,
          description: '要设置的属性键值对（如 {"text": "标题", "bold": true}）',
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (args, value) =>
          textCard(
            `已更新 ${args.filename} @ ${args.path}`,
            ...Object.entries((value as { applied?: Record<string, unknown> }).applied ?? args.props).map(
              ([k, v]) => `  ${k} = ${truncate(JSON.stringify(v), 120)}`,
            ),
          ),
      },
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        const sessionId = getSessionId(exec)
        const cwd = getSessionCwd(exec)
        const abs = requireFile(deps.workspace, sessionId, args.filename, cwd)
        const res = await deps.cli.run(sessionId, [
          'set',
          abs,
          args.path,
          ...OfficeCLIService.propArgs(args.props),
        ])
        if (!res.ok) throw cliError(res)
        notify(deps, sessionId, { file: args.filename, tool: 'office_set' }, cwd)
        warmWatch(deps, sessionId, args.filename, cwd)
        return { applied: args.props }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'office_add',
      description:
        '向文档添加新元素。docx: 在 parent（如 /body）下加 heading/paragraph/table/image；xlsx: 加 row/sheet；pptx: 加 shape 到 slide。用 office_get 查看可用父节点。',
      parameters: {
        filename: { type: 'string', required: true, description: '文件名' },
        parent: { type: 'string', required: true, description: '父路径（docx: /body；xlsx: /Sheet1；pptx: /slide[1]）' },
        type: {
          type: 'string',
          required: true,
          description:
            '子元素类型。docx: paragraph/run/table/row/cell/picture/chart 等（标题用 type=paragraph + style=Heading1）；xlsx: row/sheet/cell；pptx: shape/text/picture/slide',
        },
        props: {
          type: 'object',
          required: true,
          additionalProperties: true,
          description: '新元素属性（如 {"text": "第一段内容", "style": "Heading1"}）',
        },
        after: { type: 'string', description: '插入到该兄弟元素之后' },
        before: { type: 'string', description: '插入到该兄弟元素之前' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (args, value) =>
          textCard(
            `已插入 ${args.type} 到 ${args.parent}`,
            `新路径: ${(value as { path?: string }).path ?? '（见 office_get）'}`,
          ),
      },
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        const sessionId = getSessionId(exec)
        const cwd = getSessionCwd(exec)
        const abs = requireFile(deps.workspace, sessionId, args.filename, cwd)
        const cliArgs = ['add', abs, args.parent, '--type', args.type, ...OfficeCLIService.propArgs(args.props)]
        if (args.after) cliArgs.push('--after', args.after)
        if (args.before) cliArgs.push('--before', args.before)
        const res = await deps.cli.run<unknown>(sessionId, cliArgs)
        if (!res.ok) throw cliError(res)
        notify(deps, sessionId, { file: args.filename, tool: 'office_add' }, cwd)
        warmWatch(deps, sessionId, args.filename, cwd)
        // officecli 成功消息形如 "Added paragraph at /body/p[@paraId=...]"
        const raw = typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
        const m = raw.match(/at\s+(\S+)/)
        return { path: m?.[1] ?? '', message: raw }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'office_remove',
      description: '删除文档中指定路径的元素。',
      parameters: {
        filename: { type: 'string', required: true, description: '文件名' },
        path: { type: 'string', required: true, description: '要删除的元素路径' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (args) => textCard(`已删除 ${args.filename} @ ${args.path}`),
      },
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        const sessionId = getSessionId(exec)
        const cwd = getSessionCwd(exec)
        const abs = requireFile(deps.workspace, sessionId, args.filename, cwd)
        const res = await deps.cli.run(sessionId, ['remove', abs, args.path])
        if (!res.ok) throw cliError(res)
        notify(deps, sessionId, { file: args.filename, tool: 'office_remove' }, cwd)
        warmWatch(deps, sessionId, args.filename, cwd)
        return { removed: args.path }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'office_move',
      description: '把文档中的元素移动到新位置。',
      parameters: {
        filename: { type: 'string', required: true, description: '文件名' },
        path: { type: 'string', required: true, description: '要移动的元素路径' },
        to: { type: 'string', required: true, description: '目标位置' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (args) => textCard(`已移动 ${args.path} → ${args.to}`),
      },
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        const sessionId = getSessionId(exec)
        const cwd = getSessionCwd(exec)
        const abs = requireFile(deps.workspace, sessionId, args.filename, cwd)
        const res = await deps.cli.run(sessionId, ['move', abs, args.path, '--to', args.to])
        if (!res.ok) throw cliError(res)
        notify(deps, sessionId, { file: args.filename, tool: 'office_move' }, cwd)
        warmWatch(deps, sessionId, args.filename, cwd)
        return { moved: args.path, to: args.to }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'office_batch',
      description:
        '原子化批量执行多条命令（任一失败全部回滚）。命令为对象数组，每条以 command 指定命令名（add/set/remove/move/get 等），字段与单条命令一致，如 [{"command":"add","parent":"/body","type":"paragraph","props":{"text":"A"}}]。',
      parameters: {
        filename: { type: 'string', required: true, description: '文件名' },
        commands: {
          type: 'array',
          required: true,
          items: { type: 'object', additionalProperties: true },
          description: '命令对象数组（通过 stdin 以 JSON 传入，失败整体回滚）',
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => {
          const v = value as { applied?: number; error?: string }
          if (v.error) return textCard(`批量执行失败并已回滚: ${v.error}`)
          return textCard(`原子执行 ${v.applied ?? 0} 条命令成功`)
        },
      },
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        const sessionId = getSessionId(exec)
        const cwd = getSessionCwd(exec)
        const abs = requireFile(deps.workspace, sessionId, args.filename, cwd)
        const res = await deps.cli.run(sessionId, ['batch', abs], {
          timeoutMs: deps.config.batchTimeoutMs,
          stdin: JSON.stringify(args.commands),
        })
        if (!res.ok) throw cliError(res)
        notify(deps, sessionId, { file: args.filename, tool: 'office_batch' }, cwd)
        warmWatch(deps, sessionId, args.filename, cwd)
        return { applied: args.commands.length }
      },
    }),
  )
}
