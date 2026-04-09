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

  it('returns null when no API key available', async () => {
    const apiCall = vi.fn();
    const originalEnv = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const raw = await runAnalyzer(
      { prefer: 'claude', timeout: 30000, enabled: true },
      { stat: '+100 -20', files: ['src/a.ts'], lastAssistantMessage: 'done', diff: 'diff text' },
      apiCall
    );

    expect(raw).toBeNull();
    expect(apiCall).not.toHaveBeenCalled();

    if (originalEnv) process.env.ANTHROPIC_API_KEY = originalEnv;
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

  it('uses codexCall when prefer is codex', async () => {
    const apiCall = vi.fn().mockResolvedValue('{"summary":"ok"}');
    const codexCall = vi.fn().mockResolvedValue('{"summary":"codex分析"}');

    const raw = await runAnalyzer(
      { prefer: 'codex', timeout: 30000, enabled: true, apiKey: 'sk-test' },
      { stat: '+1', files: [], lastAssistantMessage: '', diff: '' },
      apiCall,
      codexCall
    );

    expect(codexCall).toHaveBeenCalledWith(expect.any(String), 30000);
    expect(apiCall).not.toHaveBeenCalled();
    expect(raw).toContain('codex分析');
  });

  it('returns null and logs error when codexCall fails', async () => {
    const apiCall = vi.fn().mockResolvedValue('{"summary":"ok"}');
    const codexCall = vi.fn().mockRejectedValue(new Error('codex not found'));
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const raw = await runAnalyzer(
      { prefer: 'codex', timeout: 30000, enabled: true, apiKey: 'sk-test' },
      { stat: '+1', files: [], lastAssistantMessage: '', diff: '' },
      apiCall,
      codexCall
    );

    expect(raw).toBeNull();
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Codex 分析失败'));
    stderrSpy.mockRestore();
  });

  it('uses Anthropic API when prefer is claude', async () => {
    const apiCall = vi.fn().mockResolvedValue('{"summary":"claude分析"}');
    const codexCall = vi.fn().mockResolvedValue('{"summary":"codex分析"}');

    const raw = await runAnalyzer(
      { prefer: 'claude', timeout: 30000, enabled: true, apiKey: 'sk-test' },
      { stat: '+1', files: [], lastAssistantMessage: '', diff: '' },
      apiCall,
      codexCall
    );

    expect(apiCall).toHaveBeenCalled();
    expect(codexCall).not.toHaveBeenCalled();
    expect(raw).toContain('claude分析');
  });
});
