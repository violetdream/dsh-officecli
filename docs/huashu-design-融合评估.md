# huashu-design × dsh-officecli 能力融合评估

> 评估对象：`D:\workspace\skills\huashu-design`（花叔Design，MIT，v3.1，SKILL.md 64628 字符 + 31 篇 references + 20 个 scripts）
> 评估目标：能否让 dsh-officecli 在「生成 PPT 之前」具备设计能力
> 结论日期：2026-09-17

---

## 0. 结论先行

**能融合，但必须按层取舍**——三个层次的判定完全不同：

| 层 | 内容 | 判定 | 理由 |
|---|---|---|---|
| **方法层** | 三方向硬门 / form 五问 / 反 AI slop / 评审 5 维度 / 色彩推导协议 / Gate 文件协议 | ✅ **建议全量融入** | 纯文本资产，零依赖，恰好补上插件最缺的「内容与审美组织方法」 |
| **风格层** | 60 种风格库（其中 PPT 20 种） | 🔄 **建议做，但必须翻译** | HTML DNA ≠ officecli prop，需要一次「风格 → 参数」的映射解构 |
| **管线层** | HTML → PDF/PPTX（playwright + pptxgenjs + sharp） | ❌ **明确排除** | 破坏零依赖定位，且产物质量**低于**插件现有原生生成能力 |

**最关键的判断**：huashu-design 的 PPT 交付物是 **HTML**，PPTX 只是靠 `html2pptx.js` 翻译出来的衍生物；而 dsh-officecli 是**原生 pptx 生成**。两者不是「能力高低」的差别，是**介质不同**。所以要拿的是它的**设计方法与审美纪律**，不是它的**导出管线**。

---

## 1. 两边到底是什么

| 维度 | dsh-officecli | huashu-design |
|---|---|---|
| 本质 | 原生 OfficeCLI 之上的**排版计算层** | HTML 媒介的**设计工作室方法论** |
| PPT 产物 | 原生 `.pptx`（真形状/真图表/真表格） | `.html` 聚合 deck 为主；PDF/PPTX 是衍生物 |
| 布局方式 | 19 种固定版式，坐标由插件算 | 自由 CSS（flex/absolute/grid） |
| 画布 | 960×540pt、12 栏、8pt 基线 | 1920×1080px HTML；editable-PPTX 路径要求 body 960×540pt |
| 运行时依赖 | **零**（纯 TS 设计层） | playwright + pptxgenjs + sharp + pdf-lib |
| 代码规模 | src 8223 行 | SKILL.md + references ≈ 40000 行 + 20 脚本 |
| 强项 | 模型几乎不可能摆歪；原生元素可编辑 | 设计方向探索、审美纪律、反 slop |
| 弱项 | 只有版式，**没有设计方法与审美门禁** | 依赖重；PPTX 路径 pass 率低（视觉驱动 HTML 实测 <30%） |

**互补性极强**：插件缺的正好是 huashu 的强项（方法），huashu 最弱的地方（PPTX 原生保真与稳定性）正好是插件的强项。

---

## 2. 一个必须先说的技术巧合

**两边画布坐标语义完全一致。**

- dsh-officecli：画布 960×540pt，1pt 直接下发，`EmuConverter` 原生接受 `xxpt`
- huashu-design `references/editable-pptx.md`：明确推荐 body `960pt × 540pt`，对应 pptxgenjs `LAYOUT_WIDE` 13.333″×7.5″

同一坐标系，意味着**风格参数（字号量级、栏距比例、留白策略）可以跨系统直接换算**，不必做单位归一。这是融合成本远低于预期的主要原因。

第二个巧合：huashu 的「三方向硬门」要求**真实初稿截图**而非文字描述（铁律：绝不让用户在看不到视觉时选风格）。而 dsh-officecli 已经有 `office_screenshot`，渲染 + 回传 PNG 链路已打通。**插件生成一版初稿的成本是一次 batch 调用**，在 huashu 里是写一份完整 HTML + playwright 截图。所以这道门在插件里**比在 huashu 自己的环境里更便宜**——这不是障碍，是结构性优势。

---

## 3. Layer A · 方法层（建议全量融入）

这是收益最高、成本最低的一层。全是文本资产，不需要引入任何依赖。

### 3.1 资产清单与落点

| huashu 资产 | 核心内容 | 落到插件哪里 | 实现方式 |
|---|---|---|---|
| **三方向硬门**（Fallback Phase 1–5） | 任何新设计 100% 先出 3 版差异化真实初稿给用户选，选定才执行；指定风格/品牌名也不豁免 | 新增工具 `office_deck_directions` | 生成 3 份「2 页代表页」pptx + 截图回传；三版风格分别取「稳妥底盘 / 差异化对照 / 大胆轮盘」 |
| **form 推导五问** | ①叙事角色 ②观众距离 ③视觉温度 ④容量估算 ⑤视觉母题 | `office_design_guide` 新增 `form` 节 | 纯文案，约 50 行；第五问「母题」是反套模板的最小证据 |
| **反 AI slop 清单** | 紫渐变万能公式 / emoji 当图标 / 圆角卡+左彩 border accent / GitHub-dark 偷懒解 / SVG 画 imagery | 新增 `slop` 节 + `lint.ts` 新检查 | 可判定的部分做成 lint 规则（见 3.3） |
| **评审 5 维度** | 概念(一票否决·权重最高) / 哲学一致 / 视觉层级 / 细节执行 / 功能性 / 创新性；含 Top10 常见问题 | 新增工具 `office_deck_review` | 直接落地 `critique-guide.md` 的评分表与输出模板 |
| **色彩推导协议** | 采样（品牌/真图/文化语境）→ 收敛（oklch 压到 2-3 有彩 + 1 组中性）→ 论证（一句话说为什么是这个色） | 扩展 `theme.ts` 的 `themeFromPrimary()` | **这是插件当前的实质缺陷**，见 3.2 |
| **2 页 showcase 定 grammar** | deck ≥5 页时，先做视觉差异最大的 2 页给用户确认 grammar，再批量其余页 | `office_deck_create` 前置建议 + lint 提示 | 流程约束，防止「方向不对返工 13 次」 |
| **Gate 文件协议** | 检查点物化为项目目录里必须存在的文件（`direction-approved.md` / `brand-spec.md`），防止长会话被「继续」的惯性冲掉 | 会话工作区落 gate 文件 | 与插件已有的会话隔离目录天然契合 |
| **出版物 grammar / masthead 模板** | 每页共用 chrome（刊头 + 页脚 + 页码）+ **视觉主角类型轮换**（封面排版/单角色/时间轴/知识图谱/Before-After/大引号/头像卡…） | 可做成新模板，或并入 `NARRATIVE_GUIDE` | 与现有 12 套模板同构，扩展成本低 |

### 3.2 单点最高价值：主题派生要补「论证」环节

`src/pptx/theme.ts:373` 的 `themeFromPrimary(hex)` 现在的行为是：给一个主色，按色轮 +32° 派生辅色、接近补色派生强调色、按明暗取底色极值。

这正是 huashu `design-styles.md` 明确禁止的做法：

> 凭空选色 = 从模型先验里抽签，抽出来的永远是那几个网红色；从内容里采的色天然带「为什么」。

改造方向（不动现有机制，只加一条更优路径）：

1. `deck.style.colors` 显式色板优先生效（已支持 `applyThemeOverrides`，只是缺少「引导模型去采样」的协议说明）；
2. 新增 `deck.style.colorRationale`：要求模型写一句「为什么是这个色」（如「主色取自用户 logo 的赭石，压低 chroma 到 0.08 模拟油墨」），**写不出来就该回到采样步骤**；
3. 派生算法从「色轮旋转」升级为「oklch 明度序列 + 色相角约束（H ≥60° 或 L 差 ≥0.3）」，可读性优于现在的 HSL 旋转；
4. 内置「文化语境速查表」（同是红：故宫朱红 vs 可乐红；同是蓝：日本蓝染 vs 科技蓝）。

### 3.3 反 slop 落成可执行 lint

`src/pptx/lint.ts` 现有 8 项检查全是**结构**检查（密度下限、版式重复、非对称占比、数据落点、配图存在性）。**没有任何审美检查**。可新增：

| 检查项 | 级别 | 判据 |
|---|---|---|
| 字号层级比不足 | warn | 标题 / 正文 < 2.5 倍（huashu Top10 问题 #2） |
| `cards` 等宽卡片超量 | warn | 已有（≤2 次）——与 huashu 的 slop 判断同源 |
| 圆角卡 + 左彩 border 组合 | warn | 若模板装饰同时启用 `rail` + 全页 `cards`，提示这是 2020–2024 烂大街组合 |
| 全篇配色数超限 | warn | 主色+辅色+强调+灰阶以外的色令牌被显式覆盖超过 N 个 |
| 字体家族数超限 | warn | 超过 2 种（同一模板内 title/body 之外再改） |
| 留白「均匀稀薄」 | warn | 已部分覆盖（密度下限），可补容器填充率 |
| 缺视觉母题 | warn | `deck.style.colorRationale` / 母题字段为空 |

**注意去重**：huashu 的 slop 清单与插件已有的 `NARRATIVE_GUIDE` 高度同源（插件那句「等宽卡片横排是 AI 味最重的版式」就是同一个判断）。**必须合并，不能叠加**——否则指南膨胀、模型读不完，反而不执行。

---

## 4. Layer B · 风格层（建议做，但需要一次翻译）

### 4.1 体量与取舍

风格库共 60 种，其中 **PPT 分区 20 种**（大胆 8 / 中性 7 / 安静 5）。逐条核过后的分布：

| 状态 | 数量 | 说明 |
|---|---|---|
| 可映射 | 约 15 种 | HTML 实现描述里写明「纯 CSS 可 1:1 还原，零素材」 |
| 需降级 | 约 3 种 | 依赖照片/插画位（人文圆角卡片、玩味手绘极简、全幅渐变宣言），插件无生图能力，须标注降级 |
| 建议剔除 | 约 2 种 | 还原度 <80% 且灵魂依赖生图，与插件「无配图生成能力」硬冲突 |

> 这个限制与插件 README [16. 已知限制] 的「插件无配图生成能力」是同一条。所以**风格库的引入必然伴随一个前置判断**：该风格是否依赖 AI 生图/手绘素材。不依赖的进默认池，依赖的必须显式标注「本风格需自备配图」。

### 4.2 翻译方法：把 HTML DNA 解构成 6 个可映射字段

风格条目是写给 CSS 的（`clamp()`、`border:3px solid #000`、`box-shadow 硬投影`），不能 1:1 落成 officecli 的 `--prop`。但它可以解构成 6 个插件已有的旋钮：

```
风格条目  →  ①配色策略  ②字体配对  ③字号量级  ④版式偏向  ⑤装饰策略  ⑥密度与留白
              ↓           ↓           ↓           ↓           ↓           ↓
插件旋钮    theme.colors  theme.fonts  typography   templates.   contentDecor  lint 密度
                                    .scale      layouts 白名单  内容页装饰    门禁
```

三个真实映射示例：

| huashu PPT 风格 | 解构 | 落到插件 |
|---|---|---|
| **新瑞士大字报**（还原 98%） | 纯白/近黑底 + 单一高饱和强调色 + 中性网格线；超大字标题占半屏；母版=大色块章节页/巨型数字半屏/左右分栏对比/全幅扁平图表 | 新增模板 `neo-swiss-billboard`：theme 用单一 accent + 近黑/纯白 bg；`typography.scale ≈ 1.25`；`layouts` 白名单锁定 cover/section/kpi/compare/chart；decor 全关（无装饰即该风格本身） |
| **Bento 便当格模块网格**（还原 95%） | 浅灰/奶白或近黑底 + 品牌主色 + 1–2 强调色；不等高卡片 + 圆角 + 微描边；KPI 数字 tabular | 现有 `cards` + `kpi` 版式的**间距与卡片比例参数化**；新增 decor `bentoGrid`（不等高网格）——现有 `cards` 是等宽，需要新增一个变体 |
| **断言-证据 / Tufte**（还原 93%） | 白/极浅灰底 + 黑正文 + 单一克制强调色；**整句话标题**（非名词短语）+ 标题下单图证据 + 零 bullet | 纯指南约束，落到 `LENGTH_LIMITS` + `NARRATIVE_GUIDE`：要求 `chart`/`image-split` 页的 title 写完整断言句；lint 可检查标题是否含标点/动词 |

### 4.3 实现建议

新建 `src/pptx/styles.ts`，与现有 `custom-templates.ts` 同构：

- 风格 id → `{ themeHint, fontPair, typeScale, decor, layoutBias, density, motif, antiPattern, needsImages }`
- 复用 `resolveTheme()` 已有的**四步递进解析**（精确 id → 中文别名/关键词 → hex 主色 → 回落默认），把风格 id 挂进同一套别名机制，用户说「新瑞士大字报」「瑞士风」「大字报」都能命中
- 与 `deck.template` 正交：**风格决定视觉基因，模板决定外衣**，两者可组合
- 先落 15 条可用项，依赖生图的标注 `needsImages: true`，在 `office_design_guide` 的 styles 节明确告警

---

## 5. Layer C · 管线层（明确排除）

### 5.1 为什么不引入

huashu 的 `scripts/html2pptx.js`（1177 行）+ `export_deck_pptx.mjs` 是一条完整路径，但**不该进这个插件**：

| 反对理由 | 说明 |
|---|---|
| **破坏零依赖定位** | 需 playwright（数百 MB 级 Chromium）+ pptxgenjs + sharp。插件 package.json 目前 devDependencies 里连 playwright 都没有，设计层是纯 TS。引入后「轻量设计层」这个核心卖点消失 |
| **产物质量反而更低** | pptxgenjs 的 `fill` 只映射 solid，**不支持渐变**；无 web component；复杂 SVG 提不出来。而插件现有元素层有**真 chart（18 种）/ 真 table / 真 diagram**。用 HTML 翻译出的 pptx 去替换原生生成，是退步 |
| **两条腿会打架** | 同一份内容既有「DeckSpec → officecli」又有「HTML → pptxgenjs」两条生成路径，用户拿到的 pptx 结构不一致，维护债永续 |
| **pass 率不支撑** | huashu 自述：视觉驱动的 HTML 直接上 html2pptx，pass 率 <30%，且要求**从第一行 HTML 就按 4 条硬约束写**。即引入了管线，还必须额外约束「怎么写 HTML」——约束比现在写 DeckSpec 更多 |

### 5.2 但它的「约束思维」值得吸收

`references/editable-pptx.md` 末尾那段「为什么 4 条约束不是 Bug 而是物理约束」是本篇最值得读的一节，它的推理与 officecli 完全同构：

| huashu 的约束 | OOXML 根因 | officecli 的同构表现 |
|---|---|---|
| 文字必须包在 `<p>`/`<h*>` | 文字必须在 text frame（`<a:txBody>`） | 插件用 `shape` + text，天然满足 |
| `<p>` 不能有 background/border | shape 与 text frame 是两个对象 | 插件 `toProps()` 已分离 |
| div 不能用 `background-image`，要用 `<img>` | picture 必须引用真实文件 | 插件 `image-*` 版式走 `picture` 元素 |
| 不用 CSS gradient | shape fill 渐变支持有限 | 插件用 slide 原生渐变 `background=C1-C2-角度` |

**结论**：插件已经在物理约束下走在正确的一侧，所以**不引入管线，也不损失任何能力**。这段推理可以作为 README 里「为什么不做 HTML 导出路径」的正式回答。

---

## 6. 改造清单（按优先级）

### P0 · 高收益低成本（估计 1–2 天）

| # | 改动 | 文件 |
|---|---|---|
| 1 | 新增 `FORM_GUIDE`（form 五问）与 `ANTI_SLOP` 两节，挂进 `guideSections()` 的 `form` / `slop` key | `src/pptx/checklist.ts` |
| 2 | `NARRATIVE_GUIDE` 与 huashu slop 清单**去重合并**，不新增重复门禁 | `src/pptx/checklist.ts` |
| 3 | 新增 `office_deck_directions` 工具：一份主题 → 3 份差异化 2 页代表页 DeckSpec → 生成临时 pptx → 截图回传对比 | `src/tools/deck.ts` + 新 `src/pptx/directions.ts` |
| 4 | lint 补 3 项审美检查：字号层级比、字体家族数、配色令牌数 | `src/pptx/lint.ts` |
| 5 | `office_design_guide` 工具 description 与 enum 加 `form` / `slop` 节 | `src/tools/deck.ts` |

> 注：指南全量当前 10575 字符（`spec` 节 3265 / `limits` 1509 / `story` 1237…）。已有 `section` 参数支持按需取节，所以新增两节**不会**撑爆默认全量——但仍建议把新节设计成 800–1200 字符量级。

### P1 · 中等成本（估计 3–5 天）

| # | 改动 | 文件 |
|---|---|---|
| 6 | 色彩推导协议落地：`colorRationale` 字段 + oklch 派生 + 文化语境速查表 | `src/pptx/theme.ts` |
| 7 | 新增 `office_deck_review` 工具（5 维度评分 + Top10 问题清单 + Quick Wins 模板） | `src/tools/deck.ts` + `src/pptx/critique.ts` |
| 8 | `src/pptx/styles.ts`：15 条 PPT 风格 → 参数派生，接入 `resolveTheme` 别名机制 | 新文件 |
| 9 | Gate 文件协议：会话目录落 `direction-approved.md`，`office_deck_create` 检查（≥5 页时提示） | `src/workspace.ts` + `src/tools/deck.ts` |

### P2 · 可选增强

| # | 改动 |
|---|---|
| 10 | 新增 2–3 套模板（出版物 grammar / bento 不等高网格 / 断言-证据） |
| 11 | 2 页 showcase 流程：`office_deck_create` 支持 `previewOnly`（只出前 2 页代表页） |

---

## 7. 风险与不做的事

| 风险 | 说明与对策 |
|---|---|
| **指南膨胀** | designGuide 已 10575 字符。新增内容必须**合并而非堆叠**，且新节控制在 1200 字符内。宁可让模型按 `section` 取，也不要一次塞全量 |
| **依赖膨胀** | 已通过排除 Layer C 规避。**任何情况下不要把 playwright / pptxgenjs 写进 package.json** |
| **许可** | huashu-design 是 **MIT**（Copyright (c) 2026 alchaincyf）。可自由复制/修改/再分发，**但分发时必须保留版权声明与许可副本**。若直接拷贝其文本资产进 `checklist.ts`，需在文件头注明来源与 MIT 声明；风格条目里的「参考」（Bloomberg Businessweek / Pentagram 等）是设计流派名，属事实性引用 |
| **生图能力缺口** | 插件无配图生成能力（README 已知限制）。风格库里依赖生图/插画的条目必须标 `needsImages`，否则模型会推出「做不出该风格却硬做」的劣化版 |
| **与现有 NARRATIVE_GUIDE 语义重叠** | 两者同源（都在反「AI 味」）。合并去重是 P0 的第 2 项，不能跳过 |
| **不要做的事** | ❌ 不引入 HTML 渲染管线；❌ 不做自由布局（插件用 19 固定版式换稳定性，这是设计取舍，不是缺陷）；❌ 不照搬 huashu 的 3 版并行 subagent 机制（DSH 无 spawn 语义，改用「3 份 DeckSpec + 截图」在单次会话内完成） |

---

## 8. 一句话总结

**huashu-design 给 dsh-officecli 补的是「审美纪律与设计流程」，不是「生成引擎」。** 两者介质不同（HTML vs 原生 pptx）、强项互补，所以正确的融合姿势是：**把它的方法层与风格层翻译进插件的指南、lint、主题派生与工具面，把它的导出管线留在门外**。画布坐标（960×540pt）与截图回传能力的高度吻合，让这件事的成本远低于预期——P0 部分约 1–2 天即可见到「生成前先做设计」的效果。

---

## 9. 落地记录（已完成 · 与上文清单对照）

按第 6 节清单执行，方法层与风格层已全部接入原生生成链路。

### 9.1 清单对照

| # | 项 | 状态 | 落点与偏差 |
|---|---|---|---|
| P0-1 | `FORM_GUIDE` + `SLOP_GUIDE` | ✅ | `src/pptx/checklist.ts`；`form` 958 字符 / `slop` 1404 字符，均在预算内 |
| P0-2 | 与 `NARRATIVE_GUIDE` 去重 | ✅ | 卡片横排、密度门禁只在 `story` 讲；`slop` 只讲禁区与色彩推导 |
| P0-3 | 三方向工具 | ✅ | 落在新建的 `src/tools/design.ts`（未另建 `directions.ts`）。产物是**真实 pptx 初稿**而非 DeckSpec 描述，每方向 2 页代表页、文件名 `xxx-方向a/b/c.pptx` |
| P0-4 | lint 审美层 | ✅ | `src/pptx/lint.ts` 三层：结构层（原）/ 审美层（字号层级比、字号级数、字体家族数、色相数、GitHub-dark 禁区、激进紫渐变）/ 风格层（preset 的 `avoid` 硬清单） |
| P0-5 | 指南 enum 扩展 | ✅ | `office_design_guide` 新增 `styles` / `form` / `slop` / `review` 四个可选节，另加 `style` 参数取单套详情 |
| P1-6 | 色彩推导协议 | ✅ | `theme.ts` 引入 OKLCH：`derivePalette` 三步（采样→收敛→论证）、`rebaseColor` 色相迁移、`deltaE` / `contrastRatio` |
| P1-7 | 评审工具 | ✅ | `office_deck_review`，**6 维度**（比原计划 5 维多「概念/立意」，且带一票否决） |
| P1-8 | 风格库 | ✅ | `src/pptx/styles.ts` **17 套**（大胆 6 / 中性 6 / 安静 5），已剔除依赖 AI 生图的流派 |
| P1-9 | Gate 文件协议 | ⛔ 未做 | 改为工具面硬引导：`office_deck_directions` 的 render 明确要求「先截图给用户看、再让用户挑」，比落一个可被跳过的文件更可靠 |
| P2-10 / 11 | 新模板 / `previewOnly` | ⛔ 未做 | 三方向工具已经覆盖「先看 2 页再说」的实际需求 |

### 9.2 落地中发现并修掉的两个真问题

这两个都不是清单里的项，是**实测截图看出来的**：

1. **色彩论证被覆盖** —— `applyThemeOverrides` 对任何显式色槽都无条件改写 `colorRationale`，把 `applyStyle` 刚写下的「品牌色同源迁移」说明冲成一句泛化文案。已改为：只有取值**真的变了**才记一笔，且用追加而非替换。
2. **换风格封面没换** —— `applyStyle` 只在自己声明了 `heroGradient` 时才覆盖，否则**继承基底主题的渐变**。后果是选「新瑞士大字报」（主色 `0A0A0A`）却得到一张商务蓝封面。已改为：hero 渐变一律由本风格接管（自带就用自带的，否则从本风格主色派生）。

### 9.3 验证资产

| 脚本 | 作用 |
|---|---|
| `scripts/regress.mjs` | 回归总跑：一次跑完 8 个脚本并汇总 |
| `scripts/e2e-design.mjs` | 设计层端到端：指南新节 / preset 生效 / 品牌色迁移 / 未知 preset 回退 / 三方向初稿 / 评审，**含 PowerPoint COM 真开校验** |
| `scripts/demo-styles.mjs` | 同一份内容换 3 套风格出图，用于「看得见的验收」 |
| `scripts/probe-tpl.mjs` | 二分定位 batch 崩溃到哪一条命令（officecli 打印错误时自身会抛 .NET 异常，真实错误被吞掉） |
| `scripts/smoke-styles.mjs` | 17 套风格自检：对比度、色差、hero 渐变归属、别名解析、三方向去重 |

**验收结果**：8 个脚本全绿；生成物经 PowerPoint 实际打开验证（预设稿 5 页 / 品牌色稿 / 3 份方向初稿各 2 页）；`tsc` 零错误。

