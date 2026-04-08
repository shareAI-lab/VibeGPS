# VibeGPS

VibeGPS 是一个面向 AI 编程会话的代码演化导航工具。

它通过 wrapper 启动 `claude` 或 `codex`，临时注入 Hook，持续记录每轮代码变更，并在阈值触发或手动触发时生成可视化报告。

## Quick Start

```bash
npm i -g vibegps
vibegps claude --resume
vibegps report
```

## Commands

- `vibegps claude [args]`：Wrapper 启动 Claude Code。
- `vibegps codex [args]`：Wrapper 启动 Codex CLI。
- `vibegps report [--session <id>]`：生成会话报告。

## Reliability Notes

- Hook 注入采用临时 settings 文件，进程退出后自动清理。
- LLM 分析失败时自动降级到静态报告。
- 会话数据默认保留，可按保留天数做过期清理。
