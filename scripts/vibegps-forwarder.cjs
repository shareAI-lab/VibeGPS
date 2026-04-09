#!/usr/bin/env node
const http = require('node:http');

async function readStdin() {
  let data = '';
  for await (const chunk of process.stdin) {
    data += chunk;
  }
  return data || '{}';
}

async function main() {
  const port = Number(process.argv[2]);
  const event = process.argv[3];

  if (!port || !event) {
    console.error('[vibegps-forwarder] missing port or event');
    process.exit(1);
  }

  let payload;
  try {
    payload = JSON.parse(await readStdin());
  } catch {
    payload = {};
  }

  const body = JSON.stringify({ event, payload });

  const responseBody = await new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/hook',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body)
        }
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk.toString();
        });
        res.resume();
        res.on('end', () => resolve(raw));
      }
    );

    req.on('error', reject);
    req.write(body);
    req.end();
  });

  // Codex Stop hook 仅接受 JSON 输出；通过 systemMessage 在对话流内安全回显。
  if (event === 'Stop') {
    let systemMessage = null;
    try {
      const parsed = JSON.parse(responseBody || '{}');
      if (parsed && typeof parsed.systemMessage === 'string' && parsed.systemMessage.trim()) {
        systemMessage = parsed.systemMessage.trim();
      }
    } catch {
      // ignore malformed body
    }

    if (systemMessage) {
      process.stdout.write(
        JSON.stringify({
          continue: true,
          systemMessage
        })
      );
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[vibegps-forwarder] ${message}`);
  process.exit(1);
});
