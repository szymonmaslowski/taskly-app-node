import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const proxyScript = fileURLToPath(new URL('../docker/egress-proxy.mjs', import.meta.url));
const processes: ChildProcess[] = [];
const servers: net.Server[] = [];

afterEach(() => {
  for (const child of processes.splice(0)) child.kill();
  for (const server of servers.splice(0)) server.close();
});

function listen(server: net.Server) {
  servers.push(server);
  return new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    });
  });
}

async function freePort() {
  const server = net.createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  servers.splice(servers.indexOf(server), 1);
  return port;
}

async function startProxy(allowedTargets: string[]) {
  const port = await freePort();
  const child = spawn(process.execPath, [proxyScript], {
    env: { ...process.env, EGRESS_PROXY_PORT: String(port), EGRESS_ALLOWED_TARGETS: allowedTargets.join(',') },
  });
  processes.push(child);
  await new Promise<void>((resolve) => child.stdout?.on('data', (data: Buffer) => data.toString().includes('listening') && resolve()));
  return port;
}

function connectThrough(proxyPort: number, target: string) {
  return new Promise<string>((resolve) => {
    const socket = net.connect(proxyPort, '127.0.0.1', () => socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
    let received = '';
    socket.on('data', (data) => {
      received += data.toString();
      if (received.includes('\r\n\r\n') && !received.startsWith('HTTP/1.1 200')) resolve(received.split('\r\n')[0]);
      if (received.includes('upstream says hi')) {
        resolve(`${received.split('\r\n')[0]} / upstream says hi`);
        socket.destroy();
      }
    });
    socket.on('end', () => resolve(received.split('\r\n')[0]));
  });
}

describe('egress proxy', () => {
  it('opens a tunnel to an allowed target', async () => {
    const upstreamPort = await listen(net.createServer((socket) => socket.end('upstream says hi')));
    const proxyPort = await startProxy([`127.0.0.1:${upstreamPort}`]);
    expect(await connectThrough(proxyPort, `127.0.0.1:${upstreamPort}`)).toBe('HTTP/1.1 200 Connection Established / upstream says hi');
  });

  it('refuses any other target, even on the same host', async () => {
    const upstreamPort = await listen(net.createServer((socket) => socket.end('upstream says hi')));
    const proxyPort = await startProxy(['127.0.0.1:1']);
    expect(await connectThrough(proxyPort, `127.0.0.1:${upstreamPort}`)).toBe('HTTP/1.1 403 Forbidden');
  });
});
