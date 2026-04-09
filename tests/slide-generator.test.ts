import { describe, expect, it } from "vitest";
import type { Report, VibegpsConfig } from "../src/shared";
import { DEFAULT_CONFIG, normalizeConfig } from "../src/shared";
import { buildSlidePrompt, validateSlideHtml } from "../src/services/slide-generator";
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
