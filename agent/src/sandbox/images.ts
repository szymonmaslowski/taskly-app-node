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

const images = {
  runner: { dockerfileName: 'runner.Dockerfile', tag: runnerImage },
  agent: { dockerfileName: 'agent.Dockerfile', tag: agentImage },
};

// The Dockerfiles decide what runs with network access, so they must come from the base checkout, never the PR head.
// The workflow builds the same Dockerfiles with the Actions layer cache and loads them under these tags, so it skips this step.
export async function buildImages(trustedRepositoryRoot: string, names: (keyof typeof images)[] = ['runner', 'agent']) {
  if (process.env.TESTERAGENT_IMAGES_PREBUILT === 'true') return;
  for (const name of names) await buildImage(trustedRepositoryRoot, images[name].dockerfileName, images[name].tag);
}
