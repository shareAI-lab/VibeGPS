# Slide Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `slide` report format that uses a Meta Prompt to guide `codex exec` in generating animated, self-contained HTML slide presentations with an architect's perspective on project evolution.

**Architecture:** New `slide` format runs as a parallel path alongside existing `html`/`md` rendering. A new `slide-generator.ts` module builds a Meta Prompt from the existing `AnalyzerContext` data and invokes `codex exec --ephemeral` to produce a complete HTML file. Existing analysis and rendering code remains untouched.

**Tech Stack:** TypeScript, Node.js `child_process.spawnSync`, codex CLI, CSS animations, inline SVG

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/shared/types.ts` | Modify | Add `"slide"` to `Report.format` union |
| `src/shared/config.ts` | Modify | Add `slideGenerator` to `DEFAULT_CONFIG.report`, update `normalizeConfig` |
| `src/services/slide-generator.ts` | Create | Meta Prompt builder + codex exec runner + HTML validator |
| `src/services/report.ts` | Modify | Add `slide` branch in `generateReport()`, add `formatOverride` param |
| `src/commands/report.ts` | Modify | Add `--format` CLI option |
| `tests/slide-generator.test.ts` | Create | Tests for prompt building, HTML validation, fallback |

---

### Task 1: Extend types with `"slide"` format

**Files:**
- Modify: `src/shared/types.ts:19` (VibegpsConfig interface)
- Modify: `src/shared/types.ts:122` (Report interface)

- [ ] **Step 1: Write the failing test**

Create `tests/slide-generator.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { Report, VibegpsConfig } from "../src/shared";

describe("slide format type support", () => {
  it("accepts slide as a valid report format", () => {
    const report: Report = {
      reportId: "report_slide_1",
      workspaceId: "ws_1",
      branchTrackId: "bt_1",
      gitBranch: "main",
      createdAt: "2026-04-09T00:00:00.000Z",
      fromCheckpointId: "cp_1",
      toCheckpointId: "cp_2",
      trigger: "manual",
      format: "slide",
      summary: "测试 slide",
      path: "/tmp/report/slide.html"
    };
    expect(report.format).toBe("slide");
  });

  it("accepts slideGenerator in config", () => {
    const config: VibegpsConfig = {
      version: 1,
      thresholds: { changedFiles: 8, changedLines: 200 },
      report: {
        defaultFormat: "html",
        alsoEmitMarkdown: true,
        analyzer: "codex",
        autoGenerate: true,
        maxContextFiles: 6,
        maxPatchCharsPerFile: 1800,
        slideGenerator: {
          enabled: true,
          maxSlides: 12,
          minSlides: 5
        }
      },
      tracking: {
        ignoreGitDir: true,
        ignoreVibegpsDir: true,
        respectGitignore: true,
        ignoreGlobs: []
      }
    };
    expect(config.report.slideGenerator?.enabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --pool=vmThreads tests/slide-generator.test.ts`
Expected: FAIL — `"slide"` is not assignable to `"html" | "md" | "json"`, `slideGenerator` does not exist on type

- [ ] **Step 3: Update `src/shared/types.ts`**

Add `"slide"` to the Report.format union at line 131:

```typescript
// Before:
  format: "html" | "md" | "json";

// After:
  format: "html" | "md" | "json" | "slide";
```

Add `slideGenerator` to VibegpsConfig.report at line 30 (after `maxPatchCharsPerFile`):

```typescript
// Before:
    maxPatchCharsPerFile: number;
  };

// After:
    maxPatchCharsPerFile: number;
    slideGenerator?: {
      enabled: boolean;
      maxSlides: number;
      minSlides: number;
    };
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --pool=vmThreads tests/slide-generator.test.ts`
Expected: PASS

- [ ] **Step 5: Run all existing tests to verify no regressions**

Run: `npx vitest run --pool=vmThreads tests`
Expected: All existing tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts tests/slide-generator.test.ts
git commit -m "feat: add slide format type and slideGenerator config option"
```

---

### Task 2: Update default config and normalizeConfig

**Files:**
- Modify: `src/shared/config.ts:18-38` (DEFAULT_CONFIG)
- Modify: `src/shared/config.ts:40-58` (normalizeConfig)

- [ ] **Step 1: Write the failing test**

Append to `tests/slide-generator.test.ts`:

```typescript
import { DEFAULT_CONFIG, normalizeConfig } from "../src/shared";

describe("slide config defaults", () => {
  it("DEFAULT_CONFIG includes slideGenerator defaults", () => {
    expect(DEFAULT_CONFIG.report.slideGenerator).toEqual({
      enabled: true,
      maxSlides: 12,
      minSlides: 5
    });
  });

  it("normalizeConfig preserves custom slideGenerator values", () => {
    const config = normalizeConfig({
      report: {
        slideGenerator: { enabled: false, maxSlides: 8, minSlides: 3 }
      }
    } as any);
    expect(config.report.slideGenerator).toEqual({
      enabled: false,
      maxSlides: 8,
      minSlides: 3
    });
  });

  it("normalizeConfig fills slideGenerator defaults when not provided", () => {
    const config = normalizeConfig({});
    expect(config.report.slideGenerator).toEqual({
      enabled: true,
      maxSlides: 12,
      minSlides: 5
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --pool=vmThreads tests/slide-generator.test.ts`
Expected: FAIL — `DEFAULT_CONFIG.report.slideGenerator` is `undefined`

- [ ] **Step 3: Update `src/shared/config.ts`**

Add `slideGenerator` to `DEFAULT_CONFIG.report`:

```typescript
// In DEFAULT_CONFIG.report, after maxPatchCharsPerFile: 1800, add:
    slideGenerator: {
      enabled: true,
      maxSlides: 12,
      minSlides: 5
    }
```

Update `normalizeConfig` to merge `slideGenerator`:

```typescript
// Replace the report merge line:
// Before:
    report: {
      ...DEFAULT_CONFIG.report,
      ...input?.report
    },

// After:
    report: {
      ...DEFAULT_CONFIG.report,
      ...input?.report,
      slideGenerator: {
        ...DEFAULT_CONFIG.report.slideGenerator,
        ...input?.report?.slideGenerator
      }
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --pool=vmThreads tests/slide-generator.test.ts`
Expected: PASS

- [ ] **Step 5: Run all existing tests**

Run: `npx vitest run --pool=vmThreads tests`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/shared/config.ts tests/slide-generator.test.ts
git commit -m "feat: add slideGenerator defaults to config"
```

---

### Task 3: Create slide-generator.ts — Meta Prompt builder

**Files:**
- Create: `src/services/slide-generator.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/slide-generator.test.ts`:

```typescript
import { buildSlidePrompt } from "../src/services/slide-generator";
import type { AnalyzerContext } from "../src/services/report-analyzer";

function makeTestContext(overrides?: Partial<AnalyzerContext>): AnalyzerContext {
  return {
    workspaceRoot: "/tmp/test-project",
    gitBranch: "main",
    fromCheckpointId: "cp_1",
    toCheckpointId: "cp_2",
    trigger: "manual",
    aggregate: {
      deltaCount: 2,
      touchedFiles: 4,
      changedLines: 120,
      addedFiles: 1,
      modifiedFiles: 3,
      deletedFiles: 0,
      topFiles: [
        { path: "src/services/report.ts", touches: 2, lines: 64, lastChangeType: "modified" },
        { path: "src/commands/report.ts", touches: 1, lines: 18, lastChangeType: "modified" }
      ],
      timeline: [
        {
          deltaId: "delta_1",
          createdAt: "2026-04-09T00:01:00.000Z",
          changedFiles: 2,
          changedLines: 40,
          summary: "初步接通 report 入口",
          promptPreview: "实现变更分析报告"
        }
      ]
    },
    deltas: [],
    designContext: "# Design\nreport 不是 diff 列表，而是解释层。",
    projectContext: '{ "name": "vibegps" }',
    reviewCandidates: [
      {
        path: "src/services/report.ts",
        lines: 64,
        changeType: "modified",
        summary: "重构报告窗口与渲染逻辑",
        patchExcerpt: "@@ -10,5 +10,8 @@\n-old line\n+new line"
      }
    ],
    ...overrides
  };
}

describe("buildSlidePrompt", () => {
  it("includes role, content framework, toolbox, and output constraints", () => {
    const prompt = buildSlidePrompt(makeTestContext(), { maxSlides: 12, minSlides: 5 });

    expect(prompt).toContain("软件架构可视化专家");
    expect(prompt).toContain("建筑师");
    expect(prompt).toContain("架构全景");
    expect(prompt).toContain("变更意图");
    expect(prompt).toContain("模块关系");
    expect(prompt).toContain("关键文件");
    expect(prompt).toContain("SVG");
    expect(prompt).toContain("@keyframes");
    expect(prompt).toContain("自包含");
    expect(prompt).toContain("<!DOCTYPE html>");
    expect(prompt).toContain("5");
    expect(prompt).toContain("12");
  });

  it("injects project context data into the prompt", () => {
    const prompt = buildSlidePrompt(makeTestContext(), { maxSlides: 12, minSlides: 5 });

    expect(prompt).toContain("src/services/report.ts");
    expect(prompt).toContain("delta_1");
    expect(prompt).toContain("main");
    expect(prompt).toContain("cp_1");
    expect(prompt).toContain("cp_2");
    expect(prompt).toContain("重构报告窗口与渲染逻辑");
  });

  it("respects custom slide count limits", () => {
    const prompt = buildSlidePrompt(makeTestContext(), { maxSlides: 8, minSlides: 3 });

    expect(prompt).toContain("3");
    expect(prompt).toContain("8");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --pool=vmThreads tests/slide-generator.test.ts`
Expected: FAIL — cannot import `buildSlidePrompt`

- [ ] **Step 3: Create `src/services/slide-generator.ts` with `buildSlidePrompt`**

```typescript
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --pool=vmThreads tests/slide-generator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/slide-generator.ts tests/slide-generator.test.ts
git commit -m "feat: add buildSlidePrompt for meta prompt construction"
```

---

### Task 4: Add codex exec runner and HTML validator to slide-generator.ts

**Files:**
- Modify: `src/services/slide-generator.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/slide-generator.test.ts`:

```typescript
import { validateSlideHtml } from "../src/services/slide-generator";

describe("validateSlideHtml", () => {
  it("accepts valid HTML with doctype and html tag", () => {
    const html = '<!DOCTYPE html><html lang="zh-CN"><head><title>Test</title></head><body><div>slide</div></body></html>';
    expect(validateSlideHtml(html)).toBe(true);
  });

  it("rejects empty string", () => {
    expect(validateSlideHtml("")).toBe(false);
  });

  it("rejects plain text without HTML structure", () => {
    expect(validateSlideHtml("This is not HTML")).toBe(false);
  });

  it("rejects HTML without doctype", () => {
    expect(validateSlideHtml('<html><body>no doctype</body></html>')).toBe(false);
  });

  it("rejects markdown-wrapped HTML", () => {
    expect(validateSlideHtml('```html\n<!DOCTYPE html><html></html>\n```')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --pool=vmThreads tests/slide-generator.test.ts`
Expected: FAIL — cannot import `validateSlideHtml`

- [ ] **Step 3: Add `validateSlideHtml` and `runSlideGenerator` to `src/services/slide-generator.ts`**

Append the following to the existing file:

```typescript
export function validateSlideHtml(html: string): boolean {
  if (!html || html.length < 50) {
    return false;
  }

  const trimmed = html.trim();

  if (trimmed.startsWith("```")) {
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --pool=vmThreads tests/slide-generator.test.ts`
Expected: PASS

- [ ] **Step 5: Run all existing tests**

Run: `npx vitest run --pool=vmThreads tests`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/slide-generator.ts tests/slide-generator.test.ts
git commit -m "feat: add slide HTML validator and codex exec runner"
```

---

### Task 5: Add `slide` branch to `generateReport()` in report.ts

**Files:**
- Modify: `src/services/report.ts:1-10` (imports)
- Modify: `src/services/report.ts:1239-1307` (generateReport function)

- [ ] **Step 1: Write the failing test**

Append to `tests/slide-generator.test.ts`:

```typescript
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase, insertBranchTrack, insertCheckpoint, insertDelta } from "../src/services/db";
import { generateReport } from "../src/services/report";
import type { BranchTrack, Checkpoint, Delta } from "../src/shared";

describe("generateReport with slide format", () => {
  it("falls back to html when slide generation fails (no codex available)", () => {
    const root = mkdtempSync(join(tmpdir(), "vibegps-slide-report-"));
    const reportsDir = join(root, "reports");
    const deltaPatchesDir = join(root, "patches");
    const db = openDatabase(join(root, "state.db"));

    try {
      db.prepare("INSERT INTO workspaces (workspace_id, root_path, created_at, updated_at) VALUES (?, ?, ?, ?)")
        .run("ws_slide", root, "2026-04-09T00:00:00.000Z", "2026-04-09T00:00:00.000Z");

      const branchTrack: BranchTrack = {
        branchTrackId: "bt_slide",
        workspaceId: "ws_slide",
        gitBranch: "main",
        gitHead: "head_1",
        branchType: "named",
        createdAt: "2026-04-09T00:00:00.000Z",
        updatedAt: "2026-04-09T00:00:00.000Z"
      };
      insertBranchTrack(db, branchTrack);

      const initCp: Checkpoint = {
        checkpointId: "cp_init_slide",
        workspaceId: "ws_slide",
        branchTrackId: "bt_slide",
        gitBranch: "main",
        gitHead: "head_1",
        createdAt: "2026-04-09T00:00:00.000Z",
        kind: "init",
        snapshotRef: join(root, "snap-init.json"),
        fileCount: 1
      };
      const currentCp: Checkpoint = {
        checkpointId: "cp_cur_slide",
        workspaceId: "ws_slide",
        branchTrackId: "bt_slide",
        gitBranch: "main",
        gitHead: "head_2",
        createdAt: "2026-04-09T00:01:00.000Z",
        kind: "turn_end",
        parentCheckpointId: "cp_init_slide",
        snapshotRef: join(root, "snap-cur.json"),
        fileCount: 2
      };
      insertCheckpoint(db, initCp);
      insertCheckpoint(db, currentCp);

      const delta: Delta = {
        deltaId: "delta_slide_1",
        workspaceId: "ws_slide",
        branchTrackId: "bt_slide",
        gitBranch: "main",
        fromCheckpointId: "cp_init_slide",
        toCheckpointId: "cp_cur_slide",
        createdAt: "2026-04-09T00:00:30.000Z",
        source: "manual",
        changedFiles: 1,
        changedLines: 20,
        addedFiles: ["src/new.ts"],
        modifiedFiles: [],
        deletedFiles: [],
        items: [{ path: "src/new.ts", changeType: "added", addedLines: 20, deletedLines: 0, summary: "新模块" }]
      };
      const deltaPath = join(root, "delta_slide_1.json");
      writeFileSync(deltaPath, JSON.stringify(delta), "utf8");
      insertDelta(db, delta, deltaPath);

      const config = normalizeConfig({
        report: { analyzer: "heuristic" }
      } as any);

      const report = generateReport(db, {
        workspaceId: "ws_slide",
        workspaceRoot: root,
        branchTrack,
        currentCheckpoint: currentCp,
        initCheckpoint: initCp,
        config,
        reportsDir,
        deltaPatchesDir,
        trigger: "manual",
        formatOverride: "slide"
      });

      // Since codex is not available in test, should fall back
      // Report should still be created successfully
      expect(report.reportId).toBeTruthy();
      expect(existsSync(report.path)).toBe(true);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --pool=vmThreads tests/slide-generator.test.ts`
Expected: FAIL — `formatOverride` does not exist in `generateReport` input type

- [ ] **Step 3: Modify `src/services/report.ts`**

Add import at the top:

```typescript
import { generateSlideHtml } from "./slide-generator";
```

Add `formatOverride` to the input type of `generateReport`:

```typescript
export function generateReport(
  db: Database.Database,
  input: {
    workspaceId: string;
    workspaceRoot: string;
    branchTrack: BranchTrack;
    currentCheckpoint: Checkpoint;
    initCheckpoint: Checkpoint;
    config: VibegpsConfig;
    reportsDir: string;
    deltaPatchesDir: string;
    trigger: Report["trigger"];
    formatOverride?: Report["format"];
  }
): Report {
```

Replace the body of `generateReport` from line 1253 onward with:

```typescript
  const format = input.formatOverride ?? input.config.report.defaultFormat;
  const window = resolveReportWindow(db, input.branchTrack.branchTrackId, input.initCheckpoint, input.currentCheckpoint);

  const reportId = createId("report");
  const reportDir = join(input.reportsDir, reportId);
  mkdirSync(reportDir, { recursive: true });

  let slideHtml: string | null = null;
  let analysis: ReportAnalysis | undefined;

  if (format === "slide") {
    const slideContext = buildAnalyzerContext(
      {
        workspaceRoot: input.workspaceRoot,
        branchTrack: input.branchTrack,
        currentCheckpoint: input.currentCheckpoint,
        config: input.config,
        deltaPatchesDir: input.deltaPatchesDir,
        trigger: input.trigger
      },
      window
    );

    const slideOptions = input.config.report.slideGenerator ?? { enabled: true, maxSlides: 12, minSlides: 5 };
    slideHtml = generateSlideHtml(slideContext, {
      ...slideOptions,
      workspaceRoot: input.workspaceRoot
    });
  }

  if (format !== "slide" || !slideHtml) {
    // Original path: analyze + render html/md
    analysis = analyzeReport(
      buildAnalyzerContext(
        {
          workspaceRoot: input.workspaceRoot,
          branchTrack: input.branchTrack,
          currentCheckpoint: input.currentCheckpoint,
          config: input.config,
          deltaPatchesDir: input.deltaPatchesDir,
          trigger: input.trigger
        },
        window
      ),
      input.config
    );
  }

  const htmlPath = join(reportDir, "index.html");
  const mdPath = join(reportDir, "report.md");
  const slidePath = join(reportDir, "slide.html");

  const actualFormat = (format === "slide" && slideHtml) ? "slide" : (format === "slide" ? "html" : format);
  const reportPath = actualFormat === "slide"
    ? slidePath
    : actualFormat === "md"
      ? mdPath
      : htmlPath;

  const report: Report = {
    reportId,
    workspaceId: input.workspaceId,
    branchTrackId: input.branchTrack.branchTrackId,
    gitBranch: input.branchTrack.gitBranch,
    createdAt: nowIso(),
    fromCheckpointId: window.fromCheckpointId,
    toCheckpointId: input.currentCheckpoint.checkpointId,
    trigger: input.trigger,
    format: actualFormat,
    summary: analysis?.headline ?? "Slide Report",
    path: reportPath
  };

  if (slideHtml && actualFormat === "slide") {
    writeFileSync(slidePath, slideHtml, "utf8");
  }

  if (analysis) {
    writeFileSync(htmlPath, renderHtml(report, window, analysis, input.deltaPatchesDir), "utf8");
    if (input.config.report.alsoEmitMarkdown || actualFormat === "md") {
      writeFileSync(mdPath, renderMarkdown(report, window, analysis), "utf8");
    }
  }

  writeJson(join(reportDir, "report.json"), {
    report,
    window,
    aggregate: window.aggregate,
    ...(analysis ? { analysis } : {}),
    deltas: window.deltas
  });

  insertReport(db, report);
  recordRecentReport(input.workspaceRoot, input.workspaceId, report);
  return report;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --pool=vmThreads tests/slide-generator.test.ts`
Expected: PASS

- [ ] **Step 5: Run all existing tests to verify no regressions**

Run: `npx vitest run --pool=vmThreads tests`
Expected: All PASS — existing tests don't pass `formatOverride`, so the original path is taken

- [ ] **Step 6: Commit**

```bash
git add src/services/report.ts src/services/slide-generator.ts tests/slide-generator.test.ts
git commit -m "feat: integrate slide generation into report pipeline with fallback"
```

---

### Task 6: Add `--format` CLI option to report command

**Files:**
- Modify: `src/commands/report.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/slide-generator.test.ts`:

```typescript
import { buildCli } from "../src/cli";

describe("report CLI --format option", () => {
  it("registers --format option on report command", () => {
    const cli = buildCli();
    const reportCmd = cli.commands.find((c) => c.name() === "report");
    expect(reportCmd).toBeDefined();

    const formatOption = reportCmd!.options.find((o) => o.long === "--format");
    expect(formatOption).toBeDefined();
    expect(formatOption!.description).toContain("slide");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --pool=vmThreads tests/slide-generator.test.ts`
Expected: FAIL — no `--format` option registered

- [ ] **Step 3: Modify `src/commands/report.ts`**

Replace the entire file content:

```typescript
import { existsSync } from "node:fs";
import { Command } from "commander";
import { DEFAULT_CONFIG, normalizeConfig, type VibegpsConfig } from "../shared";
import { getGitState } from "../utils/git";
import { readJson } from "../utils/json";
import { getWorkspacePaths } from "../utils/workspace";
import { resolveBranchTrack } from "../services/branch";
import { ensureWorkspaceRecord, getInitCheckpoint, getLatestCheckpoint, openDatabase } from "../services/db";
import { touchGlobalProjectIndex } from "../services/global-index";
import { generateProjectDigest } from "../services/project-digest";
import { generateReport } from "../services/report";
import type { Report } from "../shared";

export function registerReportCommand(program: Command): void {
  program
    .command("report")
    .description("Generate a manual report for the current branch track")
    .option("--format <format>", "Report format: html, md, or slide", undefined)
    .action((options: { format?: string }) => {
      const root = process.cwd();
      const paths = getWorkspacePaths(root);
      if (!existsSync(paths.stateDbFile)) {
        console.log("VibeGPS is not initialized in this workspace.");
        return;
      }

      const validFormats = ["html", "md", "slide"];
      const formatOverride = options.format as Report["format"] | undefined;
      if (formatOverride && !validFormats.includes(formatOverride)) {
        console.log(`Invalid format: ${options.format}. Valid options: ${validFormats.join(", ")}`);
        return;
      }

      const config = existsSync(paths.configFile)
        ? normalizeConfig(readJson<VibegpsConfig>(paths.configFile))
        : normalizeConfig(DEFAULT_CONFIG);
      const db = openDatabase(paths.stateDbFile);
      const workspace = ensureWorkspaceRecord(db, root, root);
      touchGlobalProjectIndex(root, workspace.workspaceId);
      const branchTrack = resolveBranchTrack(db, workspace.workspaceId, getGitState(root));
      const initCheckpoint = getInitCheckpoint(db, branchTrack.branchTrackId);
      const latestCheckpoint = getLatestCheckpoint(db, branchTrack.branchTrackId);

      if (!initCheckpoint || !latestCheckpoint) {
        console.log("No checkpoint data found for the current branch.");
        db.close();
        return;
      }

      const report = generateReport(db, {
        workspaceId: workspace.workspaceId,
        workspaceRoot: root,
        branchTrack,
        currentCheckpoint: latestCheckpoint,
        initCheckpoint,
        config,
        reportsDir: paths.reportsDir,
        deltaPatchesDir: paths.deltaPatchesDir,
        trigger: "manual",
        formatOverride
      });

      generateProjectDigest(root, workspace.workspaceId, paths);
      console.log(`Report: ${report.path}`);
      db.close();
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --pool=vmThreads tests/slide-generator.test.ts`
Expected: PASS

- [ ] **Step 5: Run all existing tests**

Run: `npx vitest run --pool=vmThreads tests`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/commands/report.ts tests/slide-generator.test.ts
git commit -m "feat: add --format slide CLI option to report command"
```

---

### Task 7: Build and verify end-to-end

**Files:**
- None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run --pool=vmThreads tests`
Expected: All tests PASS

- [ ] **Step 2: Build the project**

Run: `npx tsc -p tsconfig.json`
Expected: No type errors

- [ ] **Step 3: Verify CLI help shows the new option**

Run: `node dist/bin.js report --help`
Expected: Output includes `--format <format>` with description mentioning `slide`

- [ ] **Step 4: Commit (if any build fix needed)**

```bash
git add -A
git commit -m "chore: fix any build issues from slide report integration"
```

Only commit if there were fixes needed. If build passed cleanly, skip this step.
