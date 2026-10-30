import { describe, expect, it } from 'vitest';
import { summariseCoverage } from '../src/analyze/coverage.ts';

describe('summariseCoverage', () => {
  it('reports uncovered lines and partly taken branches per repository path', () => {
    const report = {
      '/workspace/src/lib/http.ts': {
        path: '/workspace/src/lib/http.ts',
        statementMap: { '0': { start: { line: 3 } }, '1': { start: { line: 5 } }, '2': { start: { line: 5 } } },
        s: { '0': 2, '1': 0, '2': 0 },
        branchMap: { '0': { type: 'if', line: 4, loc: { start: { line: 4 } } }, '1': { type: 'cond-expr', loc: { start: { line: 9 } } } },
        b: { '0': [2, 0], '1': [1, 1] },
      },
    };
    expect(summariseCoverage(report, 'frontend').get('frontend/src/lib/http.ts')).toEqual({
      statements: { covered: 1, total: 3 },
      branches: { covered: 3, total: 4 },
      uncoveredLines: [5],
      uncoveredBranches: [{ line: 4, type: 'if', takenOutcomes: 1, totalOutcomes: 2 }],
    });
  });
});
