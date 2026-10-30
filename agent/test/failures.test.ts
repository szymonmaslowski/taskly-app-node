import { describe, expect, it } from 'vitest';
import { collectFailures } from '../src/failures.ts';

describe('collectFailures', () => {
  it('groups failing cases, load errors and type errors by test file and ignores files that pass', () => {
    const failures = collectFailures({
      workspaceRoot: 'backend',
      testFiles: ['backend/tests/health.test.ts', 'backend/tests/factory.test.ts', 'backend/tests/config.test.ts'],
      cases: [
        { file: 'tests/health.test.ts', fullName: 'reports ok', title: 'reports ok', ancestorTitles: [], status: 'passed', failureMessages: [] },
        { file: 'tests/health.test.ts', fullName: 'fails', title: 'fails', ancestorTitles: [], status: 'failed', failureMessages: ['expected 500'] },
        { file: 'tests/factory.test.ts', fullName: 'serves docs', title: 'serves docs', ancestorTitles: [], status: 'passed', failureMessages: [] },
      ],
      fileErrors: [{ file: 'tests/config.test.ts', message: 'Cannot find module' }],
      typecheckOutput: [
        "tests/health.test.ts(4,7): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.",
        'src/other.ts(1,1): error TS1000: unrelated',
      ].join('\n'),
    });
    expect(failures).toEqual([
      {
        testFile: 'backend/tests/health.test.ts',
        failingCases: [{ fullName: 'fails', failureMessages: ['expected 500'] }],
        loadError: undefined,
        typecheckErrors: ["tests/health.test.ts(4,7): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'."],
      },
      { testFile: 'backend/tests/config.test.ts', failingCases: [], loadError: 'Cannot find module', typecheckErrors: [] },
    ]);
  });
});
