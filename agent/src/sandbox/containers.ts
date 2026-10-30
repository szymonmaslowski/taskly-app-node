import { randomUUID } from 'node:crypto';
import { runProcess, type RunProcessOptions } from '../process.ts';

const hardeningArgs = [
  '--cap-drop',
  'ALL',
  '--security-opt',
  'no-new-privileges',
  '--pids-limit',
  '512',
  '--memory',
  '4g',
  '--cpus',
  '2',
  '--pull',
  'never',
];

export function createContainerName(role: string) {
  return `testeragent-${role}-${randomUUID()}`;
}

export function createContainerArgs(name: string, runArgs: string[]) {
  return ['run', '--rm', '--name', name, ...hardeningArgs, ...runArgs];
}

export async function runContainer(name: string, runArgs: string[], options: RunProcessOptions) {
  const result = await runProcess('docker', createContainerArgs(name, runArgs), options);
  // Killing the docker client on timeout leaves the container running, so it is stopped by name.
  if (result.timedOut) await runProcess('docker', ['kill', name], { timeoutMilliseconds: 30_000 });
  return result;
}
