import { lstat, rm } from 'node:fs/promises';
import path from 'node:path';
import { assertNoLinksOnPath, copyRegularFiles } from './files.ts';
import type { StagingChanges } from './staging.ts';

function toWorkspaceRelative(workspaceRoot: string, repositoryPaths: string[]) {
  const prefix = `${workspaceRoot}/`;
  return repositoryPaths.filter((repositoryPath) => repositoryPath.startsWith(prefix)).map((repositoryPath) => repositoryPath.slice(prefix.length));
}

async function isPresent(filePath: string) {
  try {
    await lstat(filePath);
    return true;
  } catch {
    return false;
  }
}

// Paths are synced by their current staging state, so a file restored or removed after an earlier sync is updated too.
export async function syncStagingToRunner(staging: string, runnerDirectory: string, workspaceRoot: string, repositoryPaths: string[]) {
  const stagedWorkspace = path.join(staging, workspaceRoot);
  for (const workspacePath of toWorkspaceRelative(workspaceRoot, repositoryPaths)) {
    if (await isPresent(path.join(stagedWorkspace, workspacePath))) await copyRegularFiles(stagedWorkspace, runnerDirectory, [workspacePath]);
    else await rm(path.join(runnerDirectory, workspacePath), { force: true });
  }
}

export async function applyStagingToRepository(staging: string, repositoryRoot: string, changes: StagingChanges) {
  for (const changedPath of [...changes.added, ...changes.modified, ...changes.deleted]) await assertNoLinksOnPath(repositoryRoot, changedPath);
  await copyRegularFiles(staging, repositoryRoot, [...changes.added, ...changes.modified]);
  for (const deletedPath of changes.deleted) {
    await rm(path.join(repositoryRoot, deletedPath), { force: true });
  }
}
