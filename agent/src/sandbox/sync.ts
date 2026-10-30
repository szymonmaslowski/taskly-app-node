import { rm } from 'node:fs/promises';
import path from 'node:path';
import { copyRegularFiles } from './files.ts';
import type { StagingChanges } from './staging.ts';

function toWorkspaceRelative(workspaceRoot: string, repositoryPaths: string[]) {
  const prefix = `${workspaceRoot}/`;
  return repositoryPaths.filter((repositoryPath) => repositoryPath.startsWith(prefix)).map((repositoryPath) => repositoryPath.slice(prefix.length));
}

export async function syncStagingToRunner(staging: string, runnerDirectory: string, workspaceRoot: string, changes: StagingChanges) {
  await copyRegularFiles(
    path.join(staging, workspaceRoot),
    runnerDirectory,
    toWorkspaceRelative(workspaceRoot, [...changes.added, ...changes.modified]),
  );
  for (const deletedPath of toWorkspaceRelative(workspaceRoot, changes.deleted)) {
    await rm(path.join(runnerDirectory, deletedPath), { force: true });
  }
}

export async function applyStagingToRepository(staging: string, repositoryRoot: string, changes: StagingChanges) {
  await copyRegularFiles(staging, repositoryRoot, [...changes.added, ...changes.modified]);
  for (const deletedPath of changes.deleted) {
    await rm(path.join(repositoryRoot, deletedPath), { force: true });
  }
}
