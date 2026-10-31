import type { WorkspaceConfig } from '../config.ts';
import { runProcess } from '../process.ts';
import { assertPrintablePaths, createMatcher } from '../sandbox/files.ts';
import type { CoverageByFile } from './coverage.ts';
import { groupIntoBatches, mapTestsToSources, selectSourceFiles, type WorkItem } from './repository.ts';

export type ChangedFile =
  | { status: 'added' | 'modified' | 'deleted'; path: string; changedLines: number }
  | { status: 'renamed'; path: string; previousPath: string; changedLines: number };

const gitObjectPattern = /^[0-9a-f]{7,64}$/;

async function runGit(repositoryRoot: string, args: string[]) {
  const result = await runProcess('git', args, { cwd: repositoryRoot, timeoutMilliseconds: 60_000, maxOutputCharacters: 20_000_000 });
  if (result.exitCode !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

function parseNameStatus(output: string) {
  const fields = output.split('\0').filter((field) => field.length > 0);
  const entries: { status: string; path: string; previousPath?: string }[] = [];
  for (let index = 0; index < fields.length; ) {
    const status = fields[index];
    if (status.startsWith('R') || status.startsWith('C')) {
      entries.push({ status: status[0], previousPath: fields[index + 1], path: fields[index + 2] });
      index += 3;
    } else {
      entries.push({ status, path: fields[index + 1] });
      index += 2;
    }
  }
  return entries;
}

function parseNumstat(output: string) {
  const fields = output.split('\0');
  const changedLines = new Map<string, number>();
  for (let index = 0; index < fields.length; index += 1) {
    const match = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(fields[index]);
    if (!match) continue;
    const lines = (match[1] === '-' ? 0 : Number(match[1])) + (match[2] === '-' ? 0 : Number(match[2]));
    // A rename leaves the path empty and puts the old and new paths in the next two fields.
    if (match[3] === '') {
      changedLines.set(fields[index + 2], lines);
      index += 2;
    } else {
      changedLines.set(match[3], lines);
    }
  }
  return changedLines;
}

export async function readPullRequestDiff(repositoryRoot: string, baseSha: string, headSha: string): Promise<ChangedFile[]> {
  for (const sha of [baseSha, headSha]) {
    if (!gitObjectPattern.test(sha)) throw new Error(`Not a commit hash: ${JSON.stringify(sha)}`);
  }
  const range = `${baseSha}...${headSha}`;
  const nameStatus = parseNameStatus(await runGit(repositoryRoot, ['diff', '--name-status', '-z', '--find-renames', '--no-ext-diff', range]));
  const changedLines = parseNumstat(await runGit(repositoryRoot, ['diff', '--numstat', '-z', '--find-renames', '--no-ext-diff', range]));
  assertPrintablePaths(nameStatus.flatMap((entry) => (entry.previousPath ? [entry.path, entry.previousPath] : [entry.path])));
  return nameStatus.map((entry): ChangedFile => {
    const lines = changedLines.get(entry.path) ?? 0;
    if (entry.status === 'R' && entry.previousPath) return { status: 'renamed', path: entry.path, previousPath: entry.previousPath, changedLines: lines };
    if (entry.status === 'A' || entry.status === 'C') return { status: 'added', path: entry.path, changedLines: lines };
    if (entry.status === 'D') return { status: 'deleted', path: entry.path, changedLines: lines };
    return { status: 'modified', path: entry.path, changedLines: lines };
  });
}

type PlanPullRequestWorkOptions = {
  workspaceName: string;
  workspace: WorkspaceConfig;
  trackedFiles: string[];
  readRepositoryFile: (relativePath: string) => Promise<string>;
  coverage: CoverageByFile;
  changedFiles: ChangedFile[];
  failingTestFiles: string[];
  maxChangedSourceFiles: number;
  maxBatchSize?: number;
};

// Related tests may be edited: they import a changed source file, fail on the head before any agent edit, or were changed by the PR itself.
export async function planPullRequestWork({
  workspaceName,
  workspace,
  trackedFiles,
  readRepositoryFile,
  coverage,
  changedFiles,
  failingTestFiles,
  maxChangedSourceFiles,
  maxBatchSize = 5,
}: PlanPullRequestWorkOptions) {
  const isTest = createMatcher(workspace.root, workspace.tests);
  const sourceFiles = new Set(selectSourceFiles(workspace, trackedFiles));
  const testsBySource = await mapTestsToSources({ workspace, trackedFiles, readRepositoryFile });
  const failing = new Set(failingTestFiles);

  const changedSources = changedFiles
    .filter((file) => file.status !== 'deleted' && sourceFiles.has(file.path))
    .sort((first, second) => second.changedLines - first.changedLines);
  const selected = changedSources.slice(0, maxChangedSourceFiles).map((file) => file.path);
  const leftOutByCap = changedSources.slice(maxChangedSourceFiles).map((file) => file.path);

  const sourcesOfFailingTests = [...testsBySource]
    .filter(([sourceFile, testFiles]) => sourceFiles.has(sourceFile) && testFiles.some((testFile) => failing.has(testFile)))
    .map(([sourceFile]) => sourceFile);

  const items: WorkItem[] = [...new Set([...selected, ...sourcesOfFailingTests])].map((sourceFile) => {
    const testFiles = testsBySource.get(sourceFile) ?? [];
    return { sourceFile, testFiles, coverage: coverage.get(sourceFile), failingTests: testFiles.filter((testFile) => failing.has(testFile)) };
  });

  const relatedTests = new Set<string>([
    ...items.flatMap((item) => item.testFiles),
    ...failing,
    ...changedFiles.filter((file) => file.status !== 'deleted' && isTest(file.path)).map((file) => file.path),
  ]);
  const deletedSources = changedFiles
    .filter((file) => file.status === 'deleted' && createMatcher(workspace.root, workspace.sources)(file.path))
    .map((file) => file.path);

  return {
    batches: groupIntoBatches(workspaceName, items, maxBatchSize),
    relatedTests,
    leftOutByCap,
    deletedSources,
  };
}
