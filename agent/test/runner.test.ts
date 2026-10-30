import { describe, expect, it } from 'vitest';
import { createContainerArgs } from '../src/sandbox/containers.ts';
import { createRunnerArgs, createVitestWrapperConfig } from '../src/sandbox/runner.ts';
import { parseVitestJsonReport } from '../src/sandbox/test-results.ts';

describe('createVitestWrapperConfig', () => {
  it('reuses the workspace config with JSON output in the output directory and without thresholds', () => {
    const wrapper = createVitestWrapperConfig('vite.config.ts');
    expect(wrapper).toContain("import workspaceConfig from '/workspace/vite.config.ts';");
    expect(wrapper).toContain('must export a plain config object');
    expect(wrapper).toContain("outputFile: '/output/test-results.json'");
    expect(wrapper).toContain('thresholds: undefined');
    expect(wrapper).toContain("reportsDirectory: '/output'");
  });
});

describe('runner container arguments', () => {
  it('runs offline, hardened, with the extra mounts read-only', () => {
    const args = createContainerArgs(
      'testeragent-runner-1',
      createRunnerArgs({
        workspaceDirectory: '/tmp/runner',
        outputDirectory: '/tmp/output',
        readOnlyMounts: [{ source: '/tmp/wrapper', target: '/workspace/.testeragent' }],
        command: 'node_modules/.bin/vitest run',
        args: ['tests/router.test.ts'],
        network: false,
        timeoutMilliseconds: 1_000,
      }),
    ).join(' ');
    expect(args).toMatch(/^run --rm --name testeragent-runner-1 /);
    for (const flag of ['--cap-drop ALL', '--security-opt no-new-privileges', '--pids-limit 512', '--memory 4g', '--cpus 2', '--pull never']) {
      expect(args).toContain(flag);
    }
    expect(args).toContain('--network none');
    expect(args).toContain('--volume /tmp/wrapper:/workspace/.testeragent:ro');
    expect(args).toMatch(/sh -c node_modules\/\.bin\/vitest run "\$@" sh tests\/router\.test\.ts$/);
  });
});

describe('parseVitestJsonReport', () => {
  it('returns workspace-relative cases and files that failed outside their cases', () => {
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
        {
          name: '/workspace/tests/hooks.test.ts',
          status: 'failed',
          message: '',
          assertionResults: [{ fullName: 'passes', title: 'passes', ancestorTitles: [], status: 'passed', failureMessages: [] }],
        },
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
        { file: 'tests/hooks.test.ts', fullName: 'passes', title: 'passes', ancestorTitles: [], status: 'passed', failureMessages: [] },
      ],
      fileErrors: [
        { file: 'tests/broken.test.ts', message: 'Cannot find module' },
        { file: 'tests/hooks.test.ts', message: 'The test file failed outside its test cases.' },
      ],
    });
  });
});
