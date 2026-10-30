import type { CoverageByFile, FileCoverage } from '../analyze/coverage.ts';
import type { VerifyResult, WorkspaceResult } from '../orchestrator.ts';
import type { StageUsage } from '../run-stage.ts';

export type Fraction = { covered: number; total: number };

export type CoverageTotals = { statements: Fraction; branches: Fraction };

export type UsageSummary = {
  model: string;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMilliseconds: number;
};

export type ExistingTestChange = {
  testFile: string;
  name: string;
  kind: 'modified' | 'deleted';
  expectsBefore: number;
  expectsAfter: number;
  fewerAssertions: boolean;
};

export type WorkspaceReport = {
  name: string;
  skillsUsed: string[];
  verify: VerifyResult;
  coverage: {
    before: CoverageTotals;
    after: CoverageTotals;
    files: { sourceFile: string; before?: FileCoverage; after?: FileCoverage }[];
  };
  addedCases: { testFile: string; names: string[] }[];
  existingTestsChanged: ExistingTestChange[];
  droppedByReview: { sourceFile: string; name: string; reason: string }[];
  rejectedByChecks: { name: string; reason: string }[];
  skipped: { sourceFile: string; reason: string }[];
  fullyCovered: string[];
  removedCases: { testFile: string; name: string }[];
  revertedCases: { testFile: string; name: string }[];
  revertedFiles: string[];
  remainingFailures: { testFile: string; cases: string[] }[];
  fixerNotes: string[];
};

export type RunReport = {
  mode: 'repo';
  workspaces: WorkspaceReport[];
  usage: UsageSummary[];
  summary?: string;
};

export function totalCoverage(coverage: CoverageByFile): CoverageTotals {
  const totals: CoverageTotals = { statements: { covered: 0, total: 0 }, branches: { covered: 0, total: 0 } };
  for (const fileCoverage of coverage.values()) {
    totals.statements.covered += fileCoverage.statements.covered;
    totals.statements.total += fileCoverage.statements.total;
    totals.branches.covered += fileCoverage.branches.covered;
    totals.branches.total += fileCoverage.branches.total;
  }
  return totals;
}

export function summariseUsage(usages: StageUsage[]) {
  const summaries = new Map<string, UsageSummary>();
  for (const usage of usages) {
    const summary = summaries.get(usage.model) ?? {
      model: usage.model,
      sessions: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      durationMilliseconds: 0,
    };
    summary.sessions += 1;
    summary.inputTokens += usage.inputTokens + usage.cacheReadTokens;
    summary.outputTokens += usage.outputTokens;
    summary.costUsd += usage.costUsd;
    summary.durationMilliseconds += usage.durationMilliseconds;
    summaries.set(usage.model, summary);
  }
  return [...summaries.values()];
}

function changedSourceFiles(result: WorkspaceResult) {
  return [
    ...new Set(
      result.batches.flatMap((batch) => batch.decisions.filter((decision) => decision.verdict === 'keep').map((decision) => decision.sourceFile)),
    ),
  ].sort();
}

export function buildWorkspaceReport(result: WorkspaceResult): WorkspaceReport {
  const batches = result.batches;
  return {
    name: result.name,
    skillsUsed: [result.skill, 'reading-test-results'],
    verify: result.verify,
    coverage: {
      before: totalCoverage(result.coverageBefore),
      after: totalCoverage(result.coverageAfter),
      files: changedSourceFiles(result).map((sourceFile) => ({
        sourceFile,
        before: result.coverageBefore.get(sourceFile),
        after: result.coverageAfter.get(sourceFile),
      })),
    },
    addedCases: result.testFileChanges
      .map(({ testFile, changes }) => ({ testFile, names: changes.filter((change) => change.kind === 'added').map((change) => change.name) }))
      .filter((file) => file.names.length > 0),
    existingTestsChanged: result.testFileChanges.flatMap(({ testFile, changes }) =>
      changes.flatMap((change): ExistingTestChange[] => {
        if (change.kind === 'modified') {
          return [{ testFile, name: change.name, kind: 'modified', expectsBefore: change.expectsBefore, expectsAfter: change.expectsAfter, fewerAssertions: change.expectsAfter < change.expectsBefore }];
        }
        if (change.kind === 'deleted') {
          return [{ testFile, name: change.name, kind: 'deleted', expectsBefore: change.expectCount, expectsAfter: 0, fewerAssertions: true }];
        }
        return [];
      }),
    ),
    droppedByReview: batches.flatMap((batch) =>
      batch.decisions
        .filter((decision) => decision.verdict === 'drop')
        .map((decision) => ({ sourceFile: decision.sourceFile, name: decision.name, reason: decision.verdictReason })),
    ),
    rejectedByChecks: batches.flatMap((batch) => batch.rejectedCases.map(({ plannedCase, reason }) => ({ name: plannedCase.name, reason }))),
    skipped: batches.flatMap((batch) => batch.skipped),
    fullyCovered: result.fullyCovered,
    removedCases: batches.flatMap((batch) => batch.removedCases),
    revertedCases: batches.flatMap((batch) => batch.revertedCases),
    revertedFiles: batches.flatMap((batch) => batch.revertedFiles),
    remainingFailures: batches.flatMap((batch) =>
      batch.remainingFailures.map((failure) => ({ testFile: failure.testFile, cases: failure.failingCases.map((failingCase) => failingCase.fullName) })),
    ),
    fixerNotes: batches.flatMap((batch) => batch.fixerNotes),
  };
}

export function buildRunReport(results: WorkspaceResult[]): RunReport {
  return {
    mode: 'repo',
    workspaces: results.map(buildWorkspaceReport),
    usage: summariseUsage(results.flatMap((result) => result.usages)),
  };
}
