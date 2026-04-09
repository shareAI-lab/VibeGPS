# Changelog

## 0.1.5 - 2026-04-09

- 修复 Report 分析失败的根因：过滤 `__pycache__` 与 `.pyc` 二进制文件，避免 Diff 中混入 `\\0` 导致 CLI 参数报错。
- 调整分析器优先级：默认先调用 Claude/Codex CLI，自有 CLI 失败时才回退 Anthropic API（若已配置密钥）。
- 对分析失败日志做终端安全清洗，避免二进制/控制字符污染 Codex TUI 回显。

## 0.1.4 - 2026-04-09

- 修复 Codex hooks 注入键：`PostToolUse` 按原生配置写入，不再使用 `AfterToolUse`。
- 增加按 `session_id + turn_id` 的回合幂等去重，避免同一轮被 native Stop 与 fallback Stop 重复结算、重复生成报告。
- 报告落库增加 `trigger_turn` 并建立唯一索引，防止同一轮重复插入报告记录。
- Codex wrapper 默认使用 quiet 通知模式，减少运行期 stderr 输出，改善 TUI 回显干扰。
- 保持 Claude 路径行为不变，并补充对应回归测试与重复 Stop 去重测试。

## 0.1.3 - 2026-04-09

- Codex wrapper 优先启用原生 hooks：会话启动时临时写入 `<repo>/.codex/hooks.json`，会话结束后自动恢复原始文件。
- 增加 Codex 轮询兜底：若原生 hooks 未生效或仅收到非 Stop 事件，按“代码有变化 + 静默窗口”补齐单轮 Stop，确保阈值判定与 turn/diff 落盘。
- 会话报告支持双触发：达到阈值自动触发，或用户在 prompt 中明确提出 report/报告后于该轮结束触发。

## 0.1.2 - 2026-04-09

- 增加用户主动请求报告触发：当 `UserPromptSubmit` 携带“report/报告/生成报告”等指令时，在该轮 `Stop` 后强制生成报告。
- 保留原有阈值触发逻辑：会话收敛时仍按阈值判定自动报告，用户请求与阈值触发可并行兼容。
- 修正报告模板版本号为 `v0.1.2`，避免报告页脚显示旧版本。

## 0.1.1 - 2026-04-09

- 完成 VibeGPS MVP：wrapper 启动、hook 追踪、阈值或手动报告、HTML 可视化报告。
- 增加 LLM JSON 分析链路，并在失败时降级为静态报告。
- 增加会话落盘、临时文件清理和过期会话清理能力。
