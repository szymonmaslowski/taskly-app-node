import { mkdir, rm, writeFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { WorkspaceConfig } from '../config.ts';
import { runProcess } from '../process.ts';
import { assertRegularFile, copyRegularFiles, readJsonFile } from './files.ts';
import { runnerImage } from './images.ts';
import { parseVitestJsonReport } from './test-results.ts';

const vitestConfigCandidates = ['vitest.config.ts', 'vitest.config.mts', 'vite.config.ts', 'vite.config.mts'];
const wrapperConfigPath = '.testeragent/vitest.agent.ts';
const testResultsFileName = 'test-results.json';
const maxResultBytes = 20_000_000;

type RunnerCommand = {
  workspaceDirectory: string;
  outputDirectory: string;
  command: string;
  args?: string[];
  network: boolean;
  timeoutMilliseconds: number;
};

export function runInRunner({ workspaceDirectory, outputDirectory, command, args = [], network, timeoutMilliseconds }: RunnerCommand) {
  const { uid, gid } = userInfo();
  return runProcess(
    'docker',
    [
      'run',
      '--rm',
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
      '--workdir',
      '/workspace',
      runnerImage,
      'sh',
      '-c',
      `${command} "$@"`,
      'sh',
      ...args,
    ],
    { timeoutMilliseconds },
  );
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
  return `import workspaceConfig from '../${workspaceConfigFile}';

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
      reportsDirectory: '/output/coverage',
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

export async function runTests({ workspaceDirectory, outputDirectory, workspace, testFiles = [], coverage = false }: RunTestsOptions) {
  const workspaceConfigFile = await findVitestConfig(workspaceDirectory);
  const wrapperPath = path.join(workspaceDirectory, wrapperConfigPath);
  await mkdir(path.dirname(wrapperPath), { recursive: true });
  await writeFile(wrapperPath, createVitestWrapperConfig(workspaceConfigFile));
  await rm(path.join(outputDirectory, testResultsFileName), { force: true });
  await rm(path.join(outputDirectory, 'coverage'), { recursive: true, force: true });

  const coverageFlag = coverage ? ' --coverage.enabled=true' : '';
  const result = await runInRunner({
    workspaceDirectory,
    outputDirectory,
    command: `${workspace.commands.test} --config ${wrapperConfigPath}${coverageFlag}`,
    args: testFiles,
    network: false,
    timeoutMilliseconds: 600_000,
  });
  const report = await readJsonFile(path.join(outputDirectory, testResultsFileName), z.unknown(), maxResultBytes).catch(
    (error: Error) => {
      throw new Error(`No test results were produced (${error.message}). Runner output: ${result.stderr.trim()}`);
    },
  );
  return { exitCode: result.exitCode, timedOut: result.timedOut, ...parseVitestJsonReport(report) };
}
