import type { FileCoverage } from '../analyze/coverage.ts';
import type { BaseCheckCase } from '../analyze/base-check.ts';
import type { PullRequestResult } from '../orchestrator.ts';
import type { Fraction, RunReport, WorkspaceReport } from './report.ts';

export function escapeMarkdown(text: string) {
  return text
    .replace(/[\\`*_{}[\]<>|#]/g, (character) => `\\${character}`)
    .replace(/@/g, '@​')
    .replace(/\r?\n/g, ' ');
}

// Backslash escapes are literal inside a code span, so only what can end the span or the line is replaced.
export function escapeCode(text: string) {
  return text.replace(/`/g, "'").replace(/\r?\n/g, ' ');
}

function percentage({ covered, total }: Fraction) {
  return total === 0 ? '–' : `${((covered / total) * 100).toFixed(1)}%`;
}

function fileCoverageCell(coverage: FileCoverage | undefined) {
  if (!coverage) return '–';
  return `${percentage(coverage.statements)} / ${percentage(coverage.branches)}`;
}

function list<Item>(items: Item[], render: (item: Item) => string) {
  return items.map((item) => `- ${render(item)}`).join('\n');
}

function lists(...renderedLists: string[]) {
  return renderedLists.filter((renderedList) => renderedList.length > 0).join('\n');
}

function renderPullRequestScope({ brokenTests, leftOutByCap, deletedSources }: PullRequestResult) {
  const lines: string[] = [];
  if (brokenTests.length > 0) {
    lines.push(
      `### Your PR breaks ${brokenTests.length} existing test ${brokenTests.length === 1 ? 'file' : 'files'}`,
      '',
      'These failed on the PR head before the agent changed anything. Check whether each change in behaviour is intended.',
      '',
      list(brokenTests, (broken) => `\`${escapeCode(broken.testFile)}\`: ${broken.outcome}`),
      '',
    );
  }
  if (leftOutByCap.length > 0) {
    lines.push(`**Partial run:** ${leftOutByCap.length} changed source files over the limit were left out:`, '', list(leftOutByCap, (file) => `\`${escapeCode(file)}\``), '');
  }
  if (deletedSources.length > 0) {
    lines.push('Source files deleted in this PR. The agent leaves their tests in place:', '', list(deletedSources, (file) => `\`${escapeCode(file)}\``), '');
  }
  return lines;
}

function renderBaseCheck(baseCheck: BaseCheckCase[]) {
  const withOutcome = (outcome: BaseCheckCase['outcome']) => baseCheck.filter((result) => result.outcome === outcome);
  const passing = withOutcome('passes on base');
  const inconclusive = withOutcome('inconclusive');
  const lines = [
    '### Checked against the base code',
    '',
    `The new and changed cases ran against the base versions of the changed source files: ${withOutcome('fails on base').length} fail there, as a test of the change should, ${passing.length} pass there too, ${inconclusive.length} inconclusive.`,
    '',
  ];
  if (passing.length > 0) {
    lines.push('Passing on base. These may test behaviour the PR didn\'t change, which is fine, or miss the change, which isn\'t:', '', list(passing, (result) => `\`${escapeCode(result.testFile)}\`: ${escapeMarkdown(result.name)}`), '');
  }
  if (inconclusive.length > 0) {
    lines.push('Inconclusive, usually because the code they test is new in the PR:', '', list(inconclusive, (result) => `\`${escapeCode(result.testFile)}\`: ${escapeMarkdown(result.name)}`), '');
  }
  return lines;
}

function renderWorkspace(workspace: WorkspaceReport) {
  const lines: string[] = [`## ${escapeMarkdown(workspace.name)}`, ''];
  if (!workspace.applied) lines.push('**The changes were not applied, because verify failed.**', '');
  if (workspace.pullRequest) lines.push(...renderPullRequestScope(workspace.pullRequest));
  const { verify, coverage } = workspace;
  lines.push(
    `Typecheck ${verify.typecheckPassed ? 'passed' : 'failed'}. Tests: ${verify.testsPassed} passed, ${verify.testsFailed} failed. Repository coverage thresholds ${verify.repositoryThresholds}.`,
    '',
    '| Coverage | Before | After |',
    '|---|---|---|',
    `| Statements | ${percentage(coverage.before.statements)} | ${percentage(coverage.after.statements)} |`,
    `| Branches | ${percentage(coverage.before.branches)} | ${percentage(coverage.after.branches)} |`,
    '',
  );
  if (coverage.files.length > 0) {
    lines.push('| File (statements / branches) | Before | After |', '|---|---|---|');
    for (const file of coverage.files) {
      lines.push(`| \`${escapeCode(file.sourceFile).replace(/\|/g, '\\|')}\` | ${fileCoverageCell(file.before)} | ${fileCoverageCell(file.after)} |`);
    }
    lines.push('');
  }
  if (workspace.existingTestsChanged.length > 0) {
    lines.push('### Existing tests changed', '');
    lines.push(
      list(workspace.existingTestsChanged, (change) => {
        const flag = change.fewerAssertions ? ' **fewer assertions**' : '';
        return `${change.kind === 'deleted' ? 'deleted' : 'changed'} \`${escapeCode(change.testFile)}\`: ${escapeMarkdown(change.name)} (assertions ${change.expectsBefore} → ${change.expectsAfter})${flag}`;
      }),
      '',
    );
  }
  if (workspace.changedOutsideCases.length > 0) {
    lines.push('### Existing test files changed outside their cases', '');
    lines.push(
      list(workspace.changedOutsideCases, (change) => `\`${escapeCode(change.testFile)}\`${change.shared ? ' **shared fixture or setup**' : ''}`),
      '',
    );
  }
  if (workspace.addedCases.length > 0) {
    lines.push('### New cases', '');
    for (const file of workspace.addedCases) {
      lines.push(`\`${escapeCode(file.testFile)}\``, list(file.names, escapeMarkdown), '');
    }
  }
  if (workspace.pullRequest && workspace.pullRequest.baseCheck.length > 0) lines.push(...renderBaseCheck(workspace.pullRequest.baseCheck));
  if (workspace.flakyCases.length > 0) {
    lines.push(
      '### Flaky cases',
      '',
      'These both passed and failed across shuffled reruns. The agent removes its own new cases and restores changed ones; existing cases stay as they are.',
      '',
      list(workspace.flakyCases, (flakyCase) => `\`${escapeCode(flakyCase.testFile)}\`: ${escapeMarkdown(flakyCase.name)}: ${flakyCase.outcome}`),
      '',
    );
  }
  const notDone = [
    ...workspace.failedBatches.map((failed) => `batch \`${escapeCode(failed.module)}\` failed and was rolled back: ${escapeMarkdown(failed.reason)}`),
    ...workspace.remainingFailures.map((failure) => `still failing in \`${escapeCode(failure.testFile)}\`: ${failure.cases.map(escapeMarkdown).join('; ')}`),
    ...workspace.removedCases.map((removed) => `removed after failing: \`${escapeCode(removed.testFile)}\`: ${escapeMarkdown(removed.name)}`),
    ...workspace.revertedCases.map((reverted) => `restored after failing: \`${escapeCode(reverted.testFile)}\`: ${escapeMarkdown(reverted.name)}`),
    ...workspace.revertedFiles.map((file) => `whole file restored: \`${escapeCode(file)}\``),
  ];
  if (notDone.length > 0) lines.push('### Not done', '', list(notDone, (line) => line), '');
  if (workspace.keptWithoutReview.length > 0) {
    lines.push(
      '### Kept without a review verdict',
      '',
      list(workspace.keptWithoutReview, (kept) => `\`${escapeCode(kept.testFile)}\`: ${escapeMarkdown(kept.name)}`),
      '',
    );
  }
  if (workspace.droppedByReview.length > 0 || workspace.rejectedByChecks.length > 0) {
    lines.push(
      '### Dropped cases',
      '',
      lists(
        list(workspace.droppedByReview, (dropped) => `\`${escapeCode(dropped.sourceFile)}\`: ${escapeMarkdown(dropped.name)}: ${escapeMarkdown(dropped.reason)}`),
        list(workspace.rejectedByChecks, (rejected) => `${escapeMarkdown(rejected.name)}: ${escapeMarkdown(rejected.reason)}`),
      ),
      '',
    );
  }
  if (workspace.skipped.length > 0 || workspace.fullyCovered.length > 0) {
    lines.push(
      '### Skipped files',
      '',
      lists(
        list(workspace.skipped, (skipped) => `\`${escapeCode(skipped.sourceFile)}\`: ${escapeMarkdown(skipped.reason)}`),
        list(workspace.fullyCovered, (file) => `\`${escapeCode(file)}\`: already tested and fully covered`),
      ),
      '',
    );
  }
  if (workspace.fixerNotes.length > 0) lines.push('### Notes from the fixer', '', list(workspace.fixerNotes, escapeMarkdown), '');
  if (workspace.skillsUsed.length > 0) lines.push(`Skills: ${workspace.skillsUsed.map((skill) => `\`${skill}\``).join(', ')}`, '');
  return lines.join('\n');
}

export function renderMarkdownReport(report: RunReport) {
  const lines = ['# Test agent report', ''];
  if (report.summary) for (const paragraph of report.summary.split('\n\n')) lines.push(escapeMarkdown(paragraph), '');
  for (const workspace of report.workspaces) lines.push(renderWorkspace(workspace));
  lines.push('## Usage', '', '| Model | Sessions | Tokens in | Tokens out | Cost | Time |', '|---|---|---|---|---|---|');
  for (const usage of report.usage) {
    lines.push(
      `| ${usage.model} | ${usage.sessions} | ${usage.inputTokens} | ${usage.outputTokens} | $${usage.costUsd.toFixed(2)} | ${(usage.durationMilliseconds / 1000).toFixed(0)}s |`,
    );
  }
  return `${lines.join('\n')}\n`;
}
