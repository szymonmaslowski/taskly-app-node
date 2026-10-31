import type { Fraction, RunReport, WorkspaceReport } from './report.ts';

function percentage({ covered, total }: Fraction) {
  return total === 0 ? 'n/a' : `${Math.round((covered / total) * 100)}%`;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function attentionSentences(workspace: WorkspaceReport) {
  const sentences: string[] = [];
  if (!workspace.applied) sentences.push('Verify failed, so the changes were not applied.');
  const broken = workspace.pullRequest?.brokenTests ?? [];
  if (broken.length > 0) {
    const leftFailing = broken.filter((test) => test.outcome === 'left failing').length;
    const updated = broken.filter((test) => test.outcome === 'updated by the agent').length;
    sentences.push(`This PR breaks ${plural(broken.length, 'existing test file')}: ${updated} updated by the agent, ${leftFailing} left failing.`);
  }
  if ((workspace.pullRequest?.leftOutByCap.length ?? 0) > 0) sentences.push('The run is partial: some changed files were over the limit.');
  const failedBatches = workspace.failedBatches.length;
  if (failedBatches > 0) sentences.push(`${plural(failedBatches, 'batch', 'batches')} failed and ${failedBatches === 1 ? 'was' : 'were'} rolled back.`);
  const stillFailing = workspace.remainingFailures.length;
  if (stillFailing > 0) sentences.push(`${plural(stillFailing, 'test file')} still ${stillFailing === 1 ? 'fails' : 'fail'}.`);
  const fewerAssertions = workspace.existingTestsChanged.filter((change) => change.fewerAssertions).length;
  if (workspace.existingTestsChanged.length > 0) {
    const detail = fewerAssertions > 0 ? `, ${fewerAssertions} with fewer assertions` : '';
    sentences.push(`${plural(workspace.existingTestsChanged.length, 'existing test')} changed${detail}; check those first.`);
  }
  const outside = workspace.changedOutsideCases.length;
  if (outside > 0) {
    const shared = workspace.changedOutsideCases.filter((change) => change.shared).length;
    const detail = shared > 0 ? `, ${shared} of them shared fixtures or setup` : '';
    sentences.push(`${plural(outside, 'existing test file')} changed outside ${outside === 1 ? 'its' : 'their'} cases${detail}; check those too.`);
  }
  const cleanups = [
    [workspace.removedCases.length, 'new case', 'removed'],
    [workspace.revertedCases.length, 'changed case', 'restored'],
    [workspace.revertedFiles.length, 'test file', 'restored'],
  ] as const;
  const cleanupParts = cleanups
    .filter(([count]) => count > 0)
    .map(([count, noun, verb]) => `${plural(count, noun)} ${count === 1 ? 'was' : 'were'} ${verb}`);
  if (cleanupParts.length > 0) sentences.push(`After failing, ${cleanupParts.join(' and ')}.`);
  return sentences;
}

function workspaceSummary(workspace: WorkspaceReport) {
  const newCases = workspace.addedCases.reduce((count, file) => count + file.names.length, 0);
  const sentences = [
    ...attentionSentences(workspace),
    `${plural(newCases, 'new case')} in ${plural(workspace.addedCases.length, 'test file')}${workspace.existingTestsChanged.length === 0 ? ', no existing test changed' : ''}.`,
    `Typecheck ${workspace.verify.typecheckPassed ? 'passes' : 'fails'}; ${workspace.verify.testsPassed} tests pass, ${workspace.verify.testsFailed} fail.`,
    `Coverage: statements ${percentage(workspace.coverage.before.statements)} → ${percentage(workspace.coverage.after.statements)}, branches ${percentage(workspace.coverage.before.branches)} → ${percentage(workspace.coverage.after.branches)}.`,
  ];
  if (workspace.keptWithoutReview.length > 0) {
    sentences.push(`${plural(workspace.keptWithoutReview.length, 'planned case')} kept without a review verdict.`);
  }
  if (workspace.droppedByReview.length > 0) sentences.push(`Review dropped ${plural(workspace.droppedByReview.length, 'planned case')}.`);
  return `${workspace.name}: ${sentences.join(' ')}`;
}

export function buildSummary(report: RunReport) {
  if (report.workspaces.length === 0) {
    return report.mode === 'pr' ? 'No source files the agent covers changed in this pull request.' : 'No workspace had work to do.';
  }
  return report.workspaces.map(workspaceSummary).join('\n\n');
}
