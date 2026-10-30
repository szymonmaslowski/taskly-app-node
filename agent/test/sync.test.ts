import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SymbolicLinkError } from '../src/sandbox/files.ts';
import { applyStagingToRepository, syncStagingToRunner } from '../src/sandbox/sync.ts';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), 'testeragent-sync-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('syncStagingToRunner', () => {
  it('copies restored files and removes deleted ones, even when they no longer differ from the original', async () => {
    const staging = await createDirectory();
    const runner = await createDirectory();
    await mkdir(path.join(staging, 'backend/tests'), { recursive: true });
    await writeFile(path.join(staging, 'backend/tests/router.test.ts'), 'broken by the agent');
    await writeFile(path.join(staging, 'backend/tests/new.test.ts'), 'added by the agent');
    const paths = ['backend/tests/router.test.ts', 'backend/tests/new.test.ts'];
    await syncStagingToRunner(staging, runner, 'backend', paths);

    await writeFile(path.join(staging, 'backend/tests/router.test.ts'), 'original');
    await rm(path.join(staging, 'backend/tests/new.test.ts'));
    await syncStagingToRunner(staging, runner, 'backend', paths);

    expect(await readFile(path.join(runner, 'tests/router.test.ts'), 'utf8')).toBe('original');
    await expect(readFile(path.join(runner, 'tests/new.test.ts'), 'utf8')).rejects.toThrow(/ENOENT/);
  });
});

describe('applyStagingToRepository', () => {
  it('refuses to write through a linked directory in the checkout', async () => {
    const staging = await createDirectory();
    const repository = await createDirectory();
    const outside = await createDirectory();
    await mkdir(path.join(staging, 'backend/tests'), { recursive: true });
    await writeFile(path.join(staging, 'backend/tests/new.test.ts'), 'added by the agent');
    await mkdir(path.join(repository, 'backend'));
    await symlink(outside, path.join(repository, 'backend/tests'));
    const changes = { added: ['backend/tests/new.test.ts'], modified: [], deleted: [], symbolicLinks: [] };
    await expect(applyStagingToRepository(staging, repository, changes)).rejects.toBeInstanceOf(SymbolicLinkError);
    await expect(readFile(path.join(outside, 'new.test.ts'), 'utf8')).rejects.toThrow(/ENOENT/);
  });

  it('writes new files into directories that do not exist yet', async () => {
    const staging = await createDirectory();
    const repository = await createDirectory();
    await mkdir(path.join(staging, 'backend/tests/unit'), { recursive: true });
    await writeFile(path.join(staging, 'backend/tests/unit/new.test.ts'), 'added by the agent');
    const changes = { added: ['backend/tests/unit/new.test.ts'], modified: [], deleted: [], symbolicLinks: [] };
    await applyStagingToRepository(staging, repository, changes);
    expect(await readFile(path.join(repository, 'backend/tests/unit/new.test.ts'), 'utf8')).toBe('added by the agent');
  });
});
