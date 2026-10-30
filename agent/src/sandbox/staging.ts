import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { WorkspaceConfig } from '../config.ts';
import { copyRegularFiles, createMatcher, hashFile, listTree } from './files.ts';

export type StagingManifest = Map<string, string>;

export type StagingChanges = {
  added: string[];
  modified: string[];
  deleted: string[];
  symbolicLinks: string[];
};

type CreateStagingCopyOptions = {
  repositoryRoot: string;
  trackedFiles: string[];
  workspace: WorkspaceConfig;
  destination: string;
};

export function selectStagingFiles(trackedFiles: string[], workspace: WorkspaceConfig) {
  const isIncluded = createMatcher(workspace.root, [
    ...workspace.sources,
    ...workspace.tests,
    ...workspace.writable,
    ...workspace.shared,
    ...workspace.context,
  ]);
  return trackedFiles.filter((relativePath) => isIncluded(relativePath));
}

export async function createStagingCopy({ repositoryRoot, trackedFiles, workspace, destination }: CreateStagingCopyOptions) {
  const selectedFiles = selectStagingFiles(trackedFiles, workspace);
  await mkdir(destination, { recursive: true });
  await copyRegularFiles(repositoryRoot, destination, selectedFiles);
  const manifest: StagingManifest = new Map();
  for (const relativePath of selectedFiles) {
    manifest.set(relativePath, await hashFile(path.join(destination, relativePath)));
  }
  return manifest;
}

export async function diffStagingCopy(destination: string, manifest: StagingManifest) {
  const tree = await listTree(destination);
  const changes: StagingChanges = { added: [], modified: [], deleted: [], symbolicLinks: tree.symbolicLinks };
  const presentFiles = new Set(tree.files);
  for (const relativePath of tree.files) {
    const recordedHash = manifest.get(relativePath);
    if (recordedHash === undefined) changes.added.push(relativePath);
    else if (recordedHash !== (await hashFile(path.join(destination, relativePath)))) changes.modified.push(relativePath);
  }
  for (const relativePath of manifest.keys()) {
    if (!presentFiles.has(relativePath)) changes.deleted.push(relativePath);
  }
  return changes;
}

export function findDisallowedChanges(changes: StagingChanges, workspace: WorkspaceConfig) {
  const isWritable = createMatcher(workspace.root, workspace.writable);
  return [...changes.added, ...changes.modified].filter((relativePath) => !isWritable(relativePath)).concat(changes.deleted);
}
