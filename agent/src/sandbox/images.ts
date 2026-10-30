import path from 'node:path';
import { runProcess } from '../process.ts';

export const runnerImage = 'testeragent-runner:local';
export const agentImage = 'testeragent-agent:local';

async function buildImage(trustedRepositoryRoot: string, dockerfileName: string, tag: string) {
  const dockerDirectory = path.join(trustedRepositoryRoot, 'agent', 'docker');
  const result = await runProcess(
    'docker',
    ['build', '--quiet', '--file', path.join(dockerDirectory, dockerfileName), '--tag', tag, dockerDirectory],
    { timeoutMilliseconds: 600_000 },
  );
  if (result.exitCode !== 0) throw new Error(`Building ${tag} failed: ${result.stderr.trim()}`);
}

// The Dockerfiles decide what runs with network access, so they must come from the base checkout, never the PR head.
export async function buildImages(trustedRepositoryRoot: string) {
  await buildImage(trustedRepositoryRoot, 'runner.Dockerfile', runnerImage);
  await buildImage(trustedRepositoryRoot, 'agent.Dockerfile', agentImage);
}
