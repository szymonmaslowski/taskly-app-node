import { describe, expect, it } from 'vitest';
import type { FileCoverage } from '../src/analyze/coverage.ts';
import type { WorkspaceResult } from '../src/orchestrator.ts';
import { escapeCode, escapeMarkdown, renderMarkdownReport } from '../src/report/markdown.ts';
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
  skillsByStage: {
    plan: ['unit-test-principles', 'unit-test-planning', 'backend-unit-tests', 'backend-unit-tests/planning.md'],
    planReview: ['unit-test-principles', 'unit-test-reviewing', 'backend-unit-tests', 'backend-unit-tests/planning.md'],
    write: ['unit-test-principles', 'unit-test-writing', 'backend-unit-tests', 'backend-unit-tests/writing.md'],
    fix: ['unit-test-principles', 'unit-test-writing', 'reading-test-results', 'backend-unit-tests', 'backend-unit-tests/writing.md'],
    lastFix: ['unit-test-principles', 'unit-test-writing', 'reading-test-results', 'backend-unit-tests', 'backend-unit-tests/writing.md'],
    implReview: ['unit-test-principles', 'unit-test-reviewing', 'unit-test-reviewing/code.md', 'backend-unit-tests', 'backend-unit-tests/reviewing.md'],
  },
  coverageBefore: new Map([['backend/src/api/health.ts', coverage(0, 0)]]),
  coverageAfter: new Map([['backend/src/api/health.ts', coverage(10, 4)]]),
  verify: { typecheckPassed: true, testsPassed: 50, testsFailed: 0, repositoryThresholds: 'met' },
  applied: true,
  fullyCovered: [],
  batches: [
    {
      module: 'backend/src/api',
      decisions: [
        { id: 'c1', name: 'reports ok', behaviour: 'b', catches: 'a bug', reason: 'r', overlap: 'none', updatesExistingTest: false, sourceFile: 'backend/src/api/health.ts', testFile: 'backend/tests/health.test.ts', verdict: 'keep', verdictReason: 'ok', reviewed: true },
        { id: 'c2', name: 'checks the query', behaviour: 'b', catches: 'a bug', reason: 'r', overlap: 'none', updatesExistingTest: false, sourceFile: 'backend/src/api/health.ts', testFile: 'backend/tests/health.test.ts', verdict: 'drop', verdictReason: 'Only asserts a mock call.', reviewed: true },
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
  changedOutsideCases: [],
  implReview: [],
  flaky: { cases: [], removedCases: [], revertedCases: [], revertedFiles: [] },
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

  it('lists kept cases the reviewer gave no verdict on', () => {
    const decisions = result.batches[0].decisions.map((decision) => ({ ...decision, reviewed: decision.verdict === 'drop' }));
    const unreviewed: WorkspaceResult = { ...result, batches: [{ ...result.batches[0], decisions }] };
    const report = buildRunReport([unreviewed]);
    expect(report.workspaces[0].keptWithoutReview).toEqual([{ testFile: 'backend/tests/health.test.ts', name: 'reports ok' }]);
    expect(buildSummary(report)).toContain('1 planned case kept without a review verdict.');
  });

  it('puts the existing tests a pull request breaks first, with what happened to each', () => {
    const pullRequest: WorkspaceResult = {
      ...result,
      pullRequest: {
        brokenTests: [
          { testFile: 'backend/tests/validators.test.ts', outcome: 'updated by the agent' },
          { testFile: 'backend/tests/router.test.ts', outcome: 'left failing' },
        ],
        baseCheck: [],
        leftOutByCap: ['backend/src/mappers.ts'],
        deletedSources: [],
      },
    };
    const report = buildRunReport([pullRequest], 'pr');
    const markdown = renderMarkdownReport(report);
    expect(report.mode).toBe('pr');
    expect(markdown).toContain('### Your PR breaks 2 existing test files');
    expect(markdown).toContain('- `backend/tests/router.test.ts`: left failing');
    expect(markdown.indexOf('### Your PR breaks')).toBeLessThan(markdown.indexOf('| Coverage |'));
    expect(buildSummary(report)).toMatch(/^backend: This PR breaks 2 existing test files: 1 updated by the agent, 1 left failing\. The run is partial/);
  });

  it('lists the skills of the stages that ran', () => {
    expect(buildRunReport([result]).workspaces[0].skillsUsed).toEqual(['unit-test-principles', 'unit-test-planning', 'backend-unit-tests', 'unit-test-reviewing', 'unit-test-writing']);
    const fixed: WorkspaceResult = { ...result, batches: [{ ...result.batches[0], fixAttempts: 1 }] };
    expect(buildRunReport([fixed]).workspaces[0].skillsUsed).toContain('reading-test-results');
  });

  it('flags test files changed outside their cases, shared ones loudest', () => {
    const changed: WorkspaceResult = { ...result, changedOutsideCases: [{ testFile: 'backend/tests/fixture.ts', shared: true }] };
    const report = buildRunReport([changed]);
    expect(renderMarkdownReport(report)).toContain('`backend/tests/fixture.ts` **shared fixture or setup**');
    expect(buildSummary(report)).toContain('1 existing test file changed outside its cases, 1 of them shared fixtures or setup; check those too.');
  });

  it('reports which new cases notice the change when run against the base code', () => {
    const checked: WorkspaceResult = {
      ...result,
      pullRequest: {
        brokenTests: [],
        baseCheck: [
          { testFile: 'backend/tests/health.test.ts', name: 'health reports ok', outcome: 'fails on base' },
          { testFile: 'backend/tests/health.test.ts', name: 'health keeps the status', outcome: 'passes on base' },
          { testFile: 'backend/tests/filters.test.ts', name: 'filters by due date', outcome: 'inconclusive' },
        ],
        leftOutByCap: [],
        deletedSources: [],
      },
    };
    const report = buildRunReport([checked], 'pr');
    const markdown = renderMarkdownReport(report);
    expect(markdown).toContain('1 fail there, as a test of the change should, 1 pass there too, 1 inconclusive.');
    expect(markdown).toContain('- `backend/tests/health.test.ts`: health keeps the status');
    expect(buildSummary(report)).toContain('On the base code, 1 of the 3 new or changed cases fail, 1 pass and 1 is inconclusive.');
  });

  it('reports the review of the written tests and whether it sent them back', () => {
    const finding = { testFile: 'backend/tests/health.test.ts', caseName: 'reports ok', severity: 'major' as const, rule: 'AP4', issue: 'Asserts only the status.', fix: 'Assert the body too.' };
    const reviewed: WorkspaceResult = { ...result, implReview: [{ findings: [finding], revised: true }] };
    const report = buildRunReport([reviewed]);
    expect(renderMarkdownReport(report)).toContain('- **major** `backend/tests/health.test.ts`: reports ok: Asserts only the status. (AP4)');
    expect(buildSummary(report)).toContain('The test review sent the tests back to the writer once.');
    expect(report.workspaces[0].skillsUsed).toContain('unit-test-reviewing');
  });

  it('reports flaky cases with what the agent did to each', () => {
    const flaky: WorkspaceResult = {
      ...result,
      flaky: {
        cases: [
          { testFile: 'backend/tests/health.test.ts', name: 'health reports ok' },
          { testFile: 'backend/tests/router.test.ts', name: 'router lists tasks' },
        ],
        removedCases: [{ testFile: 'backend/tests/health.test.ts', name: 'health reports ok' }],
        revertedCases: [],
        revertedFiles: [],
      },
    };
    const report = buildRunReport([flaky]);
    expect(report.workspaces[0].flakyCases.map((flakyCase) => flakyCase.outcome)).toEqual(['removed', 'left as is']);
    expect(renderMarkdownReport(report)).toContain('- `backend/tests/router.test.ts`: router lists tasks: left as is');
    expect(buildSummary(report)).toContain('2 flaky cases found in shuffled reruns; 1 of them existing tests the agent left as they are.');
  });

  it('renders the changed existing tests before the new cases', () => {
    const markdown = renderMarkdownReport(buildRunReport([result]));
    expect(markdown.indexOf('### Existing tests changed')).toBeLessThan(markdown.indexOf('### New cases'));
    expect(markdown).toContain('**fewer assertions**');
  });
});

describe('escapeCode', () => {
  it('keeps underscores readable and stops a backtick from closing the span', () => {
    expect(escapeCode('tests/foo_bar.test.ts')).toBe('tests/foo_bar.test.ts');
    expect(escapeCode('tests/a`**b**.test.ts')).toBe("tests/a'**b**.test.ts");
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
        { ...result.batches[0], module: 'backend/src/core', decisions: [], error: 'Stage test-writer timed out after 15 minutes' },
      ],
    };
    const summary = buildSummary(buildRunReport([{ ...failing, applied: false }]));
    expect(summary).toMatch(/^backend: Verify failed, so the changes were not applied\./);
    expect(summary).toContain('1 test file still fails.');
    expect(summary).toContain('After failing, 1 new case was removed.');
    expect(summary).toContain('1 batch failed and was rolled back.');
    expect(summary).toContain('no existing test changed');
  });

  it('says so when a pull request changed no source file the agent covers', () => {
    const report = buildRunReport([], 'pr');
    expect(buildSummary(report)).toBe('No source files the agent covers changed in this pull request.');
    expect(renderMarkdownReport({ ...report, summary: buildSummary(report) })).toContain('No source files the agent covers changed in this pull request.');
  });
});
