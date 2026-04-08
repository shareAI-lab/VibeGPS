import { describe, expect, it } from 'vitest';
import { request } from 'undici';
import { createHookServer } from '../../src/wrapper/hook-server.js';

describe('hook server', () => {
  it('accepts hook event and routes to callback', async () => {
    const calls: unknown[] = [];
    const server = await createHookServer(async (event) => {
      calls.push(event);
    });

    await request(`http://127.0.0.1:${server.port}/hook`, {
      method: 'POST',
      body: JSON.stringify({
        event: 'Stop',
        payload: { session_id: 's1', cwd: '/tmp' }
      }),
      headers: {
        'content-type': 'application/json'
      }
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ event: 'Stop' });

    await server.close();
  });
});
