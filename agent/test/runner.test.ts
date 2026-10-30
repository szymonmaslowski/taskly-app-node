import { describe, expect, it } from 'vitest';
import { createVitestWrapperConfig } from '../src/sandbox/runner.ts';
import { parseVitestJsonReport } from '../src/sandbox/test-results.ts';

describe('createVitestWrapperConfig', () => {
  it('reuses the workspace config with JSON output in the output directory and without thresholds', () => {
    const wrapper = createVitestWrapperConfig('vite.config.ts');
    expect(wrapper).toContain("import workspaceConfig from '../vite.config.ts';");
    expect(wrapper).toContain("outputFile: '/output/test-results.json'");
    expect(wrapper).toContain('thresholds: undefined');
    expect(wrapper).toContain("reportsDirectory: '/output/coverage'");
  });
});

describe('parseVitestJsonReport', () => {
  it('returns workspace-relative cases and files that failed to load', () => {
    const report = {
      testResults: [
        {
          name: '/workspace/tests/router.test.ts',
          status: 'failed',
          assertionResults: [
            { fullName: 'lists tasks', title: 'lists tasks', ancestorTitles: [], status: 'passed', failureMessages: [] },
            {
              fullName: 'router rejects invalid input',
              title: 'rejects invalid input',
              ancestorTitles: ['router'],
              status: 'failed',
              failureMessages: ['expected 422, received 200'],
            },
            { fullName: 'later', title: 'later', ancestorTitles: [], status: 'todo', failureMessages: null },
          ],
        },
        { name: '/workspace/tests/broken.test.ts', status: 'failed', message: 'Cannot find module', assertionResults: [] },
      ],
    };
    expect(parseVitestJsonReport(report)).toEqual({
      cases: [
        { file: 'tests/router.test.ts', fullName: 'lists tasks', title: 'lists tasks', ancestorTitles: [], status: 'passed', failureMessages: [] },
        {
          file: 'tests/router.test.ts',
          fullName: 'router rejects invalid input',
          title: 'rejects invalid input',
          ancestorTitles: ['router'],
          status: 'failed',
          failureMessages: ['expected 422, received 200'],
        },
        { file: 'tests/router.test.ts', fullName: 'later', title: 'later', ancestorTitles: [], status: 'skipped', failureMessages: [] },
      ],
      fileErrors: [{ file: 'tests/broken.test.ts', message: 'Cannot find module' }],
    });
  });
});
