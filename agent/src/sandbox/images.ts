import path from 'node:path';
import { runProcess } from '../process.ts';

export const runnerImage = 'testeragent-runner:local';
export const agentImage = 'testeragent-agent:local';

async function buildImage(repositoryRoot: string, dockerfileName: string, tag: string) {
  const dockerDirectory = path.join(repositoryRoot, 'agent', 'docker');
  const result = await runProcess(
    'docker',
    ['build', '--quiet', '--file', path.join(dockerDirectory, dockerfileName), '--tag', tag, dockerDirectory],
    { timeoutMilliseconds: 600_000 },
  );
  if (result.exitCode !== 0) throw new Error(`Building ${tag} failed: ${result.stderr.trim()}`);
}

export async function buildImages(repositoryRoot: string) {
  await buildImage(repositoryRoot, 'runner.Dockerfile', runnerImage);
  await buildImage(repositoryRoot, 'agent.Dockerfile', agentImage);
}
