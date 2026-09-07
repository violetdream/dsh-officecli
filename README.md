# dsh-officecli

DeepSeek-Harness 插件：让 Agent 用自然语言创建、编辑 Office 文档（docx / xlsx / pptx），并把结果实时回显到 DSH Web 侧边栏。

底层调用本地 [OfficeCLI](D:\workspace\OfficeCLI) 命令行；在此之上插件自建了一套 **PPT 设计层**——坐标、字号、配色、网格全部由插件计算，模型只填内容，从而把「AI 生成的 PPT 排版崩坏」这个老大难问题关进笼子里。

---

## 目录

- [1. 项目定位](#1-项目定位)
- [2. 核心特性](#2-核心特性)
- [3. 前置要求](#3-前置要求)
- [4. 安装与构建](#4-安装与构建)
- [5. 挂载到 DSH Profile](#5-挂载到-dsh-profile)
- [6. 验证与排错](#6-验证与排错)
- [7. 使用方式](#7-使用方式)
- [8. 配置参考](#8-配置参考)
- [9. 工具清单](#9-工具清单)
- [10. PPT 设计层](#10-ppt-设计层)
- [11. 架构](#11-架构)
- [12. 项目结构](#12-项目结构)
- [13. 构建体系](#13-构建体系)
- [14. 开发、测试与调试](#14-开发测试与调试)
- [15. 设计决策与踩坑记录](#15-设计决策与踩坑记录)
- [16. 已知限制](#16-已知限制)
- [17. 许可](#17-许可)

---

## 1. 项目定位

OfficeCLI 是一个「没有布局引擎」的命令行工具——官方原话是 *"Positioning is explicit — no layout engine, you own the grid math"*。这句话的直接后果是：**如果让模型直接调用底层 `add shape` 并自己填坐标，它几乎必然摆歪**。

本插件因此在中间插了一层：

```
模型（只写内容）  →  插件设计层（算坐标/字号/配色）  →  officecli（执行）  →  pptx
```

模型看到的接口是一个 `DeckSpec` JSON：`{"theme":"tech-cyan","slides":[{"layout":"cover","title":"..."}]}`。它不需要知道 1pt 等于多少、卡片该放第几栏。设计层负责把这份意图编译成上百条带单位的 `add shape` 命令，再一次性 `batch` 原子提交。

对 docx / xlsx，插件提供的是贴近 OfficeCLI 原语的底层工具（路径寻址 + 属性读写），因为这两种文档的结构化编辑不需要布局数学。

---

## 2. 核心特性

| 特性 | 说明 |
|---|---|
| **15 个 AI 工具** | 12 个底层原语工具 + 3 个高层 PPT 工具，覆盖文档全生命周期 |
| **PPT 设计层** | 960×540pt 画布、12 栏网格、8pt 基线、5 套主题、11 种版式模板；坐标与字号由插件计算 |
| **字数红线** | 逐字段的字数上限随设计指南下发给模型，从源头抑制溢出 |
| **视觉自检闭环** | `office_screenshot` 渲染 PNG 并**把图片回传到对话**，模型能真正看到自己的产出并修正 |
| **主题继承** | `office_slide_add` 追加页面时自动还原原文件配色，不会突然换肤 |
| **实时预览** | 侧边栏 iframe 嵌入 OfficeCLI watch 页面，Agent 编辑后内容自动刷新（不重载） |
| **双通道 SSE** | 插件自有通道传元事件（文件增删改），OfficeCLI watch 通道传内容刷新 |
| **会话隔离** | 每个对话会话独立工作区目录，文件互不干扰 |
| **安全执行** | `spawn` 参数数组执行，无 shell 拼接；文件名白名单校验防路径逃逸 |
| **可选 HTTP** | 无 HTTP 的 profile（如 headless 一次性任务）下工具照常工作，只是没有侧边栏 |

---

## 3. 前置要求

| 依赖 | 版本/说明 |
|---|---|
| **OfficeCLI** | 需在 PATH 中，或在插件配置里指定绝对路径。本机：`C:\Users\刘仙伟\AppData\Local\OfficeCLI\officecli.exe` |
| **DeepSeek-Harness** | 提供 cordis 插件机制、`ctx.tools` / `ctx.webServer` / `ctx.attachments` 服务 |
| **Node.js** | v18+（用到 `matchAll`、顶层 await 等） |
| **PowerPoint（可选）** | 仅当你想用 native 渲染后端或校验产物可打开性时需要；COM 自动化可用即可 |

验证 OfficeCLI：

```bash
officecli --version
```

---

## 4. 安装与构建

```bash
cd D:\workspace\deepseek-harness\dsh-officecli

# 安装依赖（--ignore-workspace 避免被父仓库 workspace 吸收）
pnpm install --ignore-workspace

# 构建：宿主半 tsc + 客户端半 tsdown
pnpm build
```

单独构建某一半：

```bash
pnpm build:host      # 仅 tsc → lib/*.js + lib/types/*.d.ts
pnpm build:client    # 仅 tsdown → lib/client.js
```

> ⚠️ **改完 `src/` 必须重新 `pnpm build` 并重启 DSH**。profile 通过 `link:` 指向本目录，但 imports 走 `package.json` 的 `exports["."] → ./lib/index.js`，**运行时加载的是编译产物而非源码**。HMR 在 base bundle 的 `cordis.patch.yml` 里默认 `disabled: true`。

---

## 5. 挂载到 DSH Profile

> `dsh web` 是硬编码别名（等价于 `--profile web`），子命令**不接受** `--profile` 选项。
> 若启动报端口占用：`netstat -ano | grep :3080` 找到 PID 后 `taskkill /F /PID <pid>`。

挂载需要三步，**缺一不可**：

### 5.1 安装插件包到 profile

在 DSH 仓库根目录执行（`dsh plugin add` 只负责安装，不会自动写入配置）：

```bash
cd D:\workspace\deepseek-harness
node --import tsx/esm apps/cli/src/bin.ts plugin --profile web add "D:\workspace\deepseek-harness\dsh-officecli"
```

安装结果为软链到 `$DSH_HOME/profiles/web/node_modules/dsh-officecli`（本机 `$DSH_HOME` = `C:\Users\刘仙伟\.dsh`）。

### 5.2 在 profile 的 patch 层插入插件行

编辑 `$DSH_HOME/profiles/web/cordis.patch.yml`（**不要**改 `cordis.yml`，它是空的组合入口）：

```yaml
- insert:
    - id: dsh-officecli
      name: dsh-officecli
      config:
        officecliPath: officecli
        workspaceDir: ""
        watchPort: 0
        commandTimeoutMs: 30000
        batchTimeoutMs: 60000
```

### 5.3 启动 / 重启 DSH

```bash
cd D:\workspace\deepseek-harness
pnpm dsh web
```

> `pnpm dsh` → 根 `package.json` 的 script `node --import tsx/esm apps/cli/src/bin.ts`，尾参透传，因此与上面的原生命令等价。

---

## 6. 验证与排错

### 6.1 验证清单

```bash
# ① 宿主半：返回 {"files":[...]} 说明 HTTP 路由已注册
curl "http://127.0.0.1:3080/api/officecli/files?session=probe"

# ② 客户端半：boot 页里出现 dsh-officecli/client.js 说明 bundle 进了启动图
curl "http://127.0.0.1:3080/" | grep -c "dsh-officecli/client.js"

# ③ 服务树：确认 dsh-officecli 与 attachment-local 同级挂载
node --import tsx/esm apps/cli/src/bin.ts --profile web --dump-config
```

### 6.2 判定插件路由是否在册

这一招在排查预览 404 时极其有用：

```bash
curl -s -D - -o /dev/null "http://127.0.0.1:3080/api/officecli/zzz"
```

| 响应 | 含义 |
|---|---|
| `content-type: application/json`，body `{"error":"未知路由..."}` | ✅ 插件路由在册，只是这个路径不存在 |
| `content-type: text/plain` | ❌ 落到了 SPA fallback —— **插件路由根本没注册** |

### 6.3 常见故障

| 现象 | 原因与处理 |
|---|---|
| `/plugins/dsh-officecli/client.js` 404，但 API 正常 | `package.json` 的 `exports` 未暴露 `"./package.json"`；client-modules 用 `require.resolve('<pkg>/package.json')` 解析包元信息，被 exports 门拦截后该行静默不进启动图 |
| 预览面板里点文件报 HTTP 404 | 见 [15.4](#154-html-改写必须一条规则--g-标志) —— watch 页面的根相对 URL 漏改写，请求打到 DSH 自身 origin |
| 侧边栏没有 Office 按钮 | 客户端 bundle 未进启动图，或 `slots` / `sessions` 服务不可用 |
| 启动即报端口占用 | 已有 DSH 实例占用 3080 |
| 改动 patch 后无变化 | 需要重启 DSH，配置在启动时组合 |
| 改了 `src/` 但行为没变 | 忘了 `pnpm build`，运行时加载的是 `lib/` |
| 组件报 "Invalid hook call" | `client.build.mjs` 的 `config: false` 被去掉了，tsdown 合并了父仓库配置，react 被整包内联 |

---

## 7. 使用方式

### 7.1 侧边栏

1. 点击 DSH Web UI 侧栏底部的「📄 Office 预览」按钮（宽/窄两种形态自适应）
2. 面板上半部分是当前会话的文档列表（含类型、大小、修改时间）
3. 点击任一文件，下半部分 iframe 加载 OfficeCLI watch 页面
4. Agent 编辑文档后，列表项会高亮闪烁，iframe 内容自动刷新（走 SSE，不重载页面）

### 7.2 对话调用

底层原语（docx / xlsx 为主）：

```
创建一个 report.docx，写两段自我介绍。
在 report.docx 的第二段后插入一个表格，包含姓名、年龄、职业三列。
读取 report.docx 的全部内容。
列出当前会话中的所有 Office 文档。
```

高层 PPT 生成（推荐流程，**先读指南再生成，最后截图自检**）：

```
请先用 office_design_guide 查看设计规范，然后用 office_deck_create 生成一份 7 页的
中文 PPT，主题为《2026 年 AI 办公趋势洞察》，文件名 ai趋势洞察.pptx，主题用 tech-cyan。
生成后用 office_screenshot 逐页截图自查，如发现文字溢出或对比度问题就用 office_batch
修正，最多 3 轮。
```

一个最小 DeckSpec：

```json
{
  "theme": "business-blue",
  "footer": "内部资料",
  "slides": [
    { "layout": "cover", "title": "年度技术规划", "subtitle": "2026 · 平台架构组", "eyebrow": "2026 年度规划" },
    { "layout": "kpi", "title": "核心指标", "metrics": [
      { "value": "3.2x", "label": "吞吐提升" },
      { "value": "92%", "label": "自动化率" }
    ]},
    { "layout": "bullets", "title": "三个重点", "items": [
      { "title": "统一网关", "desc": "收敛 17 个入口到单一网关层" },
      { "title": "可观测", "desc": "链路追踪覆盖核心链路" }
    ]},
    { "layout": "ending" }
  ]
}
```

---

## 8. 配置参考

在 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 的插件行 `config` 中覆盖，改动后需重启 DSH：

```yaml
- insert:
    - id: dsh-officecli
      name: dsh-officecli
      config:
        officecliPath: officecli     # 命令名，或绝对路径
        workspaceDir: ""             # 留空 → 系统临时目录
        watchPort: 0                 # 0 = OS 自动分配
        commandTimeoutMs: 30000      # 单条命令超时
        batchTimeoutMs: 60000        # batch 命令超时
```

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `officecliPath` | string | `officecli` | 可执行文件。找不到时报错会提示本机常见安装位置 |
| `workspaceDir` | string | `""` | 工作区根目录。**留空用系统临时目录；填了必须是绝对路径**——相对路径会让 officecli 在自身 cwd 下二次解析，拼出 `<sid>/<sid>/` 的重复层级 |
| `watchPort` | number | `0` | watch 服务器端口，`0` 表示由 OS 分配（推荐） |
| `commandTimeoutMs` | number | `30000` | 单条 officecli 命令超时（毫秒） |
| `batchTimeoutMs` | number | `60000` | batch 命令超时；`office_deck_create` 内部另用 120s |

---

## 9. 工具清单

### 9.1 底层原语工具（12 个）

贴近 OfficeCLI 原语，docx / xlsx 的主力，pptx 的细粒度修也成为它服务。

| 工具 | 参数 | 说明 |
|---|---|---|
| `office_create` | filename, type (docx/xlsx/pptx) | 创建新文档，返回根路径 |
| `office_list` | — | 列出当前会话所有文档（名/类型/大小/时间） |
| `office_view` | filename, mode, page?, range? | 按模式读内容：`text` / `annotated` / `outline` / `stats` / `issues` |
| `office_get` | filename, path?, depth? | 按路径读结构化 JSON（如 `/body/p[3]`、`/Sheet1/A1`） |
| `office_query` | filename, selector | 选择器查询，比 `office_get` 更精确定位 |
| `office_set` | filename, path, props | 修改指定路径元素属性 |
| `office_add` | filename, parent, type, props, after?, before? | 插入子元素 |
| `office_remove` | filename, path | 删除元素 |
| `office_move` | filename, path, to | 移动元素 |
| `office_batch` | filename, commands | 原子批量执行（任一失败全部回滚），命令经 stdin 以 JSON 传入 |
| `office_dump` | filename, path? | 导出完整 JSON 树 |
| `office_screenshot` | filename, page? | 渲染某页为 PNG，并**把图片回传进对话** |

> `office_*` 工具执行成功后都会广播 `file-updated` 元事件，侧边栏据此高亮闪烁。

### 9.2 高层 PPT 工具（3 个）

排版数学由插件承担，模型只填内容。

| 工具 | 参数 | 说明 |
|---|---|---|
| `office_design_guide` | section? | 返回主题清单、叙事结构、字数红线、字号阶梯、DeckSpec 契约、视觉自检清单。`section` 可取 `themes` / `story` / `limits` / `scale` / `spec` / `checklist` |
| `office_deck_create` | filename, deck, overwrite? | 一步生成整份 `.pptx`。`deck` 为 DeckSpec 对象（也容忍 JSON 字符串） |
| `office_slide_add` | filename, slides, at?, theme? | 往已有 PPT 追加页面，**默认自动沿用原文件配色** |

---

## 10. PPT 设计层

这是本项目最有分量的部分，位于 `src/pptx/`。

### 10.1 画布与网格

| 常量 | 值 | 说明 |
|---|---|---|
| 画布 | 960 × 540 pt | 与 officecli `create` 产出的 12192000×6858000 EMU 完全一致（16:9） |
| 页边距 | 32 pt | 左右各 32，内容区宽 896 pt |
| 栏数 | 12 | 栏宽 60 pt、槽宽 16 pt：12×60 + 11×16 = 896 ✓ |
| 基线 | 8 pt | 所有 y / h 对齐到 8 的倍数 |
| 母版 A 区 | y 0–90 | 标题块 |
| 母版 B 区 | y 90–495 | 内容区（实际可用 110–478，上下各留 20 呼吸位） |
| 母版 C 区 | y 495–540 | 页脚条 |

单位统一为 **pt**。officecli 的 `EmuConverter` 原生接受 `xxpt` 写法，所以布局数学算出的值可以直接下发，无需换算。

### 10.2 字号阶梯

| 用途 | 字号 |
|---|---|
| 封面主标题 | 54 pt |
| 章节标题 | 44 pt |
| 数字锚点（KPI 巨型数字） | 64 pt |
| 页面标题 | 28 pt |
| 卡片标题 | 18 pt |
| 正文 | 16 pt |
| 引文 | 22 pt（中文放大到 22 才有分量） |
| 脚注 / 页码 | 13 pt |

### 10.3 主题

5 套内置主题，字体一律取 Windows 必装项（避免 PPT 打开后回退成宋体）：

| id | 名称 | 深色底 | 适用场景 |
|---|---|---|---|
| `business-blue` | 商务蓝 | 否 | 通用汇报、SaaS、金融（默认） |
| `academic-crimson` | 学术深红 | 否 | 论文答辩、人文、文化 |
| `tech-cyan` | 科技青 | **是** | AI、芯片、数据 |
| `warm-orange` | 暖橙 | 否 | 教育、消费、生活 |
| `gov-red` | 政务红 | 否 | 党政、法律、正式公文 |

每套主题由 7 个色令牌（`bg` / `primary` / `secondary` / `accent` / `text` / `muted`）+ 2 组字体（标题/正文，各分 latin 与 eastAsia）构成。用色面积有约束：主色 ≤60%、辅色 ≤30%、强调色 ≤10%（hero 页可到 20%）。

主题会通过 `themeToProps()` 编译成 `set / --prop theme.color.* --prop theme.font.*` 落到 PPT 的 theme part 上。

### 10.4 版式模板（11 种）

| layout | 字段契约 |
|---|---|
| `cover` | `title`, `subtitle?`, `eyebrow?`, `meta?` |
| `section` | `title`, `number?`, `subtitle?` |
| `bullets` | `title`, `items:[{title, desc?}]`（1–6 条） |
| `cards` | `title`, `cards:[{title, desc?, tag?}]`, `columns?`（1–6 张；≤3 用 n 列，4 用 2×2，更多 3 列） |
| `kpi` | `title`, `metrics:[{value, label, note?}]`（1–4 个巨型数字） |
| `steps` | `title`, `steps:[{title, desc?}]`（1–5 步） |
| `compare` | `title`, `left:{title, points:[]}`, `right:{...}`（每边 1–6 点） |
| `timeline` | `title`, `events:[{date, title, desc?}]`（1–5 个节点） |
| `quote` | `quote`, `author?`, `role?` |
| `table` | `title`, `headers:[]`, `rows:[[],[]]`（列 ≤5、行 ≤8） |
| `ending` | `title?`, `subtitle?`（默认「谢谢」） |

`cover` / `section` / `quote` / `ending` 是整幅铺底的深色页，不带页脚。

### 10.5 字数红线

版式模板能算坐标，但算不出「这段文案有多少字」。所以约束集中在内容长度，随 `office_design_guide` 下发给模型：

```
cover.title            ≤ 18 字    cover.subtitle      ≤ 40 字
cover.eyebrow          ≤ 12 字    section.title       ≤ 16 字
bullets.items[].title  ≤ 22 字    bullets.items[].desc ≤ 46 字
cards.cards[].title    ≤ 12 字    cards.cards[].desc   ≤ 60 字
kpi.metrics[].value    ≤ 6 字符   kpi.metrics[].label  ≤ 10 字
steps.steps[].title    ≤ 10 字    steps.steps[].desc   ≤ 34 字
compare.*.points[]     ≤ 30 字/条 timeline.events[].title ≤ 12 字
quote.quote            ≤ 70 字    table.headers[]      ≤ 8 字/列
```

### 10.6 视觉自检清单

`office_screenshot` 返回结果里附带这 8 条，供模型逐条核对（最多改 3 轮）：

1. 文字溢出：任何文字是否超出其卡片/色块边界
2. 越界：是否有元素被画布边缘裁掉
3. 对比度：浅底浅字、深底深字是否难辨认
4. 对齐：同页多个卡片的标题基线是否一致
5. 留白：内容是否顶到页边
6. 密度：单页视觉块是否 >6（该拆分）
7. 层级：标题字号是否明显大于正文，数字锚点是否够醒目
8. 一致性：跨页同类元素（圆角、色块、字号）是否统一

### 10.7 文本高度的经验公式

`office_screenshot` 之后最常出现的告警是「文字溢出」。officecli 的判定是 `usable = h − 2×margin`、`need ≈ 1.19×size + 5.4`。本项目用 **14 档字号 × 19 档高度共 266 个形状**实测标定，取首个不报警的高度做线性回归，得到：

```ts
textHeight(text, size, width) = ceil(lines × size × 1.35 × lineSpacing + 6 + margin×2)
```

版式层一律调用这个公式给高度，不拍脑袋。`fitSize()` 则在给定高度内自动降字号（保底 9pt）。

---

## 11. 架构

### 11.1 系统全景

```
┌─────────────────────────────── DeepSeek-Harness Web UI ───────────────────────────────┐
│                                                                                        │
│  ┌────────────────┐        ┌────────────────┐        ┌──────────────────────────────┐  │
│  │   对话窗口      │        │   AI Agent     │        │  侧边栏                       │  │
│  │                │◄──────►│                │        │  ┌────────────────────────┐  │  │
│  │  工具调用卡片   │        │  15 个 office_*│        │  │ 📄 Office 预览 按钮     │  │  │
│  │  图片回看       │        │  工具          │        │  └───────────┬────────────┘  │  │
│  └────────────────┘        └───────┬────────┘        │              ▼               │  │
│                                    │                 │  ┌────────────────────────┐  │  │
│                                    │                 │  │ 浮层面板               │  │  │
│                                    │                 │  │  文件列表（SSE 高亮）  │  │  │
│                                    │                 │  │  ┌──────────────────┐  │  │  │
│                                    │                 │  │  │ iframe 预览      │  │  │  │
│                                    │                 │  │  │ src=代理 URL     │  │  │  │
│                                    │                 │  │  └──────────────────┘  │  │  │
│                                    │                 │  └────────────────────────┘  │  │
└────────────────────────────────────┼─────────────────┴──────────────┬─────────────────┘
                                     │ 工具调用                        │ HTTP / SSE
┌────────────────────────────────────▼────────────────────────────────▼─────────────────┐
│                              dsh-officecli 插件                                        │
│                                                                                        │
│  ┌────────────────────────── 宿主半（Node.js）────────────────────────────────────┐    │
│  │                                                                               │    │
│  │  tools/                     pptx/（设计层）           基础设施                 │    │
│  │  ├ create.ts  创建/列表     ├ grid.ts   画布网格      ├ workspace.ts 会话隔离 │    │
│  │  ├ read.ts    读取/查询     ├ theme.ts  主题令牌      ├ service.ts  安全执行  │    │
│  │  ├ edit.ts    编辑/批量     ├ layouts.ts 11 种版式    ├ watch.ts    子进程     │    │
│  │  ├ capture.ts 截图回看      ├ shape.ts  形状 IR       ├ events.ts   SSE 通道   │    │
│  │  └ deck.ts    高层 PPT      ├ deck.ts   DeckSpec 编译 ├ proxy.ts    HTTP 代理  │    │
│  │                             └ checklist.ts 设计约束   └ routes.ts   路由分发   │    │
│  └───────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                        │
│  ┌────────────────────────── 客户端半（React）────────────────────────────────────┐    │
│  │  index.tsx（注册 sidebar.footer.action） · OfficePreviewAction.tsx · PreviewPanel.tsx │
│  └───────────────────────────────────────────────────────────────────────────────┘    │
└────────────────────────────────────────┬───────────────────────────────────────────────┘
                                         │ spawn（参数数组，无 shell）
┌────────────────────────────────────────▼───────────────────────────────────────────────┐
│                                 OfficeCLI 命令行                                        │
│   create / add / set / remove / move / batch / get / view / query / dump / screenshot   │
│   watch（每会话一个子进程：HTML 页面 + SSE 推送 + /api/switch 切换 + Host/Origin 门）    │
│   输出：--json 信封 { success, data | error{ error, suggestion } }                      │
└────────────────────────────────────────┬───────────────────────────────────────────────┘
                                         │ 文件读写
                          ┌──────────────▼──────────────┐
                          │  tmpdir()/dsh-officecli/     │
                          │    <sessionId>/              │
                          │      *.docx / *.xlsx / *.pptx│
                          │      .snaps/（截图）          │
                          └─────────────────────────────┘
```

### 11.2 分层职责

| 层 | 职责 | 技术栈 | 主要文件 |
|---|---|---|---|
| **表现层** | 侧边栏按钮 + 浮层面板，SSE 订阅 | React + DSH Slots | `src/client/*` |
| **框架层** | 工具注册、HTTP 路由、依赖注入 | cordis, `ctx.tools`, `ctx.webServer` | — |
| **设计层** | 画布网格、主题、版式模板、DeckSpec 编译 | 纯 TS，零运行时依赖 | `src/pptx/*` |
| **工具层** | 15 个 `office_*` 工具，参数校验与结果渲染 | `@deepseek-ai/dsh-tools` | `src/tools/*` |
| **基础设施** | 会话隔离、命令执行、watch 进程、SSE、HTTP 代理 | Node.js 原生 | `src/{workspace,service,watch,events,proxy,routes}.ts` |
| **外部命令** | 文档读写、watch 服务器 | OfficeCLI | — |

### 11.3 双半结构

| 半 | 职责 | 产物 | 说明 |
|---|---|---|---|
| **宿主半** | Node.js 上下文：调 OfficeCLI、管 watch 进程、提供 HTTP 路由与 AI 工具 | `lib/*.js` + `lib/types/*.d.ts` | `tsc` 编译，ES2022 + NodeNext |
| **客户端半** | 浏览器 React UI：侧栏按钮 + 浮层面板 | `lib/client.js` | `tsdown` 打包，closure-factory 协议 |

### 11.4 数据流

**① AI 工具调用**

```
用户对话 → Agent 调用 office_add
        → src/tools/edit.ts → OfficeCLIService.run(session, ['add', file, '/body', ...])
        → spawn('officecli', args, { shell: false }) → --json 信封
        → EventBus.broadcast({ type:'file-updated', file, tool })
        → 工具返回文本卡片；侧边栏高亮
```

**② 插件自有 SSE（元事件）**

```
GET /api/officecli/events?session=<sid>
  → 立即推 { type:'files-changed', files:[...] }（当前快照）
  → 之后每次工具写文件推 { type:'file-updated', file, tool }
  → 客户端更新列表 + 1.2s 高亮动画
```

**③ OfficeCLI watch SSE（内容刷新）**

```
iframe src = /api/officecli/watch/<sid>
  → proxy.ts 代理 → GET http://127.0.0.1:<port>/（Host 改写为 127.0.0.1:<port>）
  → 返回 HTML（内嵌 JS 的根相对 URL 已被改写成代理路径）
  → 页面内 EventSource('<base>/events') → 代理透传到上游 /events
  → officecli 修改文件 → watch 广播 → 页面局部刷新（不重载）
```

**④ 切换预览文件**

```
用户点另一个文件
  → GET /api/officecli/watch?session=<sid>&file=<name>
  → WatchManager.ensure()：已存在则 POST /api/switch 原地切换（SSE 不断）
  → 返回 { url: '/api/officecli/watch/<sid>', file, port }
```

---

## 12. 项目结构

```
dsh-officecli/
├── src/
│   ├── index.ts                 # 插件入口：Config schema + apply()，组装各服务
│   ├── routes.ts                # 注册 /api/officecli 前缀路由并分发（返回 disposer）
│   ├── service.ts               # OfficeCLIService：spawn 安全执行 + JSON 信封解析
│   ├── workspace.ts             # WorkspaceManager：会话隔离、文件名校验、防路径逃逸
│   ├── watch.ts                 # WatchManager：每会话一个 watch 子进程，/api/switch 切换
│   ├── proxy.ts                 # watch HTTP 代理：Host/Origin 改写、SSE 透传、HTML URL 改写
│   ├── events.ts                # EventBus：插件自有 SSE 通道
│   ├── tools/                   # AI 工具（15 个）
│   │   ├── index.ts             # registerTools() 汇总注册
│   │   ├── common.ts            # sessionId 兜底、filename 校验、textCard / cliError
│   │   ├── create.ts            # office_create / office_list
│   │   ├── read.ts              # office_view / office_get / office_query / office_dump
│   │   ├── edit.ts              # office_set / office_add / office_remove / office_move / office_batch
│   │   ├── capture.ts           # office_screenshot（含 attachments 回看 + 模型能力探测）
│   │   └── deck.ts              # office_design_guide / office_deck_create / office_slide_add
│   ├── pptx/                    # PPT 设计层（本项目的核心资产）
│   │   ├── grid.ts              # 画布/网格/母版三区/字号阶梯 + tint、estimateLines
│   │   ├── theme.ts             # 5 套主题令牌 + inferTheme / themeToProps
│   │   ├── layouts.ts           # 11 种版式模板 renderSlide()
│   │   ├── shape.ts             # ShapeOp 中间表示 → officecli --prop；textHeight 经验公式
│   │   ├── deck.ts              # DeckSpec 解析校验 + 编译成 batch 命令序列
│   │   └── checklist.ts         # 字数红线 / 叙事结构 / 自检清单 / 设计指南
│   └── client/                  # 客户端半（React）
│       ├── index.tsx            # 入口：inject=['slots','sessions']，注册 sidebar.footer.action
│       ├── OfficePreviewAction.tsx  # 侧栏底部按钮（wide / rail 两形态）
│       ├── PreviewPanel.tsx     # 浮层面板：文件列表 + iframe + SSE 订阅
│       ├── styles.ts            # 内联样式常量（走 DSH 主题 CSS 变量）
│       └── sidebar-slots.d.ts   # slot 类型声明
├── lib/                         # 构建产物（运行时加载的就是这里）
│   ├── index.js                 # 宿主半入口
│   ├── client.js                # 客户端 bundle（closure-factory 协议）
│   ├── client.js.map
│   └── types/                   # .d.ts 类型声明
├── scripts/                     # 验证脚本（不进产物）
│   ├── smoke.ts                 # P1：WorkspaceManager + OfficeCLIService 链路
│   ├── smoke-watch.ts           # P3：WatchManager + 代理 + SSE + HTML 改写
│   ├── smoke-deck.mjs           # 设计层：直接用 lib 生成 7 页 PPT
│   ├── verify-tools.mjs         # 离线加载 lib/index.js，枚举真实注册的工具
│   ├── e2e-deck.mjs             # 端到端：设计指南 → 生成 → 截图 → PowerPoint 可打开性
│   ├── bisect-open.mjs          # 二分定位「哪些版式生成的 pptx 打不开」
│   └── make-intro-ppt.sh        # 生成示例 PPT
├── package.json                 # exports / dsh.client / dsh.bundle 声明
├── tsconfig.json                # 宿主半 TS 配置（NodeNext → lib/）
├── tsconfig.client.json         # 客户端半 TS 配置（仅类型检查，noEmit）
├── client.build.mjs             # tsdown：closure-factory 协议打包
├── cordis.patch.yml             # 插件配置补丁
└── README.md
```

### 核心文件一览

| 文件 | 行数 | 职责 | 关键导出 |
|---|---:|---|---|
| `src/index.ts` | 72 | 插件入口，组装服务、注入路由与工具 | `apply()`, `Config`, `inject = ['tools']` |
| `src/routes.ts` | 104 | `/api/officecli` 前缀路由与分发 | `registerRoutes()` |
| `src/service.ts` | 163 | 安全执行 officecli、解析 JSON 信封 | `OfficeCLIService.run/probe/propArgs` |
| `src/workspace.ts` | 86 | 会话隔离目录、文件名校验、防逃逸 | `WorkspaceManager.sessionDir/resolve/listFiles` |
| `src/watch.ts` | 181 | watch 子进程生命周期、端口发现、切换 | `WatchManager.ensure/status/stop/dispose` |
| `src/proxy.ts` | 129 | Host/Origin 改写、SSE 透传、HTML URL 改写 | `proxyToWatch()` |
| `src/events.ts` | 63 | 插件自有 SSE 通道 | `EventBus.connect/broadcast/dispose` |
| `src/pptx/grid.ts` | 121 | 画布网格常量与工具函数 | `col/xOf/snap8/pt/tint/estimateLines` |
| `src/pptx/theme.ts` | 225 | 5 套主题 + 推断 + 编译 | `THEMES/getTheme/inferTheme/themeToProps` |
| `src/pptx/layouts.ts` | 1004 | 11 种版式模板 | `renderSlide()`, `LAYOUT_IDS` |
| `src/pptx/shape.ts` | 228 | ShapeOp → `--prop`，文本高度公式 | `toProps/textHeight/fitSize/roundRectAdj` |
| `src/pptx/deck.ts` | 279 | DeckSpec 校验与编译 | `parseDeckSpec/compileDeck/DECK_SPEC_HELP` |
| `src/pptx/checklist.ts` | 109 | 设计约束与自检清单 | `designGuide/LENGTH_LIMITS/VISUAL_CHECKLIST` |
| `src/tools/deck.ts` | 272 | 三个高层 PPT 工具 | `registerDeckTools()` |
| `src/tools/edit.ts` | 185 | 5 个编辑类工具 | `registerEditTools()` |
| `src/tools/capture.ts` | 158 | 截图 + 图片回传 + 能力探测 | `registerCaptureTools()` |
| `src/client/PreviewPanel.tsx` | 160 | 浮层面板 UI | `PreviewPanel` |

---

## 13. 构建体系

### 13.1 宿主半（tsc）

`tsconfig.json`：ES2022 + NodeNext，`outDir = lib/`，`declarationDir = lib/types`，`exclude: ["src/client/**/*"]`。

### 13.2 客户端半（tsdown）

`client.build.mjs` 复刻 DSH 的 **closure-factory 协议**：

```js
banner: `window.__ModuleLoader__.load({ id: "dsh-officecli", factory: (require) => {`
intro:  `var module = { exports: {} }; var exports = module.exports;`
footer: `return module.exports; } });`
```

外部白名单（只 `require` 不打包，必须与宿主同实例）：

```
react, react/jsx-runtime, react-dom, react-dom/client,
@deepseek-ai/cordis,
@deepseek-ai/dsh-client-ui-slots,
@deepseek-ai/dsh-client-ui-primitives,
@deepseek-ai/dsh-client-runtime/client
```

> ⚠️ `config: false` 是硬性要求。否则 tsdown 会向上找到父仓库的 `tsdown.config.ts` 并合并，`external` 被覆盖后 react 会被整包内联——于是页面里出现第二套 React 副本，组件直接 "Invalid hook call"。

### 13.3 包声明要点

```jsonc
"exports": {
  ".":                    { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
  "./client":             { "default": "./lib/client.js" },
  "./package.json":       "./package.json",          // ← 漏了这条客户端不进启动图
  "./cordis.patch.yml":   "./cordis.patch.yml"
},
"dsh": {
  "client": { "platform": "web", "inject": ["slots", "sessions"] },
  "bundle": { "patch": "./cordis.patch.yml" }
}
```

---

## 14. 开发、测试与调试

```bash
# 类型检查（不产物）
npx tsc --noEmit

# 只做客户端类型检查
npx tsc -p tsconfig.client.json

# 构建
pnpm build

# 冒烟：宿主半基础链路
npx tsx scripts/smoke.ts

# 冒烟：watch + 代理 + SSE + HTML 改写
npx tsx scripts/smoke-watch.ts

# 离线枚举工具（不启动 DSH，验证 apply() 能跑完）
node scripts/verify-tools.mjs

# 端到端：生成 7 页 PPT + 截图 + 用真实 PowerPoint 校验可打开
node scripts/e2e-deck.mjs

# 设计层冒烟：直接用 lib 生成 7 页 PPT 到指定目录
node scripts/smoke-deck.mjs <输出目录>

# 二分定位打不开的版式（历史上用它抓到过 roundRect 的 adj guide 名 bug）
node scripts/bisect-open.mjs <输出目录>
```

### 用 headless 跑真实模型对话

想验证「模型是否真的会用这些工具」，不必开 web：

```bash
# hl-patch.yml 里 insert: dsh-headless/startup、@deepseek-ai/dsh-headless、code-runtime
node --import tsx/esm apps/cli/src/bin.ts \
  --profile default --patch "C:/path/to/hl-patch.yml" \
  "列出你可用的 office_ 开头的工具名，不要调用它们"
```

`--dump-config` 可直接导出解析后的服务树，用来确认某个服务是否真的在树里、以及在哪个层级。

### 调试技巧

- **cordis logger 默认不输出到 stdout**，控制台只有那行 URL。想看插件日志需要接 logger，或用 `--dump-config` / HTTP 探测间接确认。
- **判据式排查**：`curl /api/officecli/zzz` 看 content-type 是 `application/json` 还是 `text/plain`，立刻知道插件路由在不在册（见 [6.2](#62-判定插件路由是否在册)）。
- **watch 页面改写结果**：直接 `curl /api/officecli/watch/<sid>` 看 HTML 里的 `fetch('/...')` 是否都带上了代理前缀。

---

## 15. 设计决策与踩坑记录

这一节记录的是「为什么代码长这样」。每一条都对应一个真实踩过的坑。

### 15.1 可选服务依赖必须用 `ctx.inject`，不能在 `apply()` 里同步探测

`webServer` 在 headless profile 下不存在，所以不能写进 `inject` 硬依赖（会导致插件永远 pending、启动审计报 `1 entry did not activate`）。但改成在 `apply()` 里同步 `ctx.get('webServer')` 同样错：

```
插件激活 早于 webServer 被 provide
  → ctx.get 返回 undefined
  → 跳过路由注册，之后再也不会补
  → 所有 /api/officecli/* 落进 SPA fallback → 404
```

正确写法是 `ctx.inject(['webServer'], webCtx => ...)`：服务可用时回调，服务变更/卸载时连带注销。同时 `registerRoutes()` 返回 disposer 交给 `ctx.effect`，保证路由表与 fiber 生命周期一致。

同理，`cordis` 会拦截未声明 inject 的属性访问，所以即便在 `inject` 回调外，也必须用 `ctx.get('webServer')` 而不是 `ctx.webServer`（后者直接抛错）。

### 15.2 roundRect 的 guide 名是 `adj`，不是 `adj1`

officecli 会把 `adj` 原样写进 `<a:gd name="...">`。OOXML 里 roundRect 的调节量名是 **`adj`**；写成 `adj1` 会产出 PowerPoint 判定为「文件损坏」的 pptx（`HRESULT 0x80070570`），**而 officecli 自己的 `view issues` 检查不出来**。

症状是：11 个版式里恰好 `cards` / `compare` / `steps` 打不开（只有它们用了 roundRect）。现在由 `roundRectAdj()` 生成，并在 `toProps()` 出口用 `normalizeAdj()` 兜底纠正。

### 15.3 长度必须带单位，且不要用 zorder

- **裸数字会被当成 EMU**：`x=32` 落出来是 0.0025pt。所有长度统一走 `pt()` 补单位。
- **zorder 语义是反的**：officecli 里值越大越靠后，给背景设 0 会把它排到最前面盖住所有文字。改为依赖插入顺序——先加的在下，所以背景矩形必须是本页第一个 `add` 的形状。

### 15.4 HTML 改写必须「一条规则 + g 标志」

`proxy.ts` 把 watch 页面里的根相对 URL 改写成代理路径。曾经写成三条独立正则，两个缺陷叠加：

1. **缺 `g` 标志** → 每条规则只替换第一处，`fetch('/api/selection')`、`fetch('/api/send')` 原样漏出，浏览器直接请求 DSH 的 `/api/selection` → **404**。更糟的是这两个是 POST 端点，officecli 的**编辑指令被发到了 DSH 自己的 API 上**。
2. **规则串行互相污染** → `fetch('/')` 先被改成 `fetch('<base>/')`，而 `<base>` 以 `/api/` 开头，又被 `fetch('\/api\/` 规则二次命中，拼出 `<base>/<base>/` 双重前缀。

现在合并成一次 `replace`，带 `g` 标志 + 函数替换（顺带避免 `base` 里的 `$&` 被当成替换模式）：

```ts
[/(fetch|EventSource)\(\s*(['"`])\//g, (_m, fn, q) => `${fn}(${q}${base}/`]
[/\b(src|href|action)=(["'])\//g,     (_m, attr, q) => `${attr}=${q}${base}/`]
```

对照实测：修复前 `POST /api/selection` 打到 DSH 自身 = `404 not found`；修复后经代理到上游 = `204`。

### 15.5 中文文件名

`\w` 不含中文，早期 `/^[\w.-]+\.(docx|xlsx|pptx)$/` 会把「季度汇报.pptx」直接拒掉。现在改为**黑名单**式：

```ts
const FILENAME_RE = /^[^\\/:*?"<>|\r\n]+\.(docx|xlsx|pptx)$/i
```

只拒绝路径分隔符、Windows 保留字符与控制字符，其余 Unicode（CJK、emoji）一律放行。另显式拒绝 `..` 防路径逃逸。

### 15.6 `workspaceDir` 必须是绝对路径

相对路径会让 officecli 在其自身 cwd（即会话目录）下二次解析文件参数，拼出 `<sessionId>/<sessionId>/` 的重复层级。`normalizeRoot()` 统一 `resolve()`，空串回退到系统临时目录。

### 15.7 模型看不到图时不能让它「假装看过」

`office_screenshot` 会通过 `ctx.get('attachments')` 把 PNG 持久化为 `ImageAttachmentRef` 并作为 image block 返回，模型因此能真正看到渲染结果。

但如果当前模型不声明 `image` 输入模态（本项目实测 `glm-4.5-air` / `glm-4.7` 均未声明），图片进不了模型上下文。此时工具会**明确告知模型改用结构化校验**，而不是含糊地说「图片服务不可用」——后者会让模型编造「所有视觉检查通过」的结论。

`imageRouteCapability()` 做软探测：拿不到路由信息时返回 `unknown`（放行），只有明确 `unsupported` 才降级。

### 15.8 追加页面必须继承原文件配色

`office_slide_add` 早期直接取默认 `business-blue`，往深色 PPT 追加会突然变白底。现在用 `inferTheme()` 从 `office_get <f> /` 返回的 `format` 属性表（`theme.color.accent1` 等）还原主题：先按色值精确匹配内置主题，匹配不上就按读回色值现场构造一个。只有显式传 `theme` 参数才改写 presentation 根主题，避免牵连已有页面。

### 15.9 设计指南要结构化分段

`office_design_guide` 早期用「切全文 + 子串匹配」实现分节，结果 `spec` 节只剩 111 字符——最关键的版式字段契约被切碎了，模型看不到。现在改为 `guideSections()` 按 key 组织，`designGuide(section)` 直接取，全文由各段 join 而成。

### 15.10 batch 是原子事务

officecli 的 `batch` 走「临时副本 → 全成功才 File.Replace」，所以半成品不会落盘。`office_deck_create` 一次提交上百条命令是安全的；失败时 `submitBatch()` 会把错误定位到具体第几条命令再抛出。

注意 resident 模式下 `batch` 只写内存，必须显式 `save` 才落盘。

---

## 16. 已知限制

| 限制 | 说明 |
|---|---|
| **视觉自检依赖模型能力** | 截图回传链路已打通且验证通过，但当前部署的模型（`glm-4.5-air` / `glm-4.7`）未声明 `image` 输入模态，模型实际看不到截图。需在 `settings.yaml` 的 provider `models` / `modelOverrides` 上给视觉模型声明 `input: [text, image]`（如 `glm-4.6v`）才能完整闭环。在此之前工具会明确降级为结构化校验 |
| **native 渲染后端** | 取决于本机是否装 PowerPoint 且 COM 可用；缺失时截图会走 html 后端 |
| **docx/xlsx 无设计层** | 高层排版能力目前只覆盖 pptx。docx/xlsx 用底层原语工具，需要模型自己组织结构 |
| **watch 空闲超时** | OfficeCLI watch 有空闲自动退出机制。插件监听 `child exit` 清句柄，下次 `ensure()` 会重启，但重启期间的预览会断一下 |
| **进程残留** | 插件卸载时会先 `officecli unwatch` 优雅关停，超时则 `taskkill /T /F` 杀进程树。异常退出仍可能残留，可手动清理 |
| **HMR 默认关闭** | base bundle 的 `- id: hmr` 是 `disabled: true`。改代码需 `pnpm build` + 重启 DSH（或在插件目录跑 watch 构建） |

---

## 17. 许可

MIT
