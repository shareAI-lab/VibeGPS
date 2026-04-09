import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import type { AnalyzerContext } from "./report-analyzer";

export interface SlideGeneratorOptions {
  maxSlides: number;
  minSlides: number;
}

export function buildSlidePrompt(context: AnalyzerContext, options: SlideGeneratorOptions): string {
  const topFilesText = context.aggregate.topFiles
    .map((f) => `  - ${f.path} (${f.lastChangeType}, ${f.lines} lines, ${f.touches}x touched)`)
    .join("\n");

  const timelineText = context.aggregate.timeline
    .map((t) => `  - [${t.createdAt}] ${t.deltaId}: ${t.changedFiles} files, ${t.changedLines} lines — ${t.summary}${t.promptPreview ? ` (prompt: ${t.promptPreview.slice(0, 100)})` : ""}`)
    .join("\n");

  const candidatesText = context.reviewCandidates
    .map((c) => {
      let text = `  - ${c.path} (${c.changeType}, ${c.lines} lines)`;
      if (c.summary) text += `\n    摘要: ${c.summary}`;
      if (c.patchExcerpt) text += `\n    Patch 片段:\n${c.patchExcerpt.split("\n").map((l) => `      ${l}`).join("\n")}`;
      return text;
    })
    .join("\n");

  return `你是一位软件架构可视化专家，你的受众是"建筑师型开发者"。

## 你的身份

你不是在写 diff 报告，而是在为一位软件建筑师制作一份"项目演化简报"。
这位建筑师关心的是：整体结构、模块关系、系统工程、设计意图——而不是逐行代码变更。
你的目标是让他在 3-5 分钟内，通过一组视觉精美的幻灯片，恢复对项目演化的掌控感。

## 输出要求

你必须输出一个完整的、自包含的 HTML 文件，要求如下：
- 以 \`<!DOCTYPE html>\` 开头
- 不依赖任何外部 CDN、图片或资源文件
- 使用中文作为报告语言
- 实现全屏幻灯片体验（一次只展示一页，键盘左右方向键 + 鼠标点击翻页）
- 每页幻灯片必须是文字与图形（SVG/CSS）的搭配组合，不允许纯文字页面
- 总页面数在 ${options.minSlides} 到 ${options.maxSlides} 页之间

## 幻灯片内容框架

请按照以下建筑隐喻来组织你的幻灯片（可根据数据实际情况增减页面，但以下为最小集）：

### 1. 封面（工程铭牌）
- 项目名称/分支名
- 时间窗口：${context.fromCheckpointId} → ${context.toCheckpointId}
- 一句话摘要概括本阶段演化
- 配以项目标识性图形

### 2. 架构全景（建筑平面图）
- 用 SVG 绘制项目的模块结构和依赖关系图
- 节点代表模块/目录，连线代表依赖/调用关系
- 本次变更涉及的模块用高亮色标记

### 3. 变更意图叙事（设计意图说明书）
- 用叙事文字（而非列表）解释本轮演化的战略目标
- 配以意图流程图或概念图
- 回答"agent 这一阶段到底在推进什么"

### 4. 模块关系变化（结构工程变更单）
- 展示哪些模块之间的连接被新增、修改或断开
- 用前后对比的方式呈现（可带动效过渡）
- 让建筑师一眼看出结构层面发生了什么

### 5. 关键文件深入（施工详图）
- 对核心变更文件进行可视化解读
- 不是展示 diff，而是展示"改造前 vs 改造后"的结构理解
- 可用文件结构图、变更热力图、函数关系图等

### 6. 风险与建议（质检报告）
- 风险点可视化（严重程度、涉及范围）
- 建议 review 的优先顺序
- 下一步行动建议

## 工具箱（可选，不强制）

以下是你可以使用的工具和技术，自主决定是否使用以及如何组合：

- **动画**: CSS \`@keyframes\` + \`transition\`，可参考 animate.css 的命名风格（fadeIn、slideUp、zoomIn），也鼓励自定义动画。鼓励为 SVG 图形添加入场动效和页面过渡动效。
- **图形**: 纯 SVG 和 CSS 绘制架构图、关系图、流程图、热力图等。
- **排版**: CSS Grid / Flexbox 布局，大字号、高对比度、充足留白。
- **配色**: 完全信任你的审美判断，但需保证可读性和对比度。
- **翻页交互**: 内嵌轻量 JavaScript，支持键盘左右方向键和鼠标点击翻页，需要有当前页码指示器。不要使用 reveal.js 或其他外部框架。

## 项目数据

以下是你需要理解和呈现的项目演化数据：

### 基本信息
- 分支: ${context.gitBranch}
- 窗口: ${context.fromCheckpointId} → ${context.toCheckpointId}
- 触发方式: ${context.trigger}

### 聚合统计
- Delta 数量: ${context.aggregate.deltaCount}
- 触达文件数: ${context.aggregate.touchedFiles}
- 变更行数: ${context.aggregate.changedLines}
- 新增文件: ${context.aggregate.addedFiles}
- 修改文件: ${context.aggregate.modifiedFiles}
- 删除文件: ${context.aggregate.deletedFiles}

### 重点文件
${topFilesText || "  （无）"}

### Delta 时间线
${timelineText || "  （无）"}

### Review 候选文件（含 patch 摘要）
${candidatesText || "  （无）"}

${context.projectContext ? `### 项目上下文\n${context.projectContext}` : ""}

${context.designContext ? `### 设计文档上下文\n${context.designContext}` : ""}

## 最终提醒

- 你输出的必须是一个可以直接在浏览器中打开的完整 HTML 文件
- 从 \`<!DOCTYPE html>\` 开始，到 \`</html>\` 结束
- 不要输出任何 HTML 以外的内容（不要有解释文字、markdown 包裹等）
- 每一页都要有精心设计的 SVG/CSS 图形，不允许纯文字
- 动画要流畅优美，体现专业的视觉叙事能力
- 站在建筑师的角度思考：他需要的是蓝图和全景，不是砖块清单`;
}

export function validateSlideHtml(html: string): boolean {
  if (!html || html.length < 50) {
    return false;
  }

  const trimmed = html.trim();

  if (trimmed.startsWith("``" + "`")) {
    return false;
  }

  if (!trimmed.startsWith("<!DOCTYPE html>") && !trimmed.startsWith("<!doctype html>")) {
    return false;
  }

  if (!/<html[\s>]/i.test(trimmed)) {
    return false;
  }

  return true;
}

export function generateSlideHtml(
  context: AnalyzerContext,
  options: SlideGeneratorOptions & { workspaceRoot: string }
): string | null {
  const prompt = buildSlidePrompt(context, options);
  const tempRoot = mkdtempSync(join(tmpdir(), "vibegps-slide-"));
  const outputPath = join(tempRoot, "slide.html");

  try {
    const result = spawnSync(
      "codex",
      [
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        "-c",
        "features.codex_hooks=false",
        "-C",
        options.workspaceRoot,
        "-s",
        "read-only",
        "-o",
        outputPath,
        "-"
      ],
      {
        input: prompt,
        encoding: "utf8",
        timeout: 300000,
        stdio: ["pipe", "pipe", "pipe"]
      }
    );

    if (result.status !== 0 || !existsSync(outputPath)) {
      return null;
    }

    const html = readFileSync(outputPath, "utf8");
    if (!validateSlideHtml(html)) {
      return null;
    }

    return html;
  } catch {
    return null;
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}
