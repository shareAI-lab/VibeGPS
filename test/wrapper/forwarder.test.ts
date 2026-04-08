import { createServer } from 'node:http';
import { execa } from 'execa';
import { describe, expect, it } from 'vitest';

describe('forwarder', () => {
  it('posts stdin payload to hook server', async () => {
    const events: unknown[] = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        events.push(JSON.parse(body));
        res.statusCode = 200;
        res.end('ok');
      });
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    await execa('node', ['scripts/vibegps-forwarder.cjs', String(port), 'Stop'], {
      input: JSON.stringify({ session_id: 's1', cwd: '/tmp/project' })
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: 'Stop',
      payload: { session_id: 's1' }
    });

    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });
});
