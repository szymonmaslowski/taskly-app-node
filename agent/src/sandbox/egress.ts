import { randomUUID } from 'node:crypto';
import { userInfo } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { runProcess } from '../process.ts';
import { createContainerArgs, createContainerName } from './containers.ts';
import { agentImage } from './images.ts';

const proxyAlias = 'egress-proxy';
const proxyPort = 3128;
const proxyScriptPath = '/proxy/egress-proxy.mjs';
export const allowedEgressTargets = ['api.anthropic.com:443'];

export type EgressRoute = {
  network: string;
  proxyUrl: string;
};

async function docker(args: string[]) {
  const result = await runProcess('docker', args, { timeoutMilliseconds: 60_000 });
  if (result.exitCode !== 0) throw new Error(`docker ${args[0]} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

export function createProxyArgs(trustedRepositoryRoot: string, name: string) {
  const { uid, gid } = userInfo();
  return createContainerArgs(name, [
    '--detach',
    '--user',
    `${uid}:${gid}`,
    '--env',
    `EGRESS_ALLOWED_TARGETS=${allowedEgressTargets.join(',')}`,
    '--env',
    `EGRESS_PROXY_PORT=${proxyPort}`,
    '--volume',
    `${path.join(trustedRepositoryRoot, 'agent', 'docker', 'egress-proxy.mjs')}:${proxyScriptPath}:ro`,
    '--entrypoint',
    'node',
    agentImage,
    proxyScriptPath,
  ]);
}

async function waitUntilListening(name: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if ((await docker(['logs', name])).includes('listening')) return;
    await sleep(200);
  }
  throw new Error('The egress proxy did not start');
}

// Agent containers join an internal network with no route out. The proxy sits on that network and the default bridge,
// so the token can only travel to the hosts it allows. The proxy runs the agent image, which already has Node.
export async function startEgressProxy(trustedRepositoryRoot: string) {
  const network = `testeragent-egress-${randomUUID()}`;
  const name = createContainerName('egress-proxy');
  const stop = async () => {
    const logs = await docker(['logs', name]).catch(() => '');
    await runProcess('docker', ['rm', '--force', name], { timeoutMilliseconds: 60_000 });
    await runProcess('docker', ['network', 'rm', network], { timeoutMilliseconds: 60_000 });
    return logs.split('\n').filter((line) => line.startsWith('denied '));
  };
  try {
    await docker(['network', 'create', '--internal', network]);
    await docker(createProxyArgs(trustedRepositoryRoot, name));
    await docker(['network', 'connect', '--alias', proxyAlias, network, name]);
    await waitUntilListening(name);
  } catch (error) {
    await stop();
    throw error;
  }
  const route: EgressRoute = { network, proxyUrl: `http://${proxyAlias}:${proxyPort}` };
  return { route, stop };
}
