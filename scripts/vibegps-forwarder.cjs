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

  await new Promise((resolve, reject) => {
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
        res.resume();
        res.on('end', resolve);
      }
    );

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[vibegps-forwarder] ${message}`);
  process.exit(1);
});
