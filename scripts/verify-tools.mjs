/**
 * 离线验证插件宿主半：用桩服务加载 lib/index.js，枚举真实注册的工具。
 *
 * 用途：routes.ts 曾因重复 register 抛错中断 apply()，导致 12 个工具全部不注册。
 * 本脚本在不开 DSH、不接模型的前提下直接暴露这类回归 —— apply() 只要抛错，
 * 工具数就会少于预期。
 *
 * 运行：node scripts/verify-tools.mjs
 */

import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const require = createRequire(import.meta.url)

const { Context } = require('@deepseek-ai/cordis')

/** 桩：记录所有 register 调用，模拟宿主工具注册表。 */
function makeToolsStub(collected) {
  return {
    register(def) {
      collected.push(def)
    },
  }
}

/** 桩：记录 HTTP 路由注册，重复 path 时像真实宿主一样抛错。 */
function makeWebServerStub(routes) {
  return {
    register(route) {
      const path = route?.path
      if (path !== undefined) {
        if (routes.has(path)) throw new Error(`duplicate route registration: ${path}`)
        routes.set(path, route)
      }
    },
  }
}

async function main() {
  const plugin = await import(pathToFileURL(join(root, 'lib', 'index.js')).href)

  const tools = []
  const routes = new Map()
  const ctx = new Context()
  ctx.provide('tools', makeToolsStub(tools))
  ctx.provide('webServer', makeWebServerStub(routes))

  const workspaceDir = mkdtempSync(join(tmpdir(), 'dsh-officecli-verify-'))
  const config = {
    ...plugin.Config(),
    officecliPath: process.env.OFFICECLI_BIN ?? 'officecli',
    workspaceDir,
    watchPort: 0,
    commandTimeoutMs: 30_000,
    batchTimeoutMs: 60_000,
  }

  ctx.plugin(plugin, config)
  // cordis 的 plugin() 可能在微任务里完成 apply；等一拍确保注册落定。
  await new Promise((r) => setTimeout(r, 50))

  const names = tools.map((t) => t.name).sort()
  const expected = 15 // 12 个 officecli 原语 + 3 个设计层工具
  const ok = names.length >= expected

  process.stdout.write(`注册工具数: ${names.length}（预期 ≥ ${expected}）\n`)
  for (const n of names) process.stdout.write(`  - ${n}\n`)
  process.stdout.write(`注册路由数: ${routes.size}\n`)
  for (const p of routes.keys()) process.stdout.write(`  - ${p}\n`)

  process.stdout.write(ok ? 'RESULT: PASS\n' : `RESULT: FAIL (仅 ${names.length} 个工具)\n`)
  process.exit(ok ? 0 : 1)
}

main().catch((err) => {
  process.stderr.write(`RESULT: FAIL ${err instanceof Error ? err.stack : String(err)}\n`)
  process.exit(1)
})
