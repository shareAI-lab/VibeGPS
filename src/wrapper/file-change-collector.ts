export interface FileOperation {
  tool: 'Write' | 'Edit' | 'MultiEdit';
  filePath: string;
  timestamp: number;
  oldString?: string;
  newString?: string;
  content?: string;
}

export function createFileChangeCollector() {
  const operations = new Map<string, FileOperation[]>();

  function recordOperation(sessionId: string, op: FileOperation): void {
    const existing = operations.get(sessionId) ?? [];
    existing.push(op);
    operations.set(sessionId, existing);
  }

  function drainOperations(sessionId: string): FileOperation[] {
    const ops = operations.get(sessionId) ?? [];
    operations.delete(sessionId);
    return ops;
  }

  return { recordOperation, drainOperations };
}
