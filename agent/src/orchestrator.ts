import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { z } from 'zod';
import { loadAgentDefinition, type AgentDefinition } from './agents.ts';
import type { CoverageByFile } from './analyze/coverage.ts';
import { measureCoverage, planRepositoryWork, type WorkBatch } from './analyze/repository.ts';
import { mapWithConcurrency } from './concurrency.ts';
import { loadConfig, type LoopConfig, type StageConfig, type WorkspaceConfig } from './config.ts';
import { collectFailures } from './failures.ts';
import { createBufferedLogger, type Logger } from './logger.ts';
import { isWritingAgent, runStage, type StageUsage } from './run-stage.ts';
import { createRunDirectories, removeRunDirectories, type RunDirectories } from './sandbox/directories.ts';
import { assertPrintablePaths, createMatcher, listTrackedFiles, readRegularFile } from './sandbox/files.ts';
import { buildImages } from './sandbox/images.ts';
import { checkRepositoryThresholds, installRunnerWorkspace, prepareRunnerWorkspace, runTests, runTypecheck } from './sandbox/runner.ts';
import { createStagingCopy, diffStagingCopy, findDisallowedChanges, type StagingChanges, type StagingManifest } from './sandbox/staging.ts';
import { applyStagingToRepository, syncStagingToRunner } from './sandbox/sync.ts';
import type { TestCaseResult } from './sandbox/test-results.ts';
import { loadSkill, loadSkillReference, type Skill } from './skills.ts';
import { applyReview, numberCases, partitionPlannedCases, type CaseDecision } from './stages/plan.ts';
import { buildFixPrompt, buildPlanPrompt, buildReviewPrompt, buildWritePrompt, type FileFailures } from './stages/prompts.ts';
import { fixOutputSchema, planOutputSchema, reviewOutputSchema, writeOutputSchema, type PlannedCase } from './stages/schemas.ts';
import { stageWiring, type StageName } from './stages.ts';
import { changesOutsideCases, compareTestFile, findCasesByRuntimeNames, matchFailingCases, removeCases, revertCases, type CaseChange } from './tests/test-changes.ts';
import { findBannedPatterns, newBannedPatterns } from './tests/test-cases.ts';

const maxRepositoryFileBytes = 2_000_000;

type StageAgents = Record<StageName, AgentDefinition>;

type WorkspaceContext = {
  name: string;
  repositoryRoot: string;
  knownFiles: Set<string>;
  testedFilesByTest: Map<string, string[]>;
  workspace: WorkspaceConfig;
  skills: Record<StageName, Skill[]>;
  agents: StageAgents;
  stages: Record<StageName, StageConfig>;
  loop: LoopConfig;
  directories: RunDirectories;
  manifest: StagingManifest;
  syncedPaths: Set<string>;
  logger: Logger;
  transcriptDirectory: string;
  usages: StageUsage[];
};

export type BatchResult = {
  module: string;
  decisions: CaseDecision[];
  rejectedCases: { plannedCase: PlannedCase; reason: string }[];
  skipped: { sourceFile: string; reason: string }[];
  fixAttempts: number;
  remainingFailures: FileFailures[];
  removedCases: { testFile: string; name: string }[];
  revertedCases: { testFile: string; name: string }[];
  revertedFiles: string[];
  fixerNotes: string[];
  error?: string;
};

export type TestFileChanges = {
  testFile: string;
  changes: CaseChange[];
};

export type ChangeOutsideCases = {
  testFile: string;
  shared: boolean;
};

export type VerifyResult = {
  typecheckPassed: boolean;
  testsPassed: number;
  testsFailed: number;
  repositoryThresholds: 'met' | 'not met' | 'not checked';
};

export type WorkspaceResult = {
  name: string;
  skillsByStage: Record<StageName, string[]>;
  coverageBefore: CoverageByFile;
  coverageAfter: CoverageByFile;
  verify: VerifyResult;
  applied: boolean;
  fullyCovered: string[];
  batches: BatchResult[];
  changes: StagingChanges;
  testFileChanges: TestFileChanges[];
  changedOutsideCases: ChangeOutsideCases[];
  usages: StageUsage[];
};

let transcriptCounter = 0;

type ContextStageOptions<Schema extends z.ZodType> = {
  stage: StageName;
  prompt: string;
  outputSchema: Schema;
};

async function runContextStage<Schema extends z.ZodType>(context: WorkspaceContext, options: ContextStageOptions<Schema>) {
  transcriptCounter += 1;
  const agent = context.agents[options.stage];
  const { model, effort, maxTurns, timeoutMinutes, maxBudgetUsd } = context.stages[options.stage];
  const { output, usages } = await runStage({
    agent,
    prompt: options.prompt,
    outputSchema: options.outputSchema,
    settings: { effort, maxTurns, timeoutMinutes, maxBudgetUsd },
    model,
    workingDirectory: context.directories.staging,
    logger: context.logger,
    maxOutputAttempts: context.loop.outputAttempts,
    transcriptFile: path.join(context.transcriptDirectory, `${String(transcriptCounter).padStart(3, '0')}-${agent.name}.jsonl`),
  });
  context.usages.push(...usages);
  return output;
}

async function checkStagingChanges(context: WorkspaceContext) {
  const changes = await diffStagingCopy(context.directories.staging, context.manifest);
  assertPrintablePaths([...changes.added, ...changes.modified, ...changes.deleted, ...changes.symbolicLinks]);
  if (changes.symbolicLinks.length > 0) throw new Error(`The agent created symbolic links: ${changes.symbolicLinks.join(', ')}`);
  const disallowed = findDisallowedChanges(changes, context.workspace);
  if (disallowed.length > 0) throw new Error(`The agent changed files outside the writable paths: ${disallowed.join(', ')}`);
  for (const changedPath of [...changes.added, ...changes.modified]) context.syncedPaths.add(changedPath);
  await syncStagingToRunner(context.directories.staging, context.directories.runner, context.workspace.root, [...context.syncedPaths]);
  return changes;
}

async function readOriginalFile(context: WorkspaceContext, repositoryPath: string) {
  if (!context.manifest.has(repositoryPath)) return undefined;
  return readRegularFile(path.join(context.repositoryRoot, repositoryPath), maxRepositoryFileBytes);
}

async function readStagedFile(context: WorkspaceContext, repositoryPath: string) {
  try {
    return await readRegularFile(path.join(context.directories.staging, repositoryPath), maxRepositoryFileBytes);
  } catch {
    return undefined;
  }
}

async function findNewBannedPatterns(context: WorkspaceContext, testFile: string) {
  const after = await readStagedFile(context, testFile);
  if (after === undefined) return [];
  const testedFiles = context.testedFilesByTest.get(testFile) ?? [];
  const options = { fileName: testFile, testedFiles, knownFiles: context.knownFiles };
  const before = await readOriginalFile(context, testFile);
  const patternsBefore = before === undefined ? [] : findBannedPatterns({ ...options, content: before });
  return newBannedPatterns(patternsBefore, findBannedPatterns({ ...options, content: after })).map(
    (pattern) => `${pattern.kind} at line ${pattern.line}`,
  );
}

async function findChangedCasesThatDidNotRun(context: WorkspaceContext, testFile: string, cases: TestCaseResult[]) {
  const workspacePath = testFile.slice(context.workspace.root.length + 1);
  const notRun = cases.filter((testCase) => testCase.file === workspacePath && testCase.status === 'skipped').map((testCase) => testCase.fullName);
  if (notRun.length === 0) return [];
  const current = await readStagedFile(context, testFile);
  if (current === undefined) return [];
  const changedNames = new Set(compareTestFile(testFile, await readOriginalFile(context, testFile), current).map((change) => change.name));
  return findCasesByRuntimeNames(testFile, current, notRun)
    .filter((testCase) => changedNames.has(testCase.name))
    .map((testCase) => `"${testCase.name}" did not run`);
}

type TestRunScope = {
  testFiles: string[];
  scannedFiles: string[];
};

async function runTouchedTests(context: WorkspaceContext, { testFiles, scannedFiles }: TestRunScope, attemptLabel: string) {
  const { logger, workspace, directories } = context;
  if (testFiles.length === 0 && scannedFiles.length === 0) return [];
  logger.startStep(`run · ${attemptLabel}`);
  const typecheck = await runTypecheck(directories.runner, directories.output, workspace);
  const prefix = `${workspace.root}/`;
  const testRun =
    testFiles.length === 0
      ? { cases: [], fileErrors: [] }
      : await runTests({
          workspaceDirectory: directories.runner,
          outputDirectory: directories.output,
          workspace,
          testFiles: testFiles.map((testFile) => testFile.slice(prefix.length)),
        });
  const failures = collectFailures({
    workspaceRoot: workspace.root,
    testFiles,
    cases: testRun.cases,
    fileErrors: testRun.fileErrors,
    typecheckOutput: typecheck.output,
  });
  const addProblems = (testFile: string, problems: string[]) => {
    if (problems.length === 0) return;
    const existing = failures.find((failure) => failure.testFile === testFile);
    if (existing) existing.bannedPatterns.push(...problems);
    else failures.push({ testFile, failingCases: [], typecheckErrors: [], bannedPatterns: problems });
  };
  for (const scannedFile of scannedFiles) addProblems(scannedFile, await findNewBannedPatterns(context, scannedFile));
  for (const testFile of testFiles) addProblems(testFile, await findChangedCasesThatDidNotRun(context, testFile, testRun.cases));
  for (const failure of failures) {
    for (const failingCase of failure.failingCases) logger.untrusted(`✗ ${failure.testFile}: ${failingCase.fullName}`);
    if (failure.loadError) logger.untrusted(`✗ ${failure.testFile} failed to load`);
    if (failure.typecheckErrors.length > 0) logger.untrusted(`✗ ${failure.testFile}: ${failure.typecheckErrors.length} type errors`);
    for (const bannedPattern of failure.bannedPatterns) logger.untrusted(`✗ ${failure.testFile}: forbidden ${bannedPattern}`);
  }
  const passed = testRun.cases.filter((testCase) => testCase.status === 'passed').length;
  const failed = testRun.cases.filter((testCase) => testCase.status === 'failed').length;
  logger.endStep(`typecheck ${typecheck.passed ? 'passed' : 'failed'}, ${passed} passed, ${failed} failed`);
  return failures;
}

type BatchSnapshot = Map<string, string | undefined>;

async function readChangedFiles(context: WorkspaceContext) {
  const changes = await diffStagingCopy(context.directories.staging, context.manifest);
  const snapshot: BatchSnapshot = new Map();
  for (const changedPath of [...changes.added, ...changes.modified]) snapshot.set(changedPath, await readStagedFile(context, changedPath));
  return snapshot;
}

async function findBatchChanges(context: WorkspaceContext, batchStart: BatchSnapshot) {
  const current = await readChangedFiles(context);
  const changedPaths = [...current.keys()].filter((changedPath) => current.get(changedPath) !== batchStart.get(changedPath));
  const restoredPaths = [...batchStart.keys()].filter((changedPath) => !current.has(changedPath));
  return [...changedPaths, ...restoredPaths];
}

async function listCurrentTestFiles(context: WorkspaceContext) {
  const isTestFile = createMatcher(context.workspace.root, context.workspace.tests);
  const changes = await diffStagingCopy(context.directories.staging, context.manifest);
  return [...context.manifest.keys(), ...changes.added].filter((filePath) => isTestFile(filePath)).sort();
}

// Every file the batch changed is run and scanned. A change to a fixture, setup file or helper can break any test, so it runs the whole suite.
async function selectBatchTestRun(context: WorkspaceContext, batchStart: BatchSnapshot, extraTestFiles: string[] = []): Promise<TestRunScope> {
  const isTestFile = createMatcher(context.workspace.root, context.workspace.tests);
  const currentTestFiles = await listCurrentTestFiles(context);
  const batchPaths = await findBatchChanges(context, batchStart);
  const existingPaths = [];
  for (const batchPath of batchPaths) if ((await readStagedFile(context, batchPath)) !== undefined) existingPaths.push(batchPath);
  const changesSharedCode = existingPaths.some((batchPath) => !isTestFile(batchPath));
  const selected = changesSharedCode ? currentTestFiles : [...existingPaths, ...extraTestFiles].filter((filePath) => currentTestFiles.includes(filePath));
  return { testFiles: [...new Set(selected)], scannedFiles: existingPaths };
}

async function planBatch(context: WorkspaceContext, batch: WorkBatch) {
  const { logger, skills, workspace } = context;
  const isWritable = createMatcher(workspace.root, workspace.writable);
  const sourceFiles = new Set(batch.items.map((item) => item.sourceFile));
  const decisions: CaseDecision[] = [];
  const rejectedCases: BatchResult['rejectedCases'] = [];
  let skipped: BatchResult['skipped'] = [];
  let missingBehaviours: { sourceFile: string; behaviour: string; reason: string }[] = [];
  let firstCaseNumber = 1;

  for (let round = 1; round <= context.loop.planRounds; round += 1) {
    const approvedCases = decisions.filter((decision) => decision.verdict === 'keep');
    logger.startStep(`plan · ${batch.module} · round ${round}`);
    const plan = await runContextStage(context, {
      stage: 'plan',
      prompt: buildPlanPrompt({ skills: skills.plan, workItems: batch.items, missingBehaviours, approvedCases }),
      outputSchema: planOutputSchema,
    });
    const numberedCases = numberCases(plan, firstCaseNumber);
    firstCaseNumber += numberedCases.length;
    const { accepted, rejected } = partitionPlannedCases(numberedCases, { sourceFiles, isWritable });
    rejectedCases.push(...rejected);
    if (round === 1) skipped = plan.skipped;
    for (const { reason } of rejected) logger.untrusted(`rejected: ${reason}`);
    logger.endStep(`${accepted.length} ${round === 1 ? 'cases planned' : 'cases added'}, ${plan.skipped.length} files skipped`);
    if (accepted.length === 0) break;

    logger.startStep(`plan-review · ${batch.module} · round ${round}`);
    const review = await runContextStage(context, {
      stage: 'planReview',
      prompt: buildReviewPrompt({ skills: skills.planReview, workItems: batch.items, cases: accepted, approvedCases }),
      outputSchema: reviewOutputSchema,
    });
    const roundDecisions = applyReview(accepted, review);
    decisions.push(...roundDecisions);
    for (const decision of roundDecisions.filter((candidate) => candidate.verdict === 'drop')) {
      logger.untrusted(`drop ${decision.id} ${decision.name}: ${decision.verdictReason}`);
    }
    const kept = roundDecisions.filter((decision) => decision.verdict === 'keep').length;
    logger.endStep(`keep ${kept}, drop ${roundDecisions.length - kept}, missing ${review.missing.length}`);
    if (review.missing.length === 0) break;
    missingBehaviours = review.missing;
  }
  return { decisions, rejectedCases, skipped };
}

async function fixFailures(context: WorkspaceContext, batchStart: BatchSnapshot, cases: PlannedCase[], initialFailures: FileFailures[]) {
  const { logger, skills } = context;
  let failures = initialFailures;
  let attempt = 0;
  const notes: string[] = [];
  while (failures.length > 0 && attempt < context.loop.fixAttempts) {
    attempt += 1;
    const isLastAttempt = attempt === context.loop.fixAttempts;
    await mapWithConcurrency(failures, context.loop.agentParallelism, async (fileFailures) => {
      const buffered = createBufferedLogger();
      const fixerContext = { ...context, logger: buffered.logger };
      buffered.logger.startStep(`fix · attempt ${attempt}/${context.loop.fixAttempts}`);
      buffered.logger.untrusted(fileFailures.testFile);
      const fixResult = await runContextStage(fixerContext, {
        stage: isLastAttempt ? 'lastFix' : 'fix',
        prompt: buildFixPrompt({
          skills: isLastAttempt ? skills.lastFix : skills.fix,
          failures: fileFailures,
          cases: cases.filter((plannedCase) => plannedCase.testFile === fileFailures.testFile),
          attempt,
          maxAttempts: context.loop.fixAttempts,
        }),
        outputSchema: fixOutputSchema,
      });
      if (fixResult.notes.trim()) notes.push(`${fileFailures.testFile}: ${fixResult.notes.trim()}`);
      buffered.logger.endStep(`${fixResult.changed.length} files changed`);
      buffered.flush(logger);
    });
    await checkStagingChanges(context);
    failures = await runTouchedTests(context, await selectBatchTestRun(context, batchStart), `after fix attempt ${attempt}`);
  }
  return { failures, attempts: attempt, notes };
}

async function writeStagedFile(context: WorkspaceContext, repositoryPath: string, content: string | undefined) {
  const stagedPath = path.join(context.directories.staging, repositoryPath);
  if (content === undefined) return rm(stagedPath, { force: true });
  await mkdir(path.dirname(stagedPath), { recursive: true });
  await writeFile(stagedPath, content);
}

async function restoreFile(context: WorkspaceContext, testFile: string) {
  await writeStagedFile(context, testFile, await readOriginalFile(context, testFile));
}

function isFileBroken(failure: FileFailures) {
  return Boolean(failure.loadError) || failure.typecheckErrors.length > 0 || failure.bannedPatterns.length > 0;
}

async function failsOnlyInUnchangedCases(context: WorkspaceContext, failure: FileFailures) {
  if (isFileBroken(failure) || failure.failingCases.length === 0) return false;
  const current = await readStagedFile(context, failure.testFile);
  if (current === undefined) return false;
  const { cases, allMatched } = matchFailingCases(failure.testFile, current, failure.failingCases.map((failingCase) => failingCase.fullName));
  if (!allMatched) return false;
  const changedNames = new Set(compareTestFile(failure.testFile, await readOriginalFile(context, failure.testFile), current).map((change) => change.name));
  return cases.every((testCase) => !changedNames.has(testCase.name));
}

async function cleanUpRemainingFailures(context: WorkspaceContext, batchStart: BatchSnapshot, failures: FileFailures[]) {
  const { logger } = context;
  const removedCases: BatchResult['removedCases'] = [];
  const revertedCases: BatchResult['revertedCases'] = [];
  const revertedFiles: string[] = [];
  const cleanup = { removedCases, revertedCases, revertedFiles };
  if (failures.length === 0) return { ...cleanup, remainingFailures: [] };
  logger.startStep('clean up remaining failures');
  const revertFile = async (testFile: string) => {
    await restoreFile(context, testFile);
    if (!cleanup.revertedFiles.includes(testFile)) cleanup.revertedFiles.push(testFile);
    logger.untrusted(`reverted ${testFile}`);
  };
  for (const failure of failures) {
    const current = await readStagedFile(context, failure.testFile);
    const original = await readOriginalFile(context, failure.testFile);
    if (current === undefined || isFileBroken(failure)) {
      await revertFile(failure.testFile);
      continue;
    }
    const matched = matchFailingCases(failure.testFile, current, failure.failingCases.map((failingCase) => failingCase.fullName));
    if (!matched.allMatched) {
      await revertFile(failure.testFile);
      continue;
    }
    const changesByName = new Map(compareTestFile(failure.testFile, original, current).map((change) => [change.name, change]));
    const added = matched.cases.filter((testCase) => changesByName.get(testCase.name)?.kind === 'added').map((testCase) => testCase.name);
    const modified = matched.cases.filter((testCase) => changesByName.get(testCase.name)?.kind === 'modified').map((testCase) => testCase.name);
    let updated = removeCases(failure.testFile, current, added);
    if (original !== undefined) updated = revertCases(failure.testFile, updated, original, modified);
    await writeFile(path.join(context.directories.staging, failure.testFile), updated);
    for (const name of added) cleanup.removedCases.push({ testFile: failure.testFile, name });
    for (const name of modified) cleanup.revertedCases.push({ testFile: failure.testFile, name });
    for (const name of [...added, ...modified]) logger.untrusted(`${added.includes(name) ? 'removed' : 'reverted'} ${failure.testFile}: ${name}`);
  }
  await checkStagingChanges(context);
  let remaining = await runTouchedTests(context, await selectBatchTestRun(context, batchStart, cleanup.revertedFiles), 'after clean-up');
  const filesToRevert: string[] = [];
  for (const failure of remaining) {
    if (cleanup.revertedFiles.includes(failure.testFile) || (await failsOnlyInUnchangedCases(context, failure))) continue;
    filesToRevert.push(failure.testFile);
  }
  if (filesToRevert.length > 0) {
    for (const testFile of filesToRevert) await revertFile(testFile);
    await checkStagingChanges(context);
    remaining = await runTouchedTests(context, await selectBatchTestRun(context, batchStart, cleanup.revertedFiles), 'after reverting files');
  }
  logger.endStep(`${cleanup.removedCases.length} cases removed, ${cleanup.revertedCases.length} cases reverted, ${cleanup.revertedFiles.length} files reverted`);
  // Reverted files stay in the remaining failures when they still fail, for example because the source changed under them.
  return { ...cleanup, remainingFailures: remaining };
}

function emptyBatchResult(module: string): BatchResult {
  return {
    module,
    decisions: [],
    rejectedCases: [],
    skipped: [],
    fixAttempts: 0,
    remainingFailures: [],
    removedCases: [],
    revertedCases: [],
    revertedFiles: [],
    fixerNotes: [],
  };
}

async function processBatch(context: WorkspaceContext, batch: WorkBatch, batchStart: BatchSnapshot): Promise<BatchResult> {
  const planned = await planBatch(context, batch);
  const keptCases = planned.decisions.filter((decision) => decision.verdict === 'keep');
  const result: BatchResult = {
    module: batch.module,
    ...planned,
    fixAttempts: 0,
    remainingFailures: [],
    removedCases: [],
    revertedCases: [],
    revertedFiles: [],
    fixerNotes: [],
  };
  if (keptCases.length === 0) return result;
  for (const keptCase of keptCases) {
    const testedFiles = context.testedFilesByTest.get(keptCase.testFile) ?? [];
    if (!testedFiles.includes(keptCase.sourceFile)) context.testedFilesByTest.set(keptCase.testFile, [...testedFiles, keptCase.sourceFile]);
  }

  context.logger.startStep(`write · ${batch.module}`);
  const written = await runContextStage(context, {
    stage: 'write',
    prompt: buildWritePrompt({ skills: context.skills.write, cases: keptCases }),
    outputSchema: writeOutputSchema,
  });
  await checkStagingChanges(context);
  context.logger.endStep(`${written.written.length} test files written`);

  const failures = await runTouchedTests(context, await selectBatchTestRun(context, batchStart), 'after write');
  const fixed = await fixFailures(context, batchStart, keptCases, failures);
  const cleanup = await cleanUpRemainingFailures(context, batchStart, fixed.failures);
  return { ...result, fixAttempts: fixed.attempts, fixerNotes: fixed.notes, ...cleanup };
}

async function findChangesOutsideCases(context: WorkspaceContext, modifiedFiles: string[]) {
  const isTestFile = createMatcher(context.workspace.root, context.workspace.tests);
  const isShared = createMatcher(context.workspace.root, context.workspace.shared);
  const found: ChangeOutsideCases[] = [];
  for (const modifiedFile of modifiedFiles) {
    const before = await readOriginalFile(context, modifiedFile);
    const after = await readStagedFile(context, modifiedFile);
    if (before === undefined || after === undefined || !changesOutsideCases(modifiedFile, before, after)) continue;
    found.push({ testFile: modifiedFile, shared: isShared(modifiedFile) || !isTestFile(modifiedFile) });
  }
  return found;
}

async function restoreBatchStart(context: WorkspaceContext, batchStart: BatchSnapshot) {
  const changes = await diffStagingCopy(context.directories.staging, context.manifest);
  for (const symbolicLink of changes.symbolicLinks) await rm(path.join(context.directories.staging, symbolicLink), { force: true });
  for (const changedPath of new Set([...changes.added, ...changes.modified, ...changes.deleted, ...batchStart.keys()])) {
    if (batchStart.has(changedPath)) await writeStagedFile(context, changedPath, batchStart.get(changedPath));
    else await restoreFile(context, changedPath);
  }
  await checkStagingChanges(context);
}

// One failing batch must not lose the work of the others, so its files go back to where the batch started and the run carries on.
async function processBatchOrRollBack(context: WorkspaceContext, batch: WorkBatch) {
  const batchStart = await readChangedFiles(context);
  try {
    return await processBatch(context, batch, batchStart);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    context.logger.untrusted(`batch ${batch.module} failed: ${reason}`);
    await restoreBatchStart(context, batchStart);
    context.logger.endStep('batch rolled back');
    return { ...emptyBatchResult(batch.module), error: reason };
  }
}

const writingStages = new Set<StageName>(['write', 'fix', 'lastFix']);

// Only writing stages get a writable staging copy, and only their changes are checked, so each stage must get the agent kind it expects.
async function loadStageAgent(trustedRepositoryRoot: string, stage: StageName) {
  const agent = await loadAgentDefinition(trustedRepositoryRoot, stageWiring[stage].agent);
  const mustWrite = writingStages.has(stage);
  if (isWritingAgent(agent) !== mustWrite) {
    throw new Error(`Stage ${stage} needs an agent that ${mustWrite ? 'can' : 'cannot'} write files, and ${agent.name} ${mustWrite ? 'cannot' : 'can'}`);
  }
  return agent;
}

async function loadStageAgents(trustedRepositoryRoot: string): Promise<StageAgents> {
  return {
    plan: await loadStageAgent(trustedRepositoryRoot, 'plan'),
    planReview: await loadStageAgent(trustedRepositoryRoot, 'planReview'),
    write: await loadStageAgent(trustedRepositoryRoot, 'write'),
    fix: await loadStageAgent(trustedRepositoryRoot, 'fix'),
    lastFix: await loadStageAgent(trustedRepositoryRoot, 'lastFix'),
  };
}

async function loadSkillsForStage(trustedRepositoryRoot: string, stage: StageName, workspaceSkill: string) {
  const { skills, workspaceReference } = stageWiring[stage];
  return Promise.all([
    ...skills.map((name) => loadSkill(trustedRepositoryRoot, name)),
    loadSkill(trustedRepositoryRoot, workspaceSkill),
    loadSkillReference(trustedRepositoryRoot, workspaceSkill, workspaceReference),
  ]);
}

async function loadStageSkills(trustedRepositoryRoot: string, workspaceSkill: string) {
  return {
    plan: await loadSkillsForStage(trustedRepositoryRoot, 'plan', workspaceSkill),
    planReview: await loadSkillsForStage(trustedRepositoryRoot, 'planReview', workspaceSkill),
    write: await loadSkillsForStage(trustedRepositoryRoot, 'write', workspaceSkill),
    fix: await loadSkillsForStage(trustedRepositoryRoot, 'fix', workspaceSkill),
    lastFix: await loadSkillsForStage(trustedRepositoryRoot, 'lastFix', workspaceSkill),
  } satisfies Record<StageName, Skill[]>;
}

type RunRepositoryModeOptions = {
  repositoryRoot: string;
  logger: Logger;
  workspaceNames?: string[];
  modulePrefix?: string;
  maxBatches?: number;
};

export async function runRepositoryMode({ repositoryRoot, logger, workspaceNames, modulePrefix, maxBatches }: RunRepositoryModeOptions) {
  const config = await loadConfig(repositoryRoot);
  logger.startStep('prepare');
  await buildImages(repositoryRoot);
  const trackedFiles = await listTrackedFiles(repositoryRoot);
  const agents = await loadStageAgents(repositoryRoot);
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const transcriptDirectory = path.join(repositoryRoot, '.testeragent', 'runs', runId);
  await mkdir(transcriptDirectory, { recursive: true });
  logger.endStep('images built, agents loaded');

  const results: WorkspaceResult[] = [];
  for (const [name, workspace] of Object.entries(config.workspaces)) {
    if (workspaceNames && !workspaceNames.includes(name)) continue;
    const directories = await createRunDirectories();
    try {
      logger.startStep(`analyze · ${name}`);
      await prepareRunnerWorkspace({ repositoryRoot, trackedFiles, workspace, destination: directories.runner });
      await installRunnerWorkspace(directories.runner, directories.output, workspace);
      const { coverage } = await measureCoverage({ runnerDirectory: directories.runner, outputDirectory: directories.output, workspace });
      const work = await planRepositoryWork({
        workspaceName: name,
        workspace,
        trackedFiles,
        coverage,
        readRepositoryFile: (relativePath) => readRegularFile(path.join(repositoryRoot, relativePath), maxRepositoryFileBytes),
      });
      const batches = work.batches
        .filter((batch) => !modulePrefix || batch.module.startsWith(modulePrefix))
        .slice(0, maxBatches);
      logger.endStep(`${batches.length} batches to work on, ${work.fullyCovered.length} files already fully covered`);

      const manifest = await createStagingCopy({ repositoryRoot, trackedFiles, workspace, destination: directories.staging });
      const context: WorkspaceContext = {
        name,
        repositoryRoot,
        knownFiles: new Set(trackedFiles),
        testedFilesByTest: new Map(),
        workspace,
        skills: await loadStageSkills(repositoryRoot, workspace.skill),
        agents,
        stages: config.stages,
        loop: config.loop,
        directories,
        manifest,
        syncedPaths: new Set(),
        logger,
        transcriptDirectory,
        usages: [],
      };
      const batchResults: BatchResult[] = [];
      for (const batch of batches) batchResults.push(await processBatchOrRollBack(context, batch));

      logger.startStep(`verify · ${name}`);
      const typecheck = await runTypecheck(directories.runner, directories.output, workspace);
      const after = await measureCoverage({ runnerDirectory: directories.runner, outputDirectory: directories.output, workspace });
      const testsFailed = after.testRun.cases.filter((testCase) => testCase.status === 'failed').length + after.testRun.fileErrors.length;
      const suitePassed = typecheck.passed && testsFailed === 0;
      // The thresholds run the repository's own test command, so a failing suite would read as thresholds not met.
      const thresholdsMet = suitePassed && (await checkRepositoryThresholds(directories.runner, directories.output, workspace));
      const verify: VerifyResult = {
        typecheckPassed: typecheck.passed,
        testsPassed: after.testRun.cases.filter((testCase) => testCase.status === 'passed').length,
        testsFailed,
        repositoryThresholds: suitePassed ? (thresholdsMet ? 'met' : 'not met') : 'not checked',
      };
      logger.endStep(
        `typecheck ${verify.typecheckPassed ? 'passed' : 'failed'}, ${verify.testsPassed} passed, ${verify.testsFailed} failed, repository thresholds ${verify.repositoryThresholds}`,
      );

      const changes = await diffStagingCopy(directories.staging, manifest);
      const testFileChanges: TestFileChanges[] = [];
      for (const testFile of [...changes.added, ...changes.modified, ...changes.deleted]) {
        const fileChanges = compareTestFile(testFile, await readOriginalFile(context, testFile), await readStagedFile(context, testFile));
        if (fileChanges.length > 0) testFileChanges.push({ testFile, changes: fileChanges });
      }
      const changedOutsideCases = await findChangesOutsideCases(context, changes.modified);
      if (suitePassed) await applyStagingToRepository(directories.staging, repositoryRoot, changes);
      else logger.info(`${name}: verify failed, so the changes were not applied`);
      results.push({
        name,
        skillsByStage: {
          plan: context.skills.plan.map((skill) => skill.name),
          planReview: context.skills.planReview.map((skill) => skill.name),
          write: context.skills.write.map((skill) => skill.name),
          fix: context.skills.fix.map((skill) => skill.name),
          lastFix: context.skills.lastFix.map((skill) => skill.name),
        },
        coverageBefore: coverage,
        coverageAfter: after.coverage,
        verify,
        applied: suitePassed,
        fullyCovered: work.fullyCovered,
        batches: batchResults,
        changes,
        testFileChanges,
        changedOutsideCases,
        usages: context.usages,
      });
    } finally {
      await removeRunDirectories(directories);
    }
  }
  return { results, runDirectory: transcriptDirectory };
}
