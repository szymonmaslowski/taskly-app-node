import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { configSchema } from '../src/config.ts';
import { exportPatch, findPatchProblems, inspectPatch } from '../src/publish/patch.ts';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function git(repository: string, ...args: string[]) {
  return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], {
    cwd: repository,
    encoding: 'utf8',
  });
}

async function createDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), 'testeragent-patch-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeFiles(root: string, files: Record<string, string>) {
  for (const [relativePath, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await writeFile(path.join(root, relativePath), content);
  }
}

const stage = { model: 'claude-sonnet-5-5', effort: 'medium' as const, maxTurns: 10, timeoutMinutes: 5, maxBudgetUsd: 1 };
const config = configSchema.parse({
  workspaces: {
    backend: {
      root: 'backend',
      skill: 'backend-unit-tests',
      sources: ['src/**/*.ts'],
      tests: ['tests/**/*.test.ts'],
      writable: ['tests/**'],
      commands: { install: ['npm ci --ignore-scripts'], typecheck: 'tsc', test: 'vitest run' },
    },
  },
  stages: { plan: stage, planReview: stage, write: stage, fix: stage, lastFix: stage, implReview: stage },
  loop: { planRounds: 2, outputAttempts: 2, fixAttempts: 3, agentParallelism: 1, flakyReruns: 2, implReviewRounds: 1 },
});

async function createHead() {
  const repository = await createDirectory();
  git(repository, 'init', '--quiet');
  await writeFiles(repository, { 'backend/src/router.ts': 'export const a = 1;\n', 'backend/tests/router.test.ts': "it('works', () => {});\n" });
  git(repository, 'add', '.');
  git(repository, 'commit', '--quiet', '-m', 'head');
  const clean = await createDirectory();
  git(clean, 'clone', '--quiet', repository, '.');
  return { repository, clean };
}

async function problemsOf(repository: string, clean: string) {
  const patch = await exportPatch(repository);
  return findPatchProblems(patch, await inspectPatch(clean, patch), config);
}

describe('patch export and validation', () => {
  it('accepts new and changed test files that apply to a clean head checkout', async () => {
    const { repository, clean } = await createHead();
    await writeFiles(repository, {
      'backend/tests/router.test.ts': "it('works', () => {});\nit('also works', () => {});\n",
      'backend/tests/new.test.ts': "it('is new', () => {});\n",
    });
    const patch = await exportPatch(repository);
    const summary = await inspectPatch(clean, patch);
    expect(summary.entries.map((entry) => entry.path).sort()).toEqual(['backend/tests/new.test.ts', 'backend/tests/router.test.ts']);
    expect(findPatchProblems(patch, summary, config)).toEqual([]);
  });

  it('returns an empty patch when nothing changed', async () => {
    const { repository } = await createHead();
    expect(await exportPatch(repository)).toBe('');
  });

  it('rejects a change outside the writable paths', async () => {
    const { repository, clean } = await createHead();
    await writeFiles(repository, { 'backend/src/router.ts': 'export const a = 2;\n' });
    expect(await problemsOf(repository, clean)).toEqual(['changes a file outside the writable paths: backend/src/router.ts']);
  });

  it('rejects a symbolic link, even inside the writable paths', async () => {
    const { repository, clean } = await createHead();
    await symlink('/proc/self/environ', path.join(repository, 'backend/tests/leak.ts'));
    expect((await problemsOf(repository, clean)).join('\n')).toMatch(/creates something other than a regular file: create mode 120000/);
  });

  it('rejects deletions and mode changes', async () => {
    const { repository, clean } = await createHead();
    await unlink(path.join(repository, 'backend/tests/router.test.ts'));
    expect((await problemsOf(repository, clean)).join('\n')).toMatch(/deletes a file/);
    git(repository, 'checkout', 'HEAD', '--', 'backend/tests/router.test.ts');
    await chmod(path.join(repository, 'backend/tests/router.test.ts'), 0o755);
    expect((await problemsOf(repository, clean)).join('\n')).toMatch(/changes a file mode/);
  });

  it('rejects binary content', async () => {
    const { repository, clean } = await createHead();
    await writeFile(path.join(repository, 'backend/tests/blob.bin'), Buffer.from([0, 1, 2, 255, 0, 3]));
    expect((await problemsOf(repository, clean)).join('\n')).toMatch(/changes a binary file: backend\/tests\/blob.bin/);
  });

  it('refuses a patch that does not apply to the head', async () => {
    const { repository, clean } = await createHead();
    await writeFiles(repository, { 'backend/tests/router.test.ts': "it('changed', () => {});\n" });
    const patch = await exportPatch(repository);
    await writeFiles(clean, { 'backend/tests/router.test.ts': 'something else entirely\n' });
    git(clean, 'commit', '--quiet', '-am', 'moved on');
    await expect(inspectPatch(clean, patch)).rejects.toThrow(/doesn't apply/);
  });
});
