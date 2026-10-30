import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import picomatch from 'picomatch';
import type { z } from 'zod';
import { runProcess } from '../process.ts';

export class SymbolicLinkError extends Error {
  readonly relativePath: string;

  constructor(relativePath: string) {
    super(`Symbolic links are not allowed: ${relativePath}`);
    this.name = 'SymbolicLinkError';
    this.relativePath = relativePath;
  }
}

export function createMatcher(workspaceRoot: string, patterns: string[]) {
  if (patterns.length === 0) return () => false;
  return picomatch(
    patterns.map((pattern) => path.posix.join(workspaceRoot, pattern)),
    { dot: true },
  );
}

export async function listTrackedFiles(repositoryRoot: string) {
  const result = await runProcess('git', ['ls-files', '-z'], {
    cwd: repositoryRoot,
    timeoutMilliseconds: 30_000,
  });
  if (result.exitCode !== 0) throw new Error(`git ls-files failed: ${result.stderr.trim()}`);
  return result.stdout.split('\0').filter((relativePath) => relativePath.length > 0);
}

export async function assertRegularFile(filePath: string, relativePath: string) {
  const stats = await lstat(filePath);
  if (stats.isSymbolicLink()) throw new SymbolicLinkError(relativePath);
  if (!stats.isFile()) throw new Error(`Not a regular file: ${relativePath}`);
  return stats;
}

export async function copyRegularFiles(sourceRoot: string, destinationRoot: string, relativePaths: string[]) {
  for (const relativePath of relativePaths) {
    const sourcePath = path.join(sourceRoot, relativePath);
    await assertRegularFile(sourcePath, relativePath);
    const destinationPath = path.join(destinationRoot, relativePath);
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await copyFile(sourcePath, destinationPath);
  }
}

export async function hashFile(filePath: string) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

export async function listTree(root: string) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files: string[] = [];
  const symbolicLinks: string[] = [];
  for (const entry of entries) {
    const relativePath = path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/');
    if (entry.isSymbolicLink()) symbolicLinks.push(relativePath);
    else if (entry.isFile()) files.push(relativePath);
  }
  return { files, symbolicLinks };
}

export async function readRegularFile(filePath: string, maxBytes: number) {
  const stats = await assertRegularFile(filePath, filePath);
  if (stats.size > maxBytes) throw new Error(`File too large (${stats.size} bytes, limit ${maxBytes}): ${filePath}`);
  return readFile(filePath, 'utf8');
}

export async function readJsonFile<Schema extends z.ZodType>(filePath: string, schema: Schema, maxBytes: number) {
  const content = await readRegularFile(filePath, maxBytes);
  return schema.parse(JSON.parse(content)) as z.output<Schema>;
}
