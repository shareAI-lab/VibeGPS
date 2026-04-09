import { describe, expect, it, vi } from 'vitest';
import { runAnalyzer } from '../../src/analyzer/agent-runner.js';

describe('agent runner', () => {
  it('calls Anthropic API with correct parameters', async () => {
    const apiCall = vi.fn().mockResolvedValue(
      '{"summary":"重构认证","intent":"职责分离","risks":[],"highlights":[]}'
    );

    const raw = await runAnalyzer(
      { prefer: 'claude', timeout: 30000, enabled: true, apiKey: 'sk-test-123' },
      {
        stat: '+100 -20',
        files: ['src/a.ts (+20-5)'],
        lastAssistantMessage: 'done',
        diff: 'diff text'
      },
      apiCall
    );

    expect(apiCall).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-test-123',
        model: 'claude-sonnet-4-20250514',
        timeout: 30000
      })
    );
    expect(apiCall.mock.calls[0][0].prompt).toContain('分析以下代码变更');
    expect(raw).toContain('summary');
  });

  it('returns null when analyzer disabled', async () => {
    const apiCall = vi.fn();
    const raw = await runAnalyzer(
      { prefer: 'claude', timeout: 30000, enabled: false, apiKey: 'sk-test' },
      { stat: '+100 -20', files: ['src/a.ts'], lastAssistantMessage: 'done', diff: 'diff text' },
      apiCall
    );

    expect(raw).toBeNull();
    expect(apiCall).not.toHaveBeenCalled();
  });

  it('falls back to Claude CLI when no API key available', async () => {
    const apiCall = vi.fn();
    const claudeCliCall = vi.fn().mockResolvedValue('{"summary":"cli分析"}');
    const codexCall = vi.fn();
    const originalEnv = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const raw = await runAnalyzer(
      { prefer: 'claude', timeout: 30000, enabled: true },
      { stat: '+100 -20', files: ['src/a.ts'], lastAssistantMessage: 'done', diff: 'diff text' },
      apiCall,
      claudeCliCall,
      codexCall
    );

    expect(apiCall).not.toHaveBeenCalled();
    expect(claudeCliCall).toHaveBeenCalledWith(expect.any(String), 30000);
    expect(codexCall).not.toHaveBeenCalled();
    expect(raw).toContain('cli分析');

    if (originalEnv) process.env.ANTHROPIC_API_KEY = originalEnv;
  });

  it('falls back to codex when Claude CLI also fails', async () => {
    const apiCall = vi.fn();
    const claudeCliCall = vi.fn().mockRejectedValue(new Error('claude not found'));
    const codexCall = vi.fn().mockResolvedValue('{"summary":"codex兜底"}');
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const originalEnv = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const raw = await runAnalyzer(
      { prefer: 'claude', timeout: 30000, enabled: true },
      { stat: '+1', files: [], lastAssistantMessage: '', diff: '' },
      apiCall,
      claudeCliCall,
      codexCall
    );

    expect(claudeCliCall).toHaveBeenCalled();
    expect(codexCall).toHaveBeenCalled();
    expect(raw).toContain('codex兜底');

    stderrSpy.mockRestore();
    if (originalEnv) process.env.ANTHROPIC_API_KEY = originalEnv;
  });

  it('returns null when all analyzers fail', async () => {
    const apiCall = vi.fn().mockRejectedValue(new Error('API error'));
    const claudeCliCall = vi.fn().mockRejectedValue(new Error('CLI error'));
    const codexCall = vi.fn().mockRejectedValue(new Error('codex error'));
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const raw = await runAnalyzer(
      { prefer: 'claude', timeout: 30000, enabled: true, apiKey: 'sk-test' },
      { stat: '+1', files: [], lastAssistantMessage: '', diff: '' },
      apiCall,
      claudeCliCall,
      codexCall
    );

    expect(raw).toBeNull();
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Claude 分析失败'));
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Codex 分析失败'));
    stderrSpy.mockRestore();
  });

  it('uses ANTHROPIC_API_KEY env var when config has no apiKey', async () => {
    const apiCall = vi.fn().mockResolvedValue('{"summary":"ok"}');
    const originalEnv = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-env-key';

    await runAnalyzer(
      { prefer: 'claude', timeout: 30000, enabled: true },
      { stat: '+1', files: [], lastAssistantMessage: '', diff: '' },
      apiCall
    );

    expect(apiCall).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'sk-env-key' })
    );

    if (originalEnv) process.env.ANTHROPIC_API_KEY = originalEnv;
    else delete process.env.ANTHROPIC_API_KEY;
  });

  it('uses configured model when specified', async () => {
    const apiCall = vi.fn().mockResolvedValue('{"summary":"ok"}');
    await runAnalyzer(
      { prefer: 'claude', timeout: 30000, enabled: true, apiKey: 'sk-test', model: 'claude-haiku-4-20250414' },
      { stat: '+1', files: [], lastAssistantMessage: '', diff: '' },
      apiCall
    );

    expect(apiCall).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-haiku-4-20250414' })
    );
  });

  it('uses codexCall first when prefer is codex', async () => {
    const apiCall = vi.fn().mockResolvedValue('{"summary":"ok"}');
    const claudeCliCall = vi.fn().mockResolvedValue('{"summary":"cli"}');
    const codexCall = vi.fn().mockResolvedValue('{"summary":"codex分析"}');

    const raw = await runAnalyzer(
      { prefer: 'codex', timeout: 30000, enabled: true, apiKey: 'sk-test' },
      { stat: '+1', files: [], lastAssistantMessage: '', diff: '' },
      apiCall,
      claudeCliCall,
      codexCall
    );

    expect(codexCall).toHaveBeenCalledWith(expect.any(String), 30000);
    expect(apiCall).not.toHaveBeenCalled();
    expect(claudeCliCall).not.toHaveBeenCalled();
    expect(raw).toContain('codex分析');
  });

  it('falls back to Claude when codex fails with prefer=codex', async () => {
    const apiCall = vi.fn().mockResolvedValue('{"summary":"claude兜底"}');
    const claudeCliCall = vi.fn();
    const codexCall = vi.fn().mockRejectedValue(new Error('codex not found'));
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const raw = await runAnalyzer(
      { prefer: 'codex', timeout: 30000, enabled: true, apiKey: 'sk-test' },
      { stat: '+1', files: [], lastAssistantMessage: '', diff: '' },
      apiCall,
      claudeCliCall,
      codexCall
    );

    expect(codexCall).toHaveBeenCalled();
    expect(apiCall).toHaveBeenCalled();
    expect(raw).toContain('claude兜底');

    stderrSpy.mockRestore();
  });
});
