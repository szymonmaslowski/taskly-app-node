import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { planPullRequestWork, readFileAtCommit, readPullRequestDiff, type ChangedFile } from '../src/analyze/pull-request.ts';
import type { WorkspaceConfig } from '../src/config.ts';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function git(repository: string, ...args: string[]) {
  return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], {
    cwd: repository,
    encoding: 'utf8',
  }).trim();
}

async function writeFiles(repository: string, files: Record<string, string>) {
  for (const [relativePath, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(repository, relativePath)), { recursive: true });
    await writeFile(path.join(repository, relativePath), content);
  }
}

async function createRepository(files: Record<string, string>) {
  const repository = await mkdtemp(path.join(tmpdir(), 'testeragent-pr-'));
  temporaryDirectories.push(repository);
  git(repository, 'init', '--quiet');
  await writeFiles(repository, files);
  git(repository, 'add', '.');
  git(repository, 'commit', '--quiet', '-m', 'base');
  return { repository, baseSha: git(repository, 'rev-parse', 'HEAD') };
}

describe('readFileAtCommit', () => {
  it('reads a file as it was in an earlier commit, and refuses anything but a commit hash', async () => {
    const { repository, baseSha } = await createRepository({ 'backend/src/router.ts': 'export const limit = 120;\n' });
    await writeFiles(repository, { 'backend/src/router.ts': 'export const limit = 100;\n' });
    git(repository, 'commit', '--quiet', '-am', 'head');
    expect(await readFileAtCommit(repository, baseSha, 'backend/src/router.ts')).toBe('export const limit = 120;\n');
    await expect(readFileAtCommit(repository, 'HEAD~1', 'backend/src/router.ts')).rejects.toThrow(/Not a commit hash/);
  });
});

describe('readPullRequestDiff', () => {
  it('reports added, modified, deleted and renamed files with their changed lines', async () => {
    const { repository, baseSha } = await createRepository({
      'backend/src/router.ts': 'export const a = 1;\n',
      'backend/src/old-name.ts': 'export const unchanged = "a long enough line to be detected as the same file";\n',
      'backend/src/gone.ts': 'export const gone = 1;\n',
    });
    await writeFiles(repository, { 'backend/src/router.ts': 'export const a = 2;\nexport const b = 3;\n', 'backend/src/new.ts': 'export {};\n' });
    await unlink(path.join(repository, 'backend/src/gone.ts'));
    git(repository, 'mv', 'backend/src/old-name.ts', 'backend/src/new-name.ts');
    git(repository, 'add', '-A');
    git(repository, 'commit', '--quiet', '-m', 'head');
    const headSha = git(repository, 'rev-parse', 'HEAD');

    const changedFiles = await readPullRequestDiff(repository, baseSha, headSha);
    expect(changedFiles).toHaveLength(4);
    expect(changedFiles).toEqual(
      expect.arrayContaining([
        { status: 'deleted', path: 'backend/src/gone.ts', changedLines: 1 },
        { status: 'added', path: 'backend/src/new.ts', changedLines: 1 },
        { status: 'renamed', path: 'backend/src/new-name.ts', previousPath: 'backend/src/old-name.ts', changedLines: 0 },
        { status: 'modified', path: 'backend/src/router.ts', changedLines: 3 },
      ]),
    );
  });

  it('refuses anything that is not a commit hash, so a ref name cannot be passed to git as an option', async () => {
    const { repository, baseSha } = await createRepository({ 'a.ts': '' });
    await expect(readPullRequestDiff(repository, '--output=/tmp/x', baseSha)).rejects.toThrow(/Not a commit hash/);
  });
});

const workspace: WorkspaceConfig = {
  root: 'backend',
  skill: 'backend-unit-tests',
  sources: ['src/**/*.ts'],
  ignoredSources: ['src/main.ts'],
  tests: ['tests/**/*.test.ts'],
  writable: ['tests/**'],
  shared: ['tests/fixture.ts'],
  context: [],
  commands: { install: ['npm ci --ignore-scripts'], typecheck: 'node_modules/.bin/tsc --noEmit', test: 'node_modules/.bin/vitest run' },
};

const files: Record<string, string> = {
  'backend/src/router.ts': "import { validate } from './validators.ts';",
  'backend/src/validators.ts': 'export const validate = () => true;',
  'backend/src/mappers.ts': 'export const map = () => 1;',
  'backend/src/main.ts': '',
  'backend/tests/router.test.ts': "import { createRouter } from '../src/router.ts';",
  'backend/tests/validators.test.ts': "import { validate } from '../src/validators.ts';",
  'backend/tests/mappers.test.ts': "import { map } from '../src/mappers.ts';",
};

function plan(changedFiles: ChangedFile[], failingTestFiles: string[] = [], maxChangedSourceFiles = 15) {
  return planPullRequestWork({
    workspaceName: 'backend',
    workspace,
    trackedFiles: Object.keys(files),
    readRepositoryFile: async (relativePath) => files[relativePath],
    coverage: new Map(),
    changedFiles,
    failingTestFiles,
    maxChangedSourceFiles,
  });
}

describe('planPullRequestWork', () => {
  it('plans only for changed source files and allows edits only to their tests', async () => {
    const work = await plan([{ status: 'modified', path: 'backend/src/validators.ts', changedLines: 4 }]);
    expect(work.batches.flatMap((batch) => batch.items.map((item) => item.sourceFile))).toEqual(['backend/src/validators.ts']);
    expect([...work.relatedTests]).toEqual(['backend/tests/validators.test.ts']);
  });

  it('adds the sources of tests that fail on the head, which catches breakage through an import', async () => {
    const work = await plan([{ status: 'modified', path: 'backend/src/validators.ts', changedLines: 4 }], ['backend/tests/router.test.ts']);
    const items = work.batches.flatMap((batch) => batch.items);
    expect(items.find((item) => item.sourceFile === 'backend/src/router.ts')?.failingTests).toEqual(['backend/tests/router.test.ts']);
    expect([...work.relatedTests].sort()).toEqual(['backend/tests/router.test.ts', 'backend/tests/validators.test.ts']);
  });

  it('keeps the files with the most changed lines when the PR is over the limit, and lists the rest', async () => {
    const work = await plan(
      [
        { status: 'modified', path: 'backend/src/mappers.ts', changedLines: 2 },
        { status: 'modified', path: 'backend/src/validators.ts', changedLines: 40 },
      ],
      [],
      1,
    );
    expect(work.batches.flatMap((batch) => batch.items.map((item) => item.sourceFile))).toEqual(['backend/src/validators.ts']);
    expect(work.leftOutByCap).toEqual(['backend/src/mappers.ts']);
  });

  it('ignores files outside the sources and lists deleted sources', async () => {
    const work = await plan([
      { status: 'modified', path: 'backend/src/main.ts', changedLines: 1 },
      { status: 'modified', path: 'backend/README.md', changedLines: 1 },
      { status: 'deleted', path: 'backend/src/legacy.ts', changedLines: 10 },
    ]);
    expect(work.batches).toEqual([]);
    expect(work.deletedSources).toEqual(['backend/src/legacy.ts']);
  });
});
