# VibeGPS Slide Report 设计文档

## 1. 目标

新增 `slide` 作为第三种报告格式，与现有 `html`/`md` 并行。通过 Meta Prompt 引导 Agent（codex exec）一次性生成一份全屏幻灯片 HTML，以"建筑师视角"向开发者呈现项目的架构全景、变更意图、模块关系和关键文件变化。

核心理念：开发者的角色正在从"逐行写代码"转向"软件建筑师"，Report 应该帮助建筑师在 3-5 分钟内恢复对项目演化的掌控感，而不是让他去读 git diff。

## 2. 架构定位

### 2.1 与现有管线的关系

```
现有路径（零修改）:
  generateReport() → analyzeReport() → renderHtml() / renderMarkdown()

新增路径:
  generateReport() → buildSlidePrompt() → runSlideGenerator() → slide.html
```

`slide` 路径完全独立于现有的分析+渲染路径。`analyzeReport()`、`renderHtml()`、`renderMarkdown()` 不做任何修改。

### 2.2 数据管线复用

```
resolveReportWindow()     ← 复用，拿到 delta 窗口数据
buildAnalyzerContext()     ← 复用，拿到项目/设计上下文
       ↓
buildSlidePrompt()         ← 新增，组装 Meta Prompt
       ↓
runSlideGenerator()        ← 新增，codex exec --ephemeral
       ↓
writeFileSync("slide.html")
```

## 3. 代码变更范围

| 文件 | 变更类型 | 内容 |
|------|---------|------|
| `src/shared/types.ts` | 微改 | `Report.format` 类型新增 `"slide"` |
| `src/shared/config.ts` | 微改 | `defaultFormat` 类型新增 `"slide"` 选项 |
| `src/commands/report.ts` | 微改 | 新增 `--format slide` 命令行参数 |
| `src/services/report.ts` | 扩展 | `generateReport()` 中新增 `slide` 分支 |
| `src/services/slide-generator.ts` | **新增** | Meta Prompt 构建 + codex exec 调用 + HTML 输出 |

**原则**：现有的 `renderHtml()`、`renderMarkdown()`、`analyzeReport()` 零修改。所有新增逻辑走独立路径，保证原有工作流程不受影响。

## 4. Meta Prompt 设计

Meta Prompt 是本次设计的核心。它引导 Agent 扮演"建筑师视角的技术叙事者"，结构分为四层。

### 4.1 角色设定层

- 你是软件架构可视化专家
- 你的受众是"建筑师型开发者"——关心整体结构、模块关系、系统工程，而不是逐行 diff
- 你的任务是生成一份全屏幻灯片 HTML，让开发者在 3-5 分钟内恢复对项目演化的掌控感
- 每一页幻灯片必须是文字与图形的搭配组合

### 4.2 内容框架层

以下为 Slide 的核心页面：

| 页面 | 内容 | 建筑隐喻 | 图形要求 |
|------|------|----------|---------|
| 封面 | 标题、分支、时间窗口、一句话摘要 | 工程铭牌 | 项目标识性图形 |
| 架构全景 | 模块结构 + 依赖关系 | 建筑平面图 | SVG 架构图（节点+连线） |
| 变更意图叙事 | 本轮演化的战略目标，用叙事而非列表 | 设计意图说明书 | 意图流程图或概念图 |
| 模块关系变化 | 模块间连接的新增/修改/断开 | 结构工程变更单 | 前后对比关系图（可带动效） |
| 关键文件深入 | 核心文件的改造前 vs 改造后可视化理解 | 施工详图 | 文件结构可视化/变更热力图 |
| 风险与建议 | 风险点 + review 建议 | 质检报告 | 风险等级可视化 |

Agent 可根据实际数据增减页面数量（最小 5 页，最大 12 页）。

### 4.3 工具箱层（约定但不强制）

提供可选的动画/样式资源，Agent 自主决定是否使用以及如何使用：

- **动画**：CSS `@keyframes` + `transition`，可参考 animate.css 的命名风格（fadeIn、slideUp、zoomIn 等），鼓励自定义。鼓励为 SVG 图形添加入场动效和页面过渡动效，由 Agent 自主判断哪些图形适合添加动效。
- **图形**：纯 SVG/CSS 绘制架构图、关系图、流程图、热力图等。不依赖外部 JS 库，保证 HTML 自包含。
- **排版**：CSS Grid/Flexbox 布局，大字号、高对比度、充足留白。
- **配色**：不限定色板，信任 Agent 审美，但需保证可读性和对比度。
- **翻页**：内嵌轻量 JS 实现键盘监听（左右方向键 + 点击翻页），不依赖 reveal.js 等外部框架。

### 4.4 输出约束层

- 输出必须是完整的、自包含的单个 HTML 文件
- 不依赖任何外部 CDN 或资源文件
- 使用中文作为报告语言
- 每页必须有文字 + SVG/CSS 图形搭配
- 总页面数 5-12 页

## 5. slide-generator.ts 模块设计

### 5.1 对外接口

```typescript
export function generateSlideReport(
  context: AnalyzerContext,
  config: VibegpsConfig
): string | null;
```

返回完整 HTML 字符串，失败返回 `null`。

### 5.2 内部结构

```typescript
// 1. 组装 Meta Prompt
function buildSlidePrompt(context: AnalyzerContext): string;

// 2. 调用 codex exec
function runSlideGenerator(prompt: string, workspaceRoot: string): string | null;

// 3. 验证输出
function validateSlideHtml(html: string): boolean;
```

### 5.3 codex exec 调用方式

与现有 `runCodexAnalyzer()` 一致：

```typescript
codex exec --ephemeral --skip-git-repo-check
  -c features.codex_hooks=false
  -C <workspaceRoot>
  -s read-only
  -o <outputPath>
  -
```

输入：Meta Prompt 通过 stdin 传入
输出：HTML 文件写入 outputPath

## 6. report.ts 中的 slide 分支

在 `generateReport()` 中，当 format 为 `slide` 时：

```
if (format === "slide") {
  1. resolveReportWindow()           // 复用
  2. buildAnalyzerContext()           // 复用
  3. generateSlideReport(context)     // 新增
  4. 若成功 → 写入 slide.html
  5. 若失败 → 回退到 renderHtml()    // 容错
  6. insertReport() + recordRecentReport()  // 复用
}
```

## 7. 配置扩展

在 `VibegpsConfig.report` 中新增：

```typescript
slideGenerator: {
  enabled: boolean;       // 是否启用 slide 格式
  maxSlides: number;      // 最大页数，默认 12
  minSlides: number;      // 最小页数，默认 5
}
```

`timeout` 不设默认值，待实测后确定。

## 8. 容错策略

- `codex exec` 生成失败 → 回退生成现有 `html` 格式报告，CLI 输出提示信息
- 输出内容不是合法 HTML（缺少 `<!DOCTYPE` 或 `<html` 标签）→ 回退
- 超时 → 回退
- 回退不影响 report 记录写入数据库

## 9. 命令行接口

```bash
# 生成 slide 格式报告
vibegps report --format slide

# 现有命令不受影响
vibegps report              # 默认 html
vibegps report --format md  # markdown
```

## 10. 不做的事情

- 不修改 `analyzeReport()`、`renderHtml()`、`renderMarkdown()` 的任何逻辑
- 不引入外部前端框架（reveal.js、Marp 等）
- 不引入外部 CDN 资源
- 不支持多 LLM 后端（统一使用 codex exec）
- 不在本次设计中确定超时时长（待实测）
