# dsh-officecli 0.3.0：适配 DSH 0.2.1-rc.2

## 1. 报错的真因

插件管理器报的是：

> dsh-officecli@0.2.0 与 DSH 0.2.1-rc.2 不兼容（要求 @deepseek-ai/dsh-client-ui-primitives^0.1.0-rc.8, @deepseek-ai/dsh-tools^0.1.0-rc.8）

判定逻辑在 `packages/boot/app-boot/src/plugin-compatibility.ts`，规则只有两条：

1. **有 `engines.dsh` 就只看它**，peerDependencies 完全不参与；
2. 没有 `engines.dsh` 时，`@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 的每个 peer 都必须满足宿主版本。

0.2.0 只写了 peer 依赖，且 `^0.1.0-rc.8` 在 semver 里等价于 `>=0.1.0-rc.8 <0.2.0` —— 0.x 的 caret
锁住次版本，所以 0.2.1-rc.2 必然落在区间外。**这不是版本号写错，是 0.x caret 的语义决定的。**

## 2. 改了什么

### 2.1 清单

- `version` 0.2.0 → **0.3.0**
- 新增 `engines.dsh: ">=0.2.1-rc.2 <0.3.0-0"`（上界写成 `<0.3.0-0`，否则 `0.3.0-rc.1` 也会被放行）
- peer 依赖对齐 `^0.2.1-rc.2`；cordis `^4.0.5`、schemastery `^3.18.5`
- `dsh.client.inject` 从服务名 `["slots","sessions"]` 改为**包名**（该字段的语义是「工厂到达顺序」）

### 2.2 宿主编译期 API

| 0.1.0-rc.8 | 0.2.1-rc.2 | 处理 |
|---|---|---|
| `@deepseek-ai/dsh-client-runtime/client` 的 `ClientContext` | 包已不存在，改用 `@deepseek-ai/cordis` 的 `Context` | 改 import |
| —— | `ctx.slots` 由 `dsh-client-ui-renderer/client` 增补 | 加 `import type {}` |
| —— | `ctx.sessions` 由 `dsh-api-session-controller/client` 增补 | 加 `import type {}` |
| `Icon*16` | `Icon*Regular` / `Icon*Medium` 双权重 | 5 个图标改名 |
| `dsh-tools` 导出 `JsonValue` | 移到 `dsh-util-values` | 改 import 源 |

`ctx.slots.inject()`、`ctx.slots.register({ name, id, label })` 的形态没变，`sidebar.footer.action`
槽位也还在（`kind: 'list'`, `scope: 'root'`），所以侧栏预览的接线不需要改结构。

### 2.3 顺手修掉的两处（officecli 1.0.158 引发）

回归跑到一半时 officecli 自己升级了（1.0.149 → 1.0.158，`officecli.exe.old` 是旧版），带来两个行为变更：

1. **diagram 默认 `render=auto`**：本机有 Chrome 就渲染成 PNG 图片 —— 不可编辑、文字无法按主题改色，
   后处理 `fixDiagramInk` 失去作用对象。已在 `elements.ts` 显式钉 `render=native`。
2. **`view issues` 新增 `[P1] Picture is stretched`**，而且**不认 `crop`**（裁切后照样报）。
   新增 `src/pptx/img.ts` 读 PNG/JPEG/GIF/WebP 文件头取固有尺寸：
   - `image-split`：`containBox()` 把框收敛成原图比例并居中（等于 `object-fit: contain`）
   - `image-full`：`coverCrop()` 按画布比例裁切，避免压扁

## 3. 验证

| 项 | 结果 |
|---|---|
| `tsc`（宿主） / `tsc -p tsconfig.client.json` | 0 错误 |
| `node scripts/regress.mjs` | 8/8 全绿（含 PowerPoint COM 真开校验） |
| `evaluatePluginCompatibility(我们的 package.json)` | `COMPATIBLE`（对 0.2.0 返回 `REJECT`） |
| `dsh --profile web --dump-config` | 正常带出 `dsh-officecli` 行，无告警 |
| `lib/client.js` 按 `__ModuleLoader__` 契约加载 | id / inject / apply 均正确 |

## 4. 你需要做的

profile 用的是 `link:`，`package.json` 一改就生效，**不需要重装**，只要：

1. 重启 DSH（`dsh web` 或桌面端）；
2. 打开插件管理器确认 `dsh-officecli@0.3.0` 不再是「不兼容」；
3. 侧栏底部点「Office 预览」，确认面板能打开。

若管理器仍显示旧状态，是它的缓存 —— 刷新插件列表或退出重进即可。

## 5. 附带的开发环境变动

pnpm 在这台机器上建不出符号链接（isolated 布局下 `node_modules/@deepseek-ai/*` 是空的，
`tsc` 报「Cannot find module」）。pnpm 11 不读 `.npmrc` 里的 `node-linker`，只能用命令行参数，
已固化成：

```bash
pnpm run install:deps     # = pnpm install --config.node-linker=hoisted
```
