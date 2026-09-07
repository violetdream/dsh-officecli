#!/bin/bash
# 用 officecli 构建一份自我介绍 PPT（16:9，960x540pt = 13.333x7.5in）。
# 用法: bash scripts/make-intro-ppt.sh [输出目录]
# 默认输出到当前 DSH 会话的 dsh-officecli 工作区，便于侧边栏实时预览。
# 所有坐标为硬编码英寸值，不依赖 bc/awk 等外部算术工具。

set -u
F="ai_intro.pptx"
if [ -n "${1:-}" ]; then
  SESSION_DIR="$1"
else
  # 未指定时落到最近改动的会话工作区，也就是当前 DSH 会话的目录
  ROOT="C:/Users/刘仙伟/AppData/Local/Temp/dsh-officecli"
  SESSION_DIR="$(ls -dt "$ROOT"/*/ 2>/dev/null | head -1 | sed 's:/$::')"
  if [ -z "$SESSION_DIR" ]; then
    echo "未找到会话目录，请显式传入：bash $0 <输出目录>"
    exit 1
  fi
fi
echo "输出目录: $SESSION_DIR"
cd "$SESSION_DIR" || exit 1

NAVY="#0F2A4A"      # 主色：深蓝（标题 / 封面底）
NAVY2="#16375C"     # 封面与尾页的装饰圆
BLUE="#2E74B5"      # 强调色
LBLUE="#93C5FD"     # 深底上的浅蓝副文
CARD="#F1F5F9"      # 卡片底
TIPBG="#EFF6FF"     # 提示条底
TIPFG="#1D4ED8"     # 提示条文字
GREY="#64748B"      # 次要文字
TEXT="#334155"      # 正文
CODEBG="#0F172A"    # 代码块底
CODEFG="#E2E8F0"    # 代码块文字
W="#FFFFFF"

rm -f "$F"
officecli create "$F" --type pptx >/dev/null 2>&1 || { echo "创建失败"; exit 1; }

# 新建空白页
P() { officecli add "$F" / --type slide >/dev/null 2>&1; }
# 在指定页添加形状；失败时打印，便于定位不支持的属性
S() {
  officecli add "$F" "/slide[$1]" --type shape "${@:2}" >/dev/null 2>&1 \
    || echo "  [失败] slide$1 ${*:2}" >&2
}
# 页背景
BG() { officecli set "$F" "/slide[$1]" --prop background="$2" >/dev/null 2>&1; }
# 浅色内容页的统一页眉：标题 + 强调条 + 页码
HDR() {
  S "$1" --prop text="$2" --prop x=0.75in --prop y=0.48in --prop width=11.8in \
    --prop height=0.85in --prop size=30pt --prop bold=true --prop color="$NAVY"
  S "$1" --prop text="" --prop x=0.75in --prop y=1.46in --prop width=1.3in \
    --prop height=0.055in --prop fill="$BLUE"
  S "$1" --prop text="$3 / 7" --prop x=10.9in --prop y=6.85in --prop width=1.65in \
    --prop height=0.3in --prop size=10pt --prop color="$GREY" --prop align=right
}
# 要点：小方块 + 文本
BUL() {
  S "$1" --prop text="" --prop x=0.78in --prop y="$2" --prop width=0.13in \
    --prop height=0.13in --prop fill="$BLUE"
  S "$1" --prop text="$4" --prop x=1.12in --prop y="$3" --prop width=11.4in \
    --prop height=0.5in --prop size=16pt --prop color="$TEXT"
}

# ── P1 封面 ────────────────────────────────────────────────────────────────
P; BG 1 "$NAVY"
S 1 --prop text="" --prop x=8.9in --prop y=-1.6in --prop width=6.2in --prop height=6.2in \
  --prop fill="$NAVY2" --prop geometry=ellipse --prop opacity=0.55
S 1 --prop text="" --prop x=-1.4in --prop y=5.4in --prop width=3.4in --prop height=3.4in \
  --prop fill="$BLUE" --prop geometry=ellipse --prop opacity=0.18
S 1 --prop text="认识我" --prop x=0.9in --prop y=2.35in --prop width=11in \
  --prop height=1.35in --prop size=66pt --prop bold=true --prop color="$W"
S 1 --prop text="一个住在你代码仓库里的 AI 编码助手" --prop x=0.92in --prop y=3.78in \
  --prop width=11in --prop height=0.6in --prop size=22pt --prop color="$LBLUE"
S 1 --prop text="" --prop x=0.92in --prop y=4.72in --prop width=2.3in \
  --prop height=0.05in --prop fill="$BLUE"
S 1 --prop text="DeepSeek Harness  ·  dsh-officecli" --prop x=0.92in --prop y=6.45in \
  --prop width=7in --prop height=0.35in --prop size=12pt --prop color="#94A3B8"

# ── P2 我是谁 ──────────────────────────────────────────────────────────────
P; HDR 2 "我是谁" 2
BUL 2 2.20in 2.00in "我是 WorkBuddy，由 DeepSeek Harness 驱动的 AI 编码助手"
BUL 2 2.95in 2.75in "当前推理模型 glm-4.5-air，可按任务切换到别的模型"
BUL 2 3.70in 3.50in "工作目录 D:\\workspace\\deepseek-harness（DSH 框架仓库）"
BUL 2 4.45in 4.25in "架构信条：一切皆插件，能力由 cordis 插件树装配而成"
BUL 2 5.20in 5.00in "会话隔离：每次对话拥有独立的上下文与工作区目录"

# ── P3 我能做什么（2x2 卡片）──────────────────────────────────────────────
P; HDR 3 "我能做什么" 3
# 卡片：底板
S 3 --prop text="" --prop x=0.75in  --prop y=2.05in --prop width=5.75in --prop height=1.85in --prop fill="$CARD"
S 3 --prop text="" --prop x=6.83in  --prop y=2.05in --prop width=5.75in --prop height=1.85in --prop fill="$CARD"
S 3 --prop text="" --prop x=0.75in  --prop y=4.15in --prop width=5.75in --prop height=1.85in --prop fill="$CARD"
S 3 --prop text="" --prop x=6.83in  --prop y=4.15in --prop width=5.75in --prop height=1.85in --prop fill="$CARD"
# 卡片标题
S 3 --prop text="写代码" --prop x=1.05in --prop y=2.30in --prop width=5.15in --prop height=0.45in --prop size=17pt --prop bold=true --prop color="$NAVY"
S 3 --prop text="读代码" --prop x=7.13in --prop y=2.30in --prop width=5.15in --prop height=0.45in --prop size=17pt --prop bold=true --prop color="$NAVY"
S 3 --prop text="跑命令" --prop x=1.05in --prop y=4.40in --prop width=5.15in --prop height=0.45in --prop size=17pt --prop bold=true --prop color="$NAVY"
S 3 --prop text="写文档" --prop x=7.13in --prop y=4.40in --prop width=5.15in --prop height=0.45in --prop size=17pt --prop bold=true --prop color="$NAVY"
# 卡片正文
S 3 --prop text="从零实现功能、补齐单元测试、定位并修复缺陷" --prop x=1.05in --prop y=2.85in --prop width=5.15in --prop height=0.8in --prop size=12.5pt --prop color="$GREY"
S 3 --prop text="跨仓库搜索符号、理清调用链与模块边界"     --prop x=7.13in --prop y=2.85in --prop width=5.15in --prop height=0.8in --prop size=12.5pt --prop color="$GREY"
S 3 --prop text="构建、测试、Git 操作与各类脚本自动化"     --prop x=1.05in --prop y=4.95in --prop width=5.15in --prop height=0.8in --prop size=12.5pt --prop color="$GREY"
S 3 --prop text="README、设计说明、交付报告，以及这份 PPT"  --prop x=7.13in --prop y=4.95in --prop width=5.15in --prop height=0.8in --prop size=12.5pt --prop color="$GREY"

# ── P4 我如何工作（5 步流程）──────────────────────────────────────────────
P; HDR 4 "我如何工作" 4
STEP() { # <卡片x> <内容x> <序号> <标题>
  S 4 --prop text="" --prop x="$1" --prop y=2.35in --prop width=2.28in --prop height=1.75in --prop fill="$CARD"
  S 4 --prop text="$3" --prop x="$2" --prop y=2.62in --prop width=0.48in --prop height=0.48in \
    --prop size=15pt --prop bold=true --prop color="$W" --prop fill="$BLUE" \
    --prop geometry=ellipse --prop align=center
  S 4 --prop text="$4" --prop x="$2" --prop y=3.28in --prop width=1.8in --prop height=0.5in \
    --prop size=13.5pt --prop bold=true --prop color="$NAVY"
}
STEP 0.75in  0.99in  1 "理解意图"
STEP 3.27in  3.51in  2 "定位代码"
STEP 5.79in  6.03in  3 "调用工具"
STEP 8.31in  8.55in  4 "验证结果"
STEP 10.83in 11.07in 5 "交付说明"
S 4 --prop text="" --prop x=0.75in --prop y=4.35in --prop width=11.83in --prop height=0.75in --prop fill="$TIPBG"
S 4 --prop text="每一步都发生在你的确认边界之内：写文件、跑命令前会先问过你。" \
  --prop x=1.05in --prop y=4.35in --prop width=11.2in --prop height=0.75in \
  --prop size=13pt --prop color="$TIPFG" --prop valign=center

# ── P5 我的工具箱 ──────────────────────────────────────────────────────────
P; HDR 5 "我的工具箱" 5
COL() { # <方块x> <文本x> <y方块> <y文本> <文本>
  S 5 --prop text="" --prop x="$1" --prop y="$3" --prop width=0.13in --prop height=0.13in --prop fill="$BLUE"
  S 5 --prop text="$5" --prop x="$2" --prop y="$4" --prop width=5.3in --prop height=0.5in \
    --prop size=14.5pt --prop color="$TEXT"
}
COL 0.78in 1.12in 2.20in 2.00in "文件读写与补丁编辑"
COL 0.78in 1.12in 2.85in 2.65in "Shell / PowerShell 执行"
COL 0.78in 1.12in 3.50in 3.30in "代码与文本搜索"
COL 0.78in 1.12in 4.15in 3.95in "子代理并行分工"
COL 6.83in 7.17in 2.20in 2.00in "网页搜索与资料核对"
COL 6.83in 7.17in 2.85in 2.65in "任务清单与进度跟踪"
COL 6.83in 7.17in 3.50in 3.30in "目标追踪与多轮续做"
COL 6.83in 7.17in 4.15in 3.95in "Office 文档（12 个 office_* 工具）"
S 5 --prop text="" --prop x=0.75in --prop y=5.55in --prop width=11.83in --prop height=0.8in --prop fill="$TIPBG"
S 5 --prop text="本次演示：我用 office_* 工具直接构建了你正在看的这份 PPT。" \
  --prop x=1.05in --prop y=5.55in --prop width=11.2in --prop height=0.8in \
  --prop size=13pt --prop color="$TIPFG" --prop valign=center

# ── P6 关于这份 PPT ────────────────────────────────────────────────────────
P; HDR 6 "关于这份 PPT" 6
BUL 6 2.20in 2.00in "由 AI 通过 officecli 命令行逐页构建，全程无手工排版"
BUL 6 2.95in 2.75in "背景、标题、卡片、装饰圆都是独立的 shape 元素"
BUL 6 3.70in 3.50in "文档状态实时回显在 DSH 侧边栏，边改边看"
S 6 --prop text="" --prop x=0.75in --prop y=4.55in --prop width=11.83in --prop height=1.55in --prop fill="$CODEBG"
S 6 --prop text='officecli add deck.pptx / --type slide
officecli add deck.pptx '"'"'/slide[1]'"'"' --type shape --prop text="认识我" --prop size=66pt' \
  --prop x=1.05in --prop y=4.55in --prop width=11.2in --prop height=1.55in \
  --prop size=12pt --prop font=Consolas --prop color="$CODEFG" --prop valign=center

# ── P7 结束页 ──────────────────────────────────────────────────────────────
P; BG 7 "$NAVY"
S 7 --prop text="" --prop x=9.6in --prop y=4.6in --prop width=5.4in --prop height=5.4in \
  --prop fill="$NAVY2" --prop geometry=ellipse --prop opacity=0.5
S 7 --prop text="很高兴认识你" --prop x=0.9in --prop y=2.95in --prop width=11.5in \
  --prop height=1.2in --prop size=50pt --prop bold=true --prop color="$W" --prop align=center
S 7 --prop text="下次直接说：帮我做一份 ……" --prop x=0.9in --prop y=4.35in \
  --prop width=11.5in --prop height=0.55in --prop size=16pt --prop color="$LBLUE" --prop align=center

officecli save "$F" >/dev/null 2>&1
echo "完成: $SESSION_DIR/$F"
officecli view "$F" stats --json 2>&1 | head -12
