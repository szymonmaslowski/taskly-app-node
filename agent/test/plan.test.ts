import { describe, expect, it } from 'vitest';
import { applyReview, numberCases, partitionPlannedCases } from '../src/stages/plan.ts';

const plan = {
  files: [
    {
      sourceFile: 'backend/src/api/health.ts',
      testFile: 'backend/tests/health.test.ts',
      cases: [
        { name: 'reports ok', behaviour: 'returns status ok', catches: 'a bug', reason: 'happy path', overlap: 'none', updatesExistingTest: false },
        { name: 'propagates errors', behaviour: 'fails when the database fails', catches: 'a bug', reason: 'error path', overlap: 'none', updatesExistingTest: false },
      ],
    },
    {
      sourceFile: 'backend/src/factory.ts',
      testFile: 'backend/src/factory.test.ts',
      cases: [{ name: 'serves docs', behaviour: 'serves the spec', catches: 'a bug', reason: 'contract', overlap: 'none', updatesExistingTest: false }],
    },
  ],
  skipped: [],
};

describe('numberCases', () => {
  it('gives every case a stable id and carries its files', () => {
    expect(numberCases(plan, 4).map(({ id, sourceFile, testFile }) => ({ id, sourceFile, testFile }))).toEqual([
      { id: 'c4', sourceFile: 'backend/src/api/health.ts', testFile: 'backend/tests/health.test.ts' },
      { id: 'c5', sourceFile: 'backend/src/api/health.ts', testFile: 'backend/tests/health.test.ts' },
      { id: 'c6', sourceFile: 'backend/src/factory.ts', testFile: 'backend/src/factory.test.ts' },
    ]);
  });
});

describe('partitionPlannedCases', () => {
  it('rejects cases for files outside the batch or test files outside the writable paths', () => {
    const cases = numberCases(plan);
    const { accepted, rejected } = partitionPlannedCases(cases, {
      sourceFiles: new Set(['backend/src/api/health.ts', 'backend/src/factory.ts']),
      isWritable: (repositoryPath) => repositoryPath.startsWith('backend/tests/'),
    });
    expect(accepted.map((plannedCase) => plannedCase.id)).toEqual(['c1', 'c2']);
    expect(rejected.map(({ plannedCase, reason }) => [plannedCase.id, reason])).toEqual([
      ['c3', "backend/src/factory.test.ts isn't a writable test path"],
    ]);
  });
});

describe('applyReview', () => {
  it('applies the verdicts and keeps cases the reviewer left out', () => {
    const decisions = applyReview(numberCases(plan), {
      verdicts: [{ caseId: 'c2', verdict: 'drop', reason: 'Duplicates an existing test.' }],
      missing: [],
    });
    expect(decisions.map(({ id, verdict, reviewed }) => [id, verdict, reviewed])).toEqual([
      ['c1', 'keep', false],
      ['c2', 'drop', true],
      ['c3', 'keep', false],
    ]);
  });
});
