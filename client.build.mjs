/**
 * 客户端半打包脚本（closure-factory 协议）。
 *
 * 产物必须是 CJS，且首尾被 __ModuleLoader__.load({ id, factory }) 包裹；
 * 白名单内的模块保留成 require()，由 DSH 浏览器运行时解析，其余全部 inline。
 *
 * 两个必须注意的坑：
 * 1. `config: false` —— 否则 tsdown 会向上找到父仓库的 tsdown.config.ts 并合并它，
 *    插件自己的 external 被覆盖，react 会被整包内联（进来第二套 React 副本，
 *    组件在宿主里直接 "Invalid hook call"）。
 * 2. react / react-dom / react/jsx-runtime 必须 external —— 同上，hook 调度器
 *    必须与宿主是同一个实例。
 */
import { build } from 'tsdown'

/** 由宿主运行时提供的模块（closure-factory 的 require 表）。 */
const EXTERNAL = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-runtime/client',
]

const isExternal = (id) => EXTERNAL.some((name) => id === name || id.startsWith(`${name}/`))

await build({
  config: false,
  name: 'dsh-officecli/client',
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: true,
  clean: false, // 不能清 lib/（宿主半产物也在这里）
  fixedExtension: false,
  external: EXTERNAL,
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: "dsh-officecli", factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})

console.log('[client.build] dsh-officecli/client -> lib/client.js (external: ' + EXTERNAL.join(', ') + ')')
console.log('[client.build] alwaysBundle: ' + (!isExternal ? '' : 'everything else'))
