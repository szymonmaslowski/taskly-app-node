import path from 'node:path';
import type { TesterAgentConfig } from '../config.ts';
import { runProcess } from '../process.ts';
import { assertPrintablePaths, createMatcher } from '../sandbox/files.ts';

const maxPatchBytes = 2_000_000;

// Attributes in the checkout come from the pull request, so diff drivers and text conversion are switched off.
const safeDiffArgs = ['--no-ext-diff', '--no-textconv', '--no-color', '--binary', '--full-index'];

async function runGit(repositoryRoot: string, args: string[], input?: string) {
  const result = await runProcess('git', ['-c', 'core.quotePath=false', ...args], {
    cwd: repositoryRoot,
    timeoutMilliseconds: 60_000,
    maxOutputCharacters: maxPatchBytes * 2,
    input,
  });
  return result;
}

async function runGitOrThrow(repositoryRoot: string, args: string[], input?: string) {
  const result = await runGit(repositoryRoot, args, input);
  if (result.exitCode !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

async function listChangedPaths(repositoryRoot: string) {
  const fields = (await runGitOrThrow(repositoryRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])).split('\0');
  const paths: string[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (field.length < 4) continue;
    paths.push(field.slice(3));
    // A rename is followed by its original path, which the patch shows as a deletion.
    if (field[0] === 'R' || field[0] === 'C') paths.push(fields[++index]);
  }
  return paths;
}

// The checkout starts clean at the head, so every change in it is the agent's; the patch is a diff against the head commit.
export async function exportPatch(repositoryRoot: string) {
  const changedPaths = await listChangedPaths(repositoryRoot);
  if (changedPaths.length === 0) return '';
  assertPrintablePaths(changedPaths);
  await runGitOrThrow(repositoryRoot, ['add', '--intent-to-add', '--', ...changedPaths]);
  return runGitOrThrow(repositoryRoot, ['diff', ...safeDiffArgs, 'HEAD', '--', ...changedPaths]);
}

export type PatchEntry = {
  path: string;
  added: number;
  deleted: number;
  binary: boolean;
};

export type PatchSummary = {
  entries: PatchEntry[];
  summaryLines: string[];
};

function parseNumstat(output: string) {
  const entries: PatchEntry[] = [];
  const fields = output.split('\0');
  for (let index = 0; index < fields.length; index += 1) {
    const match = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(fields[index]);
    if (!match) continue;
    const binary = match[1] === '-' || match[2] === '-';
    let filePath = match[3];
    // A rename leaves the path empty and puts the old and new paths in the next two fields.
    if (filePath === '') {
      filePath = `${fields[index + 1]} => ${fields[index + 2]}`;
      index += 2;
    }
    entries.push({ path: filePath, added: binary ? 0 : Number(match[1]), deleted: binary ? 0 : Number(match[2]), binary });
  }
  return entries;
}

// git reads the patch structurally, so no diff text is parsed here; the check also proves it applies to the head.
export async function inspectPatch(cleanCheckout: string, patch: string): Promise<PatchSummary> {
  const check = await runGit(cleanCheckout, ['apply', '--check', '-'], patch);
  if (check.exitCode !== 0) throw new Error(`The patch doesn't apply to the head: ${check.stderr.trim().slice(0, 500)}`);
  const numstat = await runGitOrThrow(cleanCheckout, ['apply', '--numstat', '-z', '-'], patch);
  const summary = await runGitOrThrow(cleanCheckout, ['apply', '--summary', '-'], patch);
  return { entries: parseNumstat(numstat), summaryLines: summary.split('\n').map((line) => line.trim()).filter(Boolean) };
}

function isInsideRepository(filePath: string) {
  return !path.isAbsolute(filePath) && !filePath.split('/').includes('..');
}

export function findPatchProblems(patch: string, { entries, summaryLines }: PatchSummary, config: TesterAgentConfig) {
  const problems: string[] = [];
  if (Buffer.byteLength(patch) > maxPatchBytes) problems.push(`the patch is larger than ${maxPatchBytes} bytes`);
  const writableMatchers = Object.values(config.workspaces).map((workspace) => createMatcher(workspace.root, workspace.writable));
  for (const entry of entries) {
    if (entry.path.includes(' => ')) {
      problems.push(`renames a file: ${entry.path}`);
      continue;
    }
    if (!isInsideRepository(entry.path)) problems.push(`path outside the repository: ${entry.path}`);
    else if (!writableMatchers.some((isWritable) => isWritable(entry.path))) problems.push(`changes a file outside the writable paths: ${entry.path}`);
    if (entry.binary) problems.push(`changes a binary file: ${entry.path}`);
  }
  for (const line of summaryLines) {
    if (line.startsWith('delete mode')) problems.push(`deletes a file: ${line}`);
    else if (line.startsWith('mode change')) problems.push(`changes a file mode: ${line}`);
    else if (line.startsWith('rename') || line.startsWith('copy')) problems.push(`renames or copies a file: ${line}`);
    else if (line.startsWith('create mode') && !/^create mode 100644 /.test(line)) problems.push(`creates something other than a regular file: ${line}`);
  }
  return problems;
}
