import { describe, expect, it } from 'vitest';
import type { FileCoverage } from '../src/analyze/coverage.ts';
import { planRepositoryWork } from '../src/analyze/repository.ts';
import type { WorkspaceConfig } from '../src/config.ts';

const frontend: WorkspaceConfig = {
  root: 'frontend',
  skill: 'frontend-unit-tests',
  sources: ['src/**/*.{ts,tsx}'],
  ignoredSources: ['src/main.tsx'],
  tests: ['src/**/*.test.{ts,tsx}'],
  writable: ['src/**/*.test.{ts,tsx}'],
  shared: [],
  context: [],
  commands: { install: ['npm ci --ignore-scripts'], typecheck: 'npx tsc --noEmit', test: 'npx vitest run' },
};

describe('planRepositoryWork', () => {
  const fullyCovered: FileCoverage = { statements: { covered: 4, total: 4 }, branches: { covered: 2, total: 2 }, uncoveredLines: [], uncoveredBranches: [] };
  const partlyCovered: FileCoverage = { statements: { covered: 1, total: 4 }, branches: { covered: 0, total: 2 }, uncoveredLines: [3], uncoveredBranches: [] };
  const files: Record<string, string> = {
    'frontend/src/lib/http.ts': '',
    'frontend/src/lib/format.ts': '',
    'frontend/src/lib/format.test.ts': "import { format } from './format'",
    'frontend/src/hooks/useNotice.ts': '',
    'frontend/src/main.tsx': '',
  };

  it('skips fully covered files that have tests, ignores configured sources and batches the rest per directory', async () => {
    const work = await planRepositoryWork({
      workspaceName: 'frontend',
      workspace: frontend,
      trackedFiles: Object.keys(files),
      readRepositoryFile: async (relativePath) => files[relativePath],
      coverage: new Map([
        ['frontend/src/lib/format.ts', fullyCovered],
        ['frontend/src/lib/http.ts', partlyCovered],
      ]),
    });
    expect(work.fullyCovered).toEqual(['frontend/src/lib/format.ts']);
    expect(work.batches).toEqual([
      { workspaceName: 'frontend', module: 'frontend/src/hooks', items: [{ sourceFile: 'frontend/src/hooks/useNotice.ts', testFiles: [], coverage: undefined }] },
      { workspaceName: 'frontend', module: 'frontend/src/lib', items: [{ sourceFile: 'frontend/src/lib/http.ts', testFiles: [], coverage: partlyCovered }] },
    ]);
  });

  it('splits large directories into batches of the given size', async () => {
    const trackedFiles = ['a', 'b', 'c'].map((name) => `frontend/src/utils/${name}.ts`);
    const work = await planRepositoryWork({
      workspaceName: 'frontend',
      workspace: frontend,
      trackedFiles,
      readRepositoryFile: async () => '',
      coverage: new Map(),
      maxBatchSize: 2,
    });
    expect(work.batches.map((batch) => batch.items.length)).toEqual([2, 1]);
  });
});
