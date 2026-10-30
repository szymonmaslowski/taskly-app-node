import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SymbolicLinkError, readJsonFile, readRegularFile } from '../src/sandbox/files.ts';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), 'testeragent-files-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('readRegularFile', () => {
  it('reads a regular file within the size limit', async () => {
    const directory = await createDirectory();
    await writeFile(path.join(directory, 'results.json'), '{"ok":true}');
    expect(await readRegularFile(path.join(directory, 'results.json'), 100)).toBe('{"ok":true}');
  });

  it('refuses a symbolic link even when it points to a readable file', async () => {
    const directory = await createDirectory();
    await symlink('/etc/hosts', path.join(directory, 'results.json'));
    await expect(readRegularFile(path.join(directory, 'results.json'), 100_000)).rejects.toBeInstanceOf(SymbolicLinkError);
  });

  it('refuses a file over the size limit', async () => {
    const directory = await createDirectory();
    await writeFile(path.join(directory, 'results.json'), 'x'.repeat(101));
    await expect(readRegularFile(path.join(directory, 'results.json'), 100)).rejects.toThrow(/too large/);
  });
});

describe('readJsonFile', () => {
  it('validates the parsed content against the schema', async () => {
    const directory = await createDirectory();
    await writeFile(path.join(directory, 'results.json'), '{"passed":"yes"}');
    await expect(readJsonFile(path.join(directory, 'results.json'), z.object({ passed: z.boolean() }), 100)).rejects.toThrow();
  });
});
