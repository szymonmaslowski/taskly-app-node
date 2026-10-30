import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { WorkspaceConfig } from '../config.ts';
import { createContainerName, runContainer } from './containers.ts';
import { resetDirectory } from './directories.ts';
import { assertRegularFile, copyRegularFiles, readJsonFile } from './files.ts';
import { runnerImage } from './images.ts';
import { parseVitestJsonReport } from './test-results.ts';

const vitestConfigCandidates = ['vitest.config.ts', 'vitest.config.mts', 'vite.config.ts', 'vite.config.mts'];
const wrapperMountPath = '/workspace/.testeragent';
const wrapperFileName = 'vitest.agent.ts';
const testResultsFileName = 'test-results.json';
export const coverageFileName = 'coverage-final.json';
const maxResultBytes = 20_000_000;

type ReadOnlyMount = {
  source: string;
  target: string;
};

type RunnerCommand = {
  workspaceDirectory: string;
  outputDirectory: string;
  readOnlyMounts?: ReadOnlyMount[];
  command: string;
  args?: string[];
  network: boolean;
  timeoutMilliseconds: number;
};

export function createRunnerArgs({ workspaceDirectory, outputDirectory, readOnlyMounts = [], command, args = [], network }: RunnerCommand) {
  const { uid, gid } = userInfo();
  return [
    '--user',
    `${uid}:${gid}`,
    '--network',
    network ? 'bridge' : 'none',
    '--env',
    'HOME=/tmp',
    '--volume',
    `${workspaceDirectory}:/workspace`,
    '--volume',
    `${outputDirectory}:/output`,
    ...readOnlyMounts.flatMap(({ source, target }) => ['--volume', `${source}:${target}:ro`]),
    '--workdir',
    '/workspace',
    runnerImage,
    'sh',
    '-c',
    `${command} "$@"`,
    'sh',
    ...args,
  ];
}

export function runInRunner(command: RunnerCommand) {
  return runContainer(createContainerName('runner'), createRunnerArgs(command), { timeoutMilliseconds: command.timeoutMilliseconds });
}

type PrepareRunnerWorkspaceOptions = {
  repositoryRoot: string;
  trackedFiles: string[];
  workspace: WorkspaceConfig;
  destination: string;
};

export async function prepareRunnerWorkspace({ repositoryRoot, trackedFiles, workspace, destination }: PrepareRunnerWorkspaceOptions) {
  const prefix = `${workspace.root}/`;
  const workspaceFiles = trackedFiles
    .filter((relativePath) => relativePath.startsWith(prefix))
    .map((relativePath) => relativePath.slice(prefix.length));
  await mkdir(destination, { recursive: true });
  await copyRegularFiles(path.join(repositoryRoot, workspace.root), destination, workspaceFiles);
}

export async function installRunnerWorkspace(workspaceDirectory: string, outputDirectory: string, workspace: WorkspaceConfig) {
  for (const command of workspace.commands.install) {
    const result = await runInRunner({ workspaceDirectory, outputDirectory, command, network: true, timeoutMilliseconds: 600_000 });
    if (result.exitCode !== 0) throw new Error(`"${command}" failed in the runner: ${result.stderr.trim()}`);
  }
}

export async function runTypecheck(workspaceDirectory: string, outputDirectory: string, workspace: WorkspaceConfig) {
  const result = await runInRunner({
    workspaceDirectory,
    outputDirectory,
    command: workspace.commands.typecheck,
    network: false,
    timeoutMilliseconds: 300_000,
  });
  return { passed: result.exitCode === 0, output: `${result.stdout}${result.stderr}`.trim() };
}

async function findVitestConfig(workspaceDirectory: string) {
  for (const candidate of vitestConfigCandidates) {
    try {
      await assertRegularFile(path.join(workspaceDirectory, candidate), candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error(`No Vitest config found in ${workspaceDirectory}`);
}

export function createVitestWrapperConfig(workspaceConfigFile: string) {
  return `import workspaceConfig from '/workspace/${workspaceConfigFile}';

if (Object.getPrototypeOf(workspaceConfig) !== Object.prototype) {
  throw new Error('${workspaceConfigFile} must export a plain config object, not a function or a promise.');
}

const testConfig = workspaceConfig.test ?? {};

export default {
  ...workspaceConfig,
  test: {
    ...testConfig,
    reporters: ['json'],
    outputFile: '/output/${testResultsFileName}',
    coverage: {
      ...testConfig.coverage,
      thresholds: undefined,
      reporter: ['json'],
      reportsDirectory: '/output',
      reportOnFailure: true,
      clean: false,
    },
  },
};
`;
}

type RunTestsOptions = {
  workspaceDirectory: string;
  outputDirectory: string;
  workspace: WorkspaceConfig;
  testFiles?: string[];
  coverage?: boolean;
};

// The wrapper lives in its own host directory, mounted read-only, so the host never writes into the tree PR code has run in.
async function writeWrapperDirectory(workspaceConfigFile: string) {
  const wrapperDirectory = await mkdtemp(path.join(tmpdir(), 'testeragent-wrapper-'));
  await writeFile(path.join(wrapperDirectory, wrapperFileName), createVitestWrapperConfig(workspaceConfigFile));
  return wrapperDirectory;
}

export async function runTests({ workspaceDirectory, outputDirectory, workspace, testFiles = [], coverage = false }: RunTestsOptions) {
  const workspaceConfigFile = await findVitestConfig(workspaceDirectory);
  const wrapperDirectory = await writeWrapperDirectory(workspaceConfigFile);
  await resetDirectory(outputDirectory);

  const coverageFlag = coverage ? ' --coverage.enabled=true' : '';
  const result = await runInRunner({
    workspaceDirectory,
    outputDirectory,
    readOnlyMounts: [{ source: wrapperDirectory, target: wrapperMountPath }],
    command: `${workspace.commands.test} --config ${wrapperMountPath}/${wrapperFileName}${coverageFlag}`,
    args: testFiles,
    network: false,
    timeoutMilliseconds: 600_000,
  }).finally(() => rm(wrapperDirectory, { recursive: true, force: true }));
  const report = await readJsonFile(path.join(outputDirectory, testResultsFileName), z.unknown(), maxResultBytes).catch(
    (error: Error) => {
      throw new Error(`No test results were produced (${error.message}). Runner output: ${result.stderr.trim()}`);
    },
  );
  const { cases, fileErrors } = parseVitestJsonReport(report);
  const hasFailure = fileErrors.length > 0 || cases.some((testCase) => testCase.status === 'failed');
  if (result.exitCode !== 0 && !hasFailure) {
    throw new Error(`Vitest exited with code ${result.exitCode} without a failing test. Runner output: ${result.stderr.trim()}`);
  }
  return { exitCode: result.exitCode, timedOut: result.timedOut, cases, fileErrors };
}
