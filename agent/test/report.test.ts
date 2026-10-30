import { describe, expect, it } from 'vitest';
import type { FileCoverage } from '../src/analyze/coverage.ts';
import type { WorkspaceResult } from '../src/orchestrator.ts';
import { escapeMarkdown, renderMarkdownReport } from '../src/report/markdown.ts';
import { buildRunReport, summariseUsage, totalCoverage } from '../src/report/report.ts';
import { buildSummary } from '../src/report/summary.ts';

function coverage(statementsCovered: number, branchesCovered: number): FileCoverage {
  return {
    statements: { covered: statementsCovered, total: 10 },
    branches: { covered: branchesCovered, total: 4 },
    uncoveredLines: [],
    uncoveredBranches: [],
  };
}

const usage = { model: 'claude-sonnet-5-5', inputTokens: 100, outputTokens: 20, cacheReadTokens: 50, costUsd: 0.1, durationMilliseconds: 2000, turns: 3 };

const result: WorkspaceResult = {
  name: 'backend',
  skill: 'backend-unit-tests',
  coverageBefore: new Map([['backend/src/api/health.ts', coverage(0, 0)]]),
  coverageAfter: new Map([['backend/src/api/health.ts', coverage(10, 4)]]),
  verify: { typecheckPassed: true, testsPassed: 50, testsFailed: 0, repositoryThresholdsPassed: true },
  fullyCovered: [],
  batches: [
    {
      module: 'backend/src/api',
      decisions: [
        { id: 'c1', name: 'reports ok', behaviour: 'b', reason: 'r', overlap: 'none', updatesExistingTest: false, sourceFile: 'backend/src/api/health.ts', testFile: 'backend/tests/health.test.ts', verdict: 'keep', verdictReason: 'ok' },
        { id: 'c2', name: 'checks the query', behaviour: 'b', reason: 'r', overlap: 'none', updatesExistingTest: false, sourceFile: 'backend/src/api/health.ts', testFile: 'backend/tests/health.test.ts', verdict: 'drop', verdictReason: 'Only asserts a mock call.' },
      ],
      rejectedCases: [],
      skipped: [],
      fixAttempts: 0,
      remainingFailures: [],
      removedCases: [],
      revertedCases: [],
      revertedFiles: [],
      fixerNotes: [],
    },
  ],
  changes: { added: ['backend/tests/health.test.ts'], modified: ['backend/tests/router.test.ts'], deleted: [], symbolicLinks: [] },
  testFileChanges: [
    { testFile: 'backend/tests/health.test.ts', changes: [{ kind: 'added', name: 'reports ok', expectCount: 2 }] },
    {
      testFile: 'backend/tests/router.test.ts',
      changes: [{ kind: 'modified', name: 'lists tasks', expectsBefore: 3, expectsAfter: 1, before: 'a', after: 'b' }],
    },
  ],
  usages: [usage, { ...usage, costUsd: 0.2 }],
};

describe('totalCoverage', () => {
  it('adds up statements and branches over all files', () => {
    expect(totalCoverage(new Map([['a', coverage(2, 1)], ['b', coverage(3, 2)]]))).toEqual({
      statements: { covered: 5, total: 20 },
      branches: { covered: 3, total: 8 },
    });
  });
});

describe('summariseUsage', () => {
  it('groups sessions by model and counts cached input as input', () => {
    expect(summariseUsage(result.usages)).toEqual([
      { model: 'claude-sonnet-5-5', sessions: 2, inputTokens: 300, outputTokens: 40, costUsd: expect.closeTo(0.3), durationMilliseconds: 4000 },
    ]);
  });
});

describe('buildRunReport', () => {
  it('lists new cases, flags changed existing tests that lost assertions and keeps review drops with reasons', () => {
    const [workspace] = buildRunReport([result]).workspaces;
    expect(workspace.addedCases).toEqual([{ testFile: 'backend/tests/health.test.ts', names: ['reports ok'] }]);
    expect(workspace.existingTestsChanged).toEqual([
      { testFile: 'backend/tests/router.test.ts', name: 'lists tasks', kind: 'modified', expectsBefore: 3, expectsAfter: 1, fewerAssertions: true },
    ]);
    expect(workspace.droppedByReview).toEqual([{ sourceFile: 'backend/src/api/health.ts', name: 'checks the query', reason: 'Only asserts a mock call.' }]);
    expect(workspace.coverage.files).toEqual([{ sourceFile: 'backend/src/api/health.ts', before: coverage(0, 0), after: coverage(10, 4) }]);
  });

  it('renders the changed existing tests before the new cases', () => {
    const markdown = renderMarkdownReport(buildRunReport([result]));
    expect(markdown.indexOf('### Existing tests changed')).toBeLessThan(markdown.indexOf('### New cases'));
    expect(markdown).toContain('**fewer assertions**');
  });
});

describe('escapeMarkdown', () => {
  it('neutralises mentions, table separators, markup and line breaks', () => {
    expect(escapeMarkdown('@octocat | <img src=x>\n# heading')).toBe('@​octocat \\| \\<img src=x\\> \\# heading');
  });
});

describe('buildSummary', () => {
  it('puts what needs attention first, then new cases, the verify result and coverage', () => {
    expect(buildSummary(buildRunReport([result]))).toBe(
      'backend: 1 existing test changed, 1 with fewer assertions; check those first. 1 new case in 1 test file. ' +
        'Typecheck passes; 50 tests pass, 0 fail. Coverage: statements 0% → 100%, branches 0% → 100%. Review dropped 1 planned case.',
    );
  });

  it('reports files that still fail and cases removed after failing', () => {
    const failing: WorkspaceResult = {
      ...result,
      testFileChanges: [result.testFileChanges[0]],
      batches: [
        {
          ...result.batches[0],
          remainingFailures: [{ testFile: 'backend/tests/health.test.ts', failingCases: [], typecheckErrors: [], bannedPatterns: [] }],
          removedCases: [{ testFile: 'backend/tests/health.test.ts', name: 'reports ok' }],
        },
      ],
    };
    const summary = buildSummary(buildRunReport([failing]));
    expect(summary).toContain('1 test file still fails.');
    expect(summary).toContain('After failing, 1 new case was removed.');
    expect(summary).toContain('no existing test changed');
  });
});
