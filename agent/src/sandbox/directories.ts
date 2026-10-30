import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export type RunDirectories = {
  root: string;
  staging: string;
  runner: string;
  output: string;
};

export async function createRunDirectories() {
  const root = await mkdtemp(path.join(tmpdir(), 'testeragent-'));
  const directories: RunDirectories = {
    root,
    staging: path.join(root, 'staging'),
    runner: path.join(root, 'runner'),
    output: path.join(root, 'output'),
  };
  await Promise.all([directories.staging, directories.runner, directories.output].map((directory) => mkdir(directory)));
  return directories;
}

export async function removeRunDirectories(directories: RunDirectories) {
  await rm(directories.root, { recursive: true, force: true });
}
