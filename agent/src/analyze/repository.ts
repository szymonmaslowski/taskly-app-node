import path from 'node:path';
import type { WorkspaceConfig } from '../config.ts';
import { createMatcher, readJsonFile } from '../sandbox/files.ts';
import { runTests } from '../sandbox/runner.ts';
import { coverageReportSchema, isFullyCovered, summariseCoverage, type CoverageByFile, type FileCoverage } from './coverage.ts';
import { findTestedFiles } from './imports.ts';

const maxCoverageReportBytes = 50_000_000;

export type WorkItem = {
  sourceFile: string;
  testFiles: string[];
  coverage?: FileCoverage;
};

export type WorkBatch = {
  workspaceName: string;
  module: string;
  items: WorkItem[];
};

type MeasureCoverageOptions = {
  runnerDirectory: string;
  outputDirectory: string;
  workspace: WorkspaceConfig;
};

export async function measureCoverage({ runnerDirectory, outputDirectory, workspace }: MeasureCoverageOptions) {
  const testRun = await runTests({ workspaceDirectory: runnerDirectory, outputDirectory, workspace, coverage: true });
  const report = await readJsonFile(
    path.join(outputDirectory, 'coverage', 'coverage-final.json'),
    coverageReportSchema,
    maxCoverageReportBytes,
  );
  return { testRun, coverage: summariseCoverage(report, workspace.root) };
}

type MapTestsOptions = {
  workspace: WorkspaceConfig;
  trackedFiles: string[];
  readRepositoryFile: (relativePath: string) => Promise<string>;
};

export async function mapTestsToSources({ workspace, trackedFiles, readRepositoryFile }: MapTestsOptions) {
  const isTest = createMatcher(workspace.root, workspace.tests);
  const knownFiles = new Set(trackedFiles);
  const testsBySource = new Map<string, string[]>();
  for (const testFile of trackedFiles.filter((relativePath) => isTest(relativePath))) {
    for (const testedFile of findTestedFiles(testFile, await readRepositoryFile(testFile), knownFiles)) {
      testsBySource.set(testedFile, [...(testsBySource.get(testedFile) ?? []), testFile]);
    }
  }
  return testsBySource;
}

export function selectSourceFiles(workspace: WorkspaceConfig, trackedFiles: string[]) {
  const isSource = createMatcher(workspace.root, workspace.sources);
  const isIgnored = createMatcher(workspace.root, workspace.ignoredSources);
  const isTest = createMatcher(workspace.root, workspace.tests);
  return trackedFiles.filter((relativePath) => isSource(relativePath) && !isIgnored(relativePath) && !isTest(relativePath));
}

function groupIntoBatches(workspaceName: string, items: WorkItem[], maxBatchSize: number) {
  const itemsByModule = new Map<string, WorkItem[]>();
  for (const item of items) {
    const module = path.posix.dirname(item.sourceFile);
    itemsByModule.set(module, [...(itemsByModule.get(module) ?? []), item]);
  }
  const batches: WorkBatch[] = [];
  for (const [module, moduleItems] of [...itemsByModule].sort(([first], [second]) => first.localeCompare(second))) {
    for (let start = 0; start < moduleItems.length; start += maxBatchSize) {
      batches.push({ workspaceName, module, items: moduleItems.slice(start, start + maxBatchSize) });
    }
  }
  return batches;
}

type PlanRepositoryWorkOptions = MapTestsOptions & {
  workspaceName: string;
  coverage: CoverageByFile;
  maxBatchSize?: number;
};

export async function planRepositoryWork({ workspaceName, coverage, maxBatchSize = 5, ...mapOptions }: PlanRepositoryWorkOptions) {
  const testsBySource = await mapTestsToSources(mapOptions);
  const items: WorkItem[] = [];
  const fullyCovered: string[] = [];
  for (const sourceFile of selectSourceFiles(mapOptions.workspace, mapOptions.trackedFiles)) {
    const testFiles = testsBySource.get(sourceFile) ?? [];
    const fileCoverage = coverage.get(sourceFile);
    if (testFiles.length > 0 && fileCoverage && isFullyCovered(fileCoverage)) {
      fullyCovered.push(sourceFile);
      continue;
    }
    items.push({ sourceFile, testFiles, coverage: fileCoverage });
  }
  return { batches: groupIntoBatches(workspaceName, items, maxBatchSize), fullyCovered };
}
