import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { WorkspaceManager } from './workspace.js'
import { OfficeCLIService } from './service.js'
import { WatchManager } from './watch.js'
import { EventBus } from './events.js'
import { registerRoutes, type PluginDeps } from './routes.js'
import { registerTools } from './tools/index.js'
import { refreshTemplates } from './pptx/templates.js'

export interface Config {
  officecliPath: string
  workspaceDir: string
  watchPort: number
  commandTimeoutMs: number
  batchTimeoutMs: number
}

export const Config = Schema.object({
  officecliPath: Schema.string().default('officecli').description('OfficeCLI 可执行文件路径（命令名或绝对路径）'),
  workspaceDir: Schema.string().default(join(tmpdir(), 'dsh-officecli')).description('会话工作区根目录'),
  watchPort: Schema.number().default(0).description('watch 预览服务器端口（0 = 自动分配临时端口）'),
  commandTimeoutMs: Schema.number().default(30_000).description('单条 officecli 命令超时（毫秒）'),
  batchTimeoutMs: Schema.number().default(60_000).description('batch 命令超时（毫秒）'),
})

export const name = 'dsh-officecli'
// 只硬依赖 tools：office_* 工具是插件的主干能力。
// webServer / attachments 走运行时探测（ctx.get），否则在无 HTTP 的 profile
// （如 headless 一次性任务）下插件会一直 pending 到启动审计失败。
export const inject = ['tools']

export function apply(ctx: Context, config: Config): void {
  const workspace = new WorkspaceManager(config)
  const cli = new OfficeCLIService(config, workspace)
  const watch = new WatchManager(config)
  const events = new EventBus()
  watch.setLogger({ warn: (m) => ctx.logger.warn(m) })
  events.bindSnapshot((session) => workspace.listFiles(session))
  const deps: PluginDeps = { config, workspace, cli, watch, events }

  // 侧边栏预览走 HTTP。webServer 是可选依赖（headless 等无 HTTP 场景没有它），
  // 所以不能放进 inject 硬依赖，但也不能在 apply 里同步 ctx.get 探测：插件激活
  // 可能早于 webServer 被 provide，一旦错过就再也不会补注册，所有 /api/officecli/*
  // 都会落到 SPA fallback 上返回 404。ctx.inject 会在服务可用时回调，并在服务
  // 变更/卸载时连带注销路由。
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => registerRoutes(webCtx, deps), 'dsh-officecli: http routes')
    webCtx.logger.info('dsh-officecli: HTTP 预览接口已挂载 /api/officecli')
  })
  registerTools(ctx, deps)

  // 用户自定义模板（~/.dsh/officecli/templates.json 等）：启动时先扫一遍，
  // 让日志能回答"到底加载了几套"；会话级的项目模板在工具调用时按 cwd 增量重载。
  {
    const r = refreshTemplates()
    if (r.count > 0 || r.errors.length > 0) {
      ctx.logger.info(
        `dsh-officecli: 已加载 ${r.count} 套自定义模板${r.errors.length ? `（${r.errors.length} 处错误）` : ''}`,
      )
      for (const err of r.errors.slice(0, 3)) ctx.logger.warn(`dsh-officecli: 模板错误 ${err}`)
    }
  }

  // 边改边看：挂钩 DSH 工具执行事件（tools/execute 是 around-dispatch 包装，
  // tools/result 是只读最终结果），把 office_* 工具的运行状态广播给预览面板。
  // 相比工具内部手动 notify，这里能覆盖失败与取消路径，且不侵入每个工具。
  ctx.on('tools/execute', async (exec, next) => {
    if (exec.name.startsWith('office_')) {
      const sessionId = typeof exec.agent?.session.id === 'string' ? exec.agent.session.id : undefined
      if (sessionId) {
        events.broadcast(sessionId, { type: 'tool-state', session: sessionId, tool: exec.name, state: 'running' })
      }
    }
    return next()
  })
  ctx.on('tools/result', (exec, result) => {
    if (exec.name.startsWith('office_')) {
      const sessionId = typeof exec.agent?.session.id === 'string' ? exec.agent.session.id : undefined
      if (sessionId) {
        events.broadcast(sessionId, {
          type: 'tool-state',
          session: sessionId,
          tool: exec.name,
          state: result.isError ? 'failed' : 'done',
        })
      }
    }
  })

  // 启动自检：探测 officecli 可用性，失败只告警不阻塞
  void cli.probe().then(
    (version) => ctx.logger.info(`dsh-officecli: officecli ${version} 就绪`),
    (err) => ctx.logger.warn(`dsh-officecli: ${err instanceof Error ? err.message : String(err)}`),
  )

  // 图片回看能力：attachments 服务决定 office_screenshot 能否把渲染结果回传进对话。
  // 缺失时工具仍可用，只降级为"落盘 + 侧边栏预览"。
  ctx.logger.info(
    ctx.get('attachments') === undefined
      ? 'dsh-officecli: 未挂载 attachments 服务，office_screenshot 仅落盘不回传图片'
      : 'dsh-officecli: attachments 服务已挂载，office_screenshot 支持对话内看图自检',
  )

  ctx.effect(() => () => {
    void watch.dispose()
    events.dispose()
  }, 'dsh-officecli: teardown')
}
