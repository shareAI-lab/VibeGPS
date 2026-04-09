import { describe, expect, it } from "vitest";
import type { Report, VibegpsConfig } from "../src/shared";
import { DEFAULT_CONFIG, normalizeConfig } from "../src/shared";

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
