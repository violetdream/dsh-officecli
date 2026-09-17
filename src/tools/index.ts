import type { Context } from '@deepseek-ai/cordis'
import type { PluginDeps } from '../routes.js'
import { registerCreateTools } from './create.js'
import { registerReadTools } from './read.js'
import { registerEditTools } from './edit.js'
import { registerCaptureTools } from './capture.js'
import { registerDeckTools } from './deck.js'
import { registerDesignTools } from './design.js'

/** 汇总注册全部 office_* 工具。 */
export function registerTools(ctx: Context, deps: PluginDeps): void {
  registerCreateTools(ctx, deps)
  registerReadTools(ctx, deps)
  registerEditTools(ctx, deps)
  registerCaptureTools(ctx, deps)
  registerDeckTools(ctx, deps)
  registerDesignTools(ctx, deps)
}
