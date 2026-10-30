import type { FileCoverage } from '../analyze/coverage.ts';
import type { Fraction, RunReport, WorkspaceReport } from './report.ts';

export function escapeMarkdown(text: string) {
  return text
    .replace(/[\\`*_{}[\]<>|#]/g, (character) => `\\${character}`)
    .replace(/@/g, '@​')
    .replace(/\r?\n/g, ' ');
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

function renderWorkspace(workspace: WorkspaceReport) {
  const lines: string[] = [`## ${escapeMarkdown(workspace.name)}`, ''];
  const { verify, coverage } = workspace;
  lines.push(
    `Typecheck ${verify.typecheckPassed ? 'passed' : 'failed'}. Tests: ${verify.testsPassed} passed, ${verify.testsFailed} failed. Repository coverage thresholds ${verify.repositoryThresholdsPassed ? 'met' : 'not met'}.`,
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
      lines.push(`| \`${escapeMarkdown(file.sourceFile)}\` | ${fileCoverageCell(file.before)} | ${fileCoverageCell(file.after)} |`);
    }
    lines.push('');
  }
  if (workspace.existingTestsChanged.length > 0) {
    lines.push('### Existing tests changed', '');
    lines.push(
      list(workspace.existingTestsChanged, (change) => {
        const flag = change.fewerAssertions ? ' **fewer assertions**' : '';
        return `${change.kind === 'deleted' ? 'deleted' : 'changed'} \`${escapeMarkdown(change.testFile)}\`: ${escapeMarkdown(change.name)} (assertions ${change.expectsBefore} → ${change.expectsAfter})${flag}`;
      }),
      '',
    );
  }
  if (workspace.changedOutsideCases.length > 0) {
    lines.push('### Existing test files changed outside their cases', '');
    lines.push(
      list(workspace.changedOutsideCases, (change) => `\`${escapeMarkdown(change.testFile)}\`${change.shared ? ' **shared fixture or setup**' : ''}`),
      '',
    );
  }
  if (workspace.addedCases.length > 0) {
    lines.push('### New cases', '');
    for (const file of workspace.addedCases) {
      lines.push(`\`${escapeMarkdown(file.testFile)}\``, list(file.names, escapeMarkdown), '');
    }
  }
  const notDone = [
    ...workspace.remainingFailures.map((failure) => `still failing in \`${escapeMarkdown(failure.testFile)}\`: ${failure.cases.map(escapeMarkdown).join('; ')}`),
    ...workspace.removedCases.map((removed) => `removed after failing: \`${escapeMarkdown(removed.testFile)}\`: ${escapeMarkdown(removed.name)}`),
    ...workspace.revertedCases.map((reverted) => `restored after failing: \`${escapeMarkdown(reverted.testFile)}\`: ${escapeMarkdown(reverted.name)}`),
    ...workspace.revertedFiles.map((file) => `whole file restored: \`${escapeMarkdown(file)}\``),
  ];
  if (notDone.length > 0) lines.push('### Not done', '', list(notDone, (line) => line), '');
  if (workspace.droppedByReview.length > 0 || workspace.rejectedByChecks.length > 0) {
    lines.push(
      '### Dropped cases',
      '',
      lists(
        list(workspace.droppedByReview, (dropped) => `\`${escapeMarkdown(dropped.sourceFile)}\`: ${escapeMarkdown(dropped.name)}: ${escapeMarkdown(dropped.reason)}`),
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
        list(workspace.skipped, (skipped) => `\`${escapeMarkdown(skipped.sourceFile)}\`: ${escapeMarkdown(skipped.reason)}`),
        list(workspace.fullyCovered, (file) => `\`${escapeMarkdown(file)}\`: already tested and fully covered`),
      ),
      '',
    );
  }
  if (workspace.fixerNotes.length > 0) lines.push('### Notes from the fixer', '', list(workspace.fixerNotes, escapeMarkdown), '');
  lines.push(`Skills: ${workspace.skillsUsed.map((skill) => `\`${skill}\``).join(', ')}`, '');
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
