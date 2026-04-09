export interface AnalyzerResult {
  summary: string;
  intent: string;
  risks: string[];
  highlights: string[];
  intentMatch?: 'full' | 'partial' | 'deviated';
}

function tryParse(raw: string): AnalyzerResult | null {
  try {
    return JSON.parse(raw) as AnalyzerResult;
  } catch {
    return null;
  }
}

export function parseLLMResult(raw: string): AnalyzerResult | null {
  const direct = tryParse(raw);
  if (direct) {
    return direct;
  }

  const fenced = raw.match(/```(?:json)?\n?([\s\S]*?)```/i)?.[1];
  if (fenced) {
    const parsed = tryParse(fenced.trim());
    if (parsed) {
      return parsed;
    }
  }

  const objectBlock = raw.match(/\{[\s\S]*\}/)?.[0];
  if (objectBlock) {
    return tryParse(objectBlock);
  }

  return null;
}
