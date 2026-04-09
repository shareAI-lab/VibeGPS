import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Report, VibegpsConfig, BranchTrack, Checkpoint, Delta } from "../src/shared";
import { DEFAULT_CONFIG, normalizeConfig } from "../src/shared";
import { buildSlidePrompt, generateSlideHtml, validateSlideHtml } from "../src/services/slide-generator";
import type { AnalyzerContext } from "../src/services/report-analyzer";
import { openDatabase, insertBranchTrack, insertCheckpoint, insertDelta } from "../src/services/db";
import { generateReport } from "../src/services/report";
import { buildCli } from "../src/cli";

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

function withFakeCodex(scriptBody: string, run: () => void): void {
  const binDir = mkdtempSync(join(tmpdir(), "vibegps-fake-codex-"));
  const codexPath = join(binDir, "codex");
  const originalPath = process.env.PATH ?? "";

  try {
    writeFileSync(codexPath, scriptBody, "utf8");
    chmodSync(codexPath, 0o755);
    process.env.PATH = `${binDir}:${originalPath}`;
    run();
  } finally {
    process.env.PATH = originalPath;
    rmSync(binDir, { recursive: true, force: true });
  }
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

describe("generateSlideHtml", () => {
  it("returns HTML when codex writes a valid slide file", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "vibegps-slide-workspace-"));

    try {
      withFakeCodex(
        `#!/bin/sh
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    out="$2"
    shift 2
    continue
  fi
  shift
done
cat >/dev/null
printf '%s' '<!DOCTYPE html><html><body><section>ok</section></body></html>' > "$out"
`,
        () => {
          const html = generateSlideHtml(makeTestContext({ workspaceRoot }), {
            workspaceRoot,
            maxSlides: 8,
            minSlides: 3
          });
          expect(html).toContain("<!DOCTYPE html>");
          expect(html).toContain("<section>ok</section>");
        }
      );
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("returns null when codex exits successfully but output is invalid", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "vibegps-slide-workspace-"));

    try {
      withFakeCodex(
        `#!/bin/sh
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    out="$2"
    shift 2
    continue
  fi
  shift
done
cat >/dev/null
printf '%s' 'not html' > "$out"
`,
        () => {
          const html = generateSlideHtml(makeTestContext({ workspaceRoot }), {
            workspaceRoot,
            maxSlides: 8,
            minSlides: 3
          });
          expect(html).toBeNull();
        }
      );
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("returns null when codex exits with failure status", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "vibegps-slide-workspace-"));

    try {
      withFakeCodex(
        `#!/bin/sh
cat >/dev/null
exit 2
`,
        () => {
          const html = generateSlideHtml(makeTestContext({ workspaceRoot }), {
            workspaceRoot,
            maxSlides: 8,
            minSlides: 3
          });
          expect(html).toBeNull();
        }
      );
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

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

      // Use a fake codex that fails immediately so generateSlideHtml returns null fast
      withFakeCodex(
        `#!/bin/sh
cat >/dev/null
exit 1
`,
        () => {
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

          // Since codex fails, should fall back to html
          expect(report.reportId).toBeTruthy();
          expect(existsSync(report.path)).toBe(true);
          // Format should be html (fallback) since codex isn't available
          expect(report.format).toBe("html");
        }
      );
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("report CLI --format option", () => {
  it("registers --format option on report command", () => {
    const cli = buildCli();
    const reportCmd = cli.commands.find((c) => c.name() === "report");
    expect(reportCmd).toBeDefined();

    const formatOption = reportCmd!.options.find((o) => o.long === "--format");
    expect(formatOption).toBeDefined();
  });
});
