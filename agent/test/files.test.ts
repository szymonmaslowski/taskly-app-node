import { execFileSync } from 'node:child_process';
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

  it('refuses a FIFO without blocking on it', async () => {
    const directory = await createDirectory();
    execFileSync('mkfifo', [path.join(directory, 'results.json')]);
    await expect(readRegularFile(path.join(directory, 'results.json'), 100)).rejects.toThrow(/Not a regular file/);
  });

  it('refuses a file over the size limit', async () => {
    const directory = await createDirectory();
    await writeFile(path.join(directory, 'results.json'), 'x'.repeat(101));
    await expect(readRegularFile(path.join(directory, 'results.json'), 100)).rejects.toThrow(/too large/);
  });
});

describe('readJsonFile', () => {
  it('reports invalid JSON without quoting the content', async () => {
    const directory = await createDirectory();
    await writeFile(path.join(directory, 'results.json'), 'secret-token-value');
    const error = await readJsonFile(path.join(directory, 'results.json'), z.object({}), 100).catch((caught: Error) => caught);
    expect(error.message).toMatch(/Invalid JSON/);
    expect(error.message).not.toContain('secret-token-value');
  });

  it('validates the parsed content against the schema', async () => {
    const directory = await createDirectory();
    await writeFile(path.join(directory, 'results.json'), '{"passed":"yes"}');
    await expect(readJsonFile(path.join(directory, 'results.json'), z.object({ passed: z.boolean() }), 100)).rejects.toThrow();
  });
});
