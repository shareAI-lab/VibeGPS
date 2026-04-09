<div align="center">

# VibeGPS

**GPS for Vibe Coders**

Track, analyze, and visualize every code change your AI agent makes — automatically.

[![npm version](https://img.shields.io/npm/v/vibegps?color=blue)](https://www.npmjs.com/package/vibegps)
[![Node.js >=18](https://img.shields.io/node/v/vibegps)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-69%20passing-brightgreen)](test/)

</div>

---

VibeGPS wraps your AI coding agent (Claude Code / Codex CLI) and silently records every turn: what the user asked, what files changed, what the AI did. When changes exceed a threshold — or you simply ask for a report — it generates a rich HTML report with AI-powered analysis, intent matching, and interactive diff exploration.

```
You: "Build a Flask REST API with User, Post, Comment models"
  ↓  VibeGPS records your intent + all file changes
AI:  Creates 731 lines across 10 files
  ↓  Threshold exceeded → auto-triggers report
VibeGPS:  Generates HTML report with AI analysis
  ✅ Intent Match: FULL
  ⚠️  Risk: JWT secret hardcoded
  ✨ Highlight: Clean model design with FK cascades
```

## Features

- **Zero-config wrapping** — `vibegps claude` or `vibegps codex`, works out of the box
- **Dual-agent support** — Claude Code and Codex CLI, with native hooks + polling fallback
- **Patch-based checkpoints** — Every turn saved as a standard `.patch` file (unified diff)
- **User intent tracking** — Stores your prompt alongside code changes for intent analysis
- **AI-powered analysis** — Claude API → Claude CLI → Codex CLI ordered fallback chain
- **Intent matching** — Did the AI actually do what you asked? (full / partial / deviated)
- **Interactive HTML reports** — Trend charts, file heatmap, turn timeline, expandable diffs
- **Auto-report trigger** — Exceeds line threshold → generates report automatically
- **Keyword trigger** — Type "report" / "出报告" / "总结一下" in your prompt
- **Turn deduplication** — Idempotent `session + turn` key prevents double-counting
- **Missing hook recovery** — Auto-detects and patches missing Stop events

## Install

```bash
npm install -g vibegps
```

Requires Node.js 18+ and Git.

## Usage

### Wrap Claude Code

```bash
# Start Claude Code with VibeGPS tracking
vibegps claude

# Pass any Claude CLI arguments
vibegps claude --resume
vibegps claude -p "Create a Flask REST API"
```

### Wrap Codex CLI

```bash
# Interactive mode (with native hooks)
vibegps codex --full-auto

# Non-interactive mode
vibegps codex exec --sandbox danger-full-access "Your prompt"
```

### Generate Reports

```bash
# Auto-generated when changes exceed threshold (default: 200 lines)
# Or trigger by typing "report" in your prompt

# Manual report for latest session
vibegps report

# Report for a specific session
vibegps report --session <session-id>
```

## How It Works

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  vibegps     │     │  Hook Server  │     │   Runtime    │
│  claude/codex │────▶│  localhost    │────▶│   Handler    │
└──────────────┘     └──────────────┘     └──────┬───────┘
       │                                         │
  Injects hooks via                          ┌────▼─────┐
  settings.json / .codex/hooks.json          │ Tracker  │
                                              └────┬─────┘
                                                   │
                          ┌────────────────────────┼────────────┐
                          ▼                        ▼            ▼
                    ┌──────────┐           ┌───────────┐  ┌─────────┐
                    │ SQLite DB│           │ .patch    │  │ Report  │
                    │ sessions │           │ per turn  │  │ HTML    │
                    │ turns    │           │ unified   │  │ + AI    │
                    │ changes  │           │ diff      │  │ analysis│
                    └──────────┘           └───────────┘  └─────────┘
```

**Hook injection** — VibeGPS creates a temporary settings file (Claude) or modifies `.codex/hooks.json` (Codex), injecting a forwarder script that POSTs events to a local HTTP server.

**Event flow** — `SessionStart` → `UserPromptSubmit` (captures intent) → `PostToolUse` (captures file ops) → `Stop` (computes delta, writes patch, triggers report).

## Configuration

Create `~/.vibegps/config.json`:

```json
{
  "report": {
    "threshold": 200,
    "minTurnsBetween": 3,
    "autoOpen": true
  },
  "analyzer": {
    "prefer": "claude",
    "timeout": 30000,
    "enabled": true,
    "apiKey": "sk-ant-...",
    "model": "claude-sonnet-4-20250514"
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `report.threshold` | `200` | Lines changed to auto-trigger report |
| `report.minTurnsBetween` | `3` | Minimum turns between auto-reports |
| `report.autoOpen` | `true` | Open HTML report in browser |
| `analyzer.prefer` | `"claude"` | Primary analyzer: `"claude"` or `"codex"` |
| `analyzer.apiKey` | env `ANTHROPIC_API_KEY` | API key for direct Anthropic API calls |
| `analyzer.enabled` | `true` | Enable AI analysis (falls back to static report) |

## Report Preview

Reports include:

- **Overview** — Total lines added/removed, files changed, turn count
- **AI Analysis** — Summary, intent, risks, highlights, intent match badge
- **Turn Trend Chart** — Visual bar chart of changes per turn
- **File Heatmap** — Most-changed files with change frequency bars
- **Turn Timeline** — User prompt, AI response, commit detection, expandable diffs
- **Diff Details** — Per-turn unified diff with syntax highlighting

## Data Storage

```
~/.vibegps/
├── vibegps.db              # SQLite database (WAL mode)
├── config.json             # User configuration
├── patches/                # Per-turn git diffs
│   └── {session-id}/
│       ├── turn-001.patch
│       └── turn-002.patch
└── reports/                # Generated HTML reports
    └── {session-id}/
        └── report-{timestamp}.html
```

## Architecture

| Layer | Files | Responsibility |
|-------|-------|---------------|
| **CLI** | `src/cli/` | Command routing (`claude`, `codex`, `report`) |
| **Wrapper** | `src/wrapper/` | Runtime, launcher, hook server, session tracker |
| **Store** | `src/store/` | SQLite schema, queries, migrations |
| **Analyzer** | `src/analyzer/` | LLM analysis with multi-fallback chain |
| **Reporter** | `src/reporter/` | Orchestration, HTML template, terminal output |
| **Utils** | `src/utils/` | Git snapshot, process management, browser open |

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests (69 tests)
npm test

# Type check
npm run lint

# Development mode
npm run dev claude
```

## License

[MIT](LICENSE) © Bill Billion
