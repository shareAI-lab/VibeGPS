import { createServer } from 'node:http';

export interface HookEnvelope {
  event: 'SessionStart' | 'Stop' | 'UserPromptSubmit' | 'PostToolUse';
  payload: Record<string, unknown>;
}

export interface HookServer {
  port: number;
  close: () => Promise<void>;
}

export async function createHookServer(onEvent: (event: HookEnvelope) => Promise<void>): Promise<HookServer> {
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/hook') {
      res.statusCode = 404;
      res.end('not found');
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });

    req.on('end', async () => {
      try {
        const envelope = JSON.parse(body) as HookEnvelope;
        if (!envelope || !envelope.event || !envelope.payload) {
          res.statusCode = 400;
          res.end('invalid payload');
          return;
        }

        const normalizedEvent = envelope.event === 'AfterToolUse' ? 'PostToolUse' : envelope.event;
        envelope.event = normalizedEvent;
        await onEvent(envelope);

        res.statusCode = 200;
        res.end('ok');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.statusCode = 500;
        res.end(`error: ${message}`);
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      })
  };
}
