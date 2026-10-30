import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkspaceConfig } from '../src/config.ts';
import { SymbolicLinkError } from '../src/sandbox/files.ts';
import { createStagingCopy, diffStagingCopy, findDisallowedChanges, selectStagingFiles } from '../src/sandbox/staging.ts';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const workspace: WorkspaceConfig = {
  root: 'backend',
  skill: 'backend-unit-tests',
  sources: ['src/**/*.ts'],
  ignoredSources: [],
  tests: ['tests/**/*.test.ts'],
  writable: ['tests/**'],
  shared: ['tests/fixture.ts'],
  context: ['package.json'],
  commands: { install: ['npm ci --ignore-scripts'], typecheck: 'npx tsc --noEmit', test: 'npx vitest run' },
};

async function createRepository(files: Record<string, string>) {
  const root = await mkdtemp(path.join(tmpdir(), 'testeragent-test-'));
  temporaryDirectories.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await writeFile(path.join(root, relativePath), content);
  }
  return root;
}

async function createDestination() {
  const destination = await mkdtemp(path.join(tmpdir(), 'testeragent-staging-'));
  temporaryDirectories.push(destination);
  return destination;
}

const repositoryFiles = {
  'backend/src/router.ts': 'export const router = 1;',
  'backend/tests/router.test.ts': 'it("works", () => {});',
  'backend/tests/fixture.ts': 'export const todo = {};',
  'backend/package.json': '{}',
  'backend/README.md': '# not selected',
  'frontend/src/App.tsx': 'export {};',
  'CLAUDE.md': 'not selected',
};

describe('selectStagingFiles', () => {
  it('keeps only the workspace files named by the config globs', () => {
    expect(selectStagingFiles(Object.keys(repositoryFiles), workspace)).toEqual([
      'backend/src/router.ts',
      'backend/tests/router.test.ts',
      'backend/tests/fixture.ts',
      'backend/package.json',
    ]);
  });
});

describe('createStagingCopy and diffStagingCopy', () => {
  it('copies the selected files and reports no changes when nothing was written', async () => {
    const repositoryRoot = await createRepository(repositoryFiles);
    const destination = await createDestination();
    const manifest = await createStagingCopy({ repositoryRoot, trackedFiles: Object.keys(repositoryFiles), workspace, destination });
    expect([...manifest.keys()]).toHaveLength(4);
    expect(await diffStagingCopy(destination, manifest)).toEqual({ added: [], modified: [], deleted: [], symbolicLinks: [] });
  });

  it('reports added, modified and deleted files and new symbolic links', async () => {
    const repositoryRoot = await createRepository(repositoryFiles);
    const destination = await createDestination();
    const manifest = await createStagingCopy({ repositoryRoot, trackedFiles: Object.keys(repositoryFiles), workspace, destination });
    await writeFile(path.join(destination, 'backend/tests/router.test.ts'), 'it("changed", () => {});');
    await writeFile(path.join(destination, 'backend/tests/new.test.ts'), 'it("new", () => {});');
    await rm(path.join(destination, 'backend/tests/fixture.ts'));
    await symlink('/etc/hosts', path.join(destination, 'backend/tests/link.ts'));
    expect(await diffStagingCopy(destination, manifest)).toEqual({
      added: ['backend/tests/new.test.ts'],
      modified: ['backend/tests/router.test.ts'],
      deleted: ['backend/tests/fixture.ts'],
      symbolicLinks: ['backend/tests/link.ts'],
    });
  });

  it('refuses to copy a symbolic link from the repository', async () => {
    const repositoryRoot = await createRepository(repositoryFiles);
    await symlink('/etc/hosts', path.join(repositoryRoot, 'backend/src/leak.ts'));
    const destination = await createDestination();
    const trackedFiles = [...Object.keys(repositoryFiles), 'backend/src/leak.ts'];
    await expect(createStagingCopy({ repositoryRoot, trackedFiles, workspace, destination })).rejects.toBeInstanceOf(SymbolicLinkError);
  });
});

describe('findDisallowedChanges', () => {
  it('returns every change outside the writable globs and every deletion', () => {
    const changes = {
      added: ['backend/tests/new.test.ts', 'backend/src/helper.ts'],
      modified: ['backend/src/router.ts'],
      deleted: ['backend/tests/fixture.ts'],
      symbolicLinks: [],
    };
    expect(findDisallowedChanges(changes, workspace)).toEqual(['backend/src/helper.ts', 'backend/src/router.ts', 'backend/tests/fixture.ts']);
  });
});
