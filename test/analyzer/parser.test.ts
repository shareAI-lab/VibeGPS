import { describe, expect, it } from 'vitest';
import { parseLLMResult } from '../../src/analyzer/parser.js';

describe('llm parser', () => {
  it('parses direct json', () => {
    const parsed = parseLLMResult('{"summary":"s","intent":"i","risks":[],"highlights":[]}');
    expect(parsed?.summary).toBe('s');
  });

  it('parses fenced json', () => {
    const parsed = parseLLMResult('```json\n{"summary":"s2","intent":"i2","risks":[],"highlights":[]}\n```');
    expect(parsed?.intent).toBe('i2');
  });

  it('parses embedded object by fallback', () => {
    const parsed = parseLLMResult('text before {"summary":"s3","intent":"i3","risks":[],"highlights":[]} text');
    expect(parsed?.summary).toBe('s3');
  });

  it('returns null for invalid payload', () => {
    expect(parseLLMResult('not json')).toBeNull();
  });
});
