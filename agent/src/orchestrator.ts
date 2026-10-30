import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { z } from 'zod';
import { loadAgentDefinition, type AgentDefinition } from './agents.ts';
import type { CoverageByFile } from './analyze/coverage.ts';
import { measureCoverage, planRepositoryWork, type WorkBatch } from './analyze/repository.ts';
import { mapWithConcurrency } from './concurrency.ts';
import { loadConfig, type WorkspaceConfig } from './config.ts';
import { collectFailures } from './failures.ts';
import { createBufferedLogger, type Logger } from './logger.ts';
import { runStage, type StageSettings, type StageUsage } from './run-stage.ts';
import { createRunDirectories, removeRunDirectories, type RunDirectories } from './sandbox/directories.ts';
import { createMatcher, listTrackedFiles, readRegularFile } from './sandbox/files.ts';
import { buildImages } from './sandbox/images.ts';
import { installRunnerWorkspace, prepareRunnerWorkspace, runTests, runTypecheck } from './sandbox/runner.ts';
import { createStagingCopy, diffStagingCopy, findDisallowedChanges, type StagingChanges, type StagingManifest } from './sandbox/staging.ts';
import { applyStagingToRepository, syncStagingToRunner } from './sandbox/sync.ts';
import { loadSkill, type Skill } from './skills.ts';
import { applyReview, numberCases, partitionPlannedCases, type CaseDecision } from './stages/plan.ts';
import { buildFixPrompt, buildPlanPrompt, buildReviewPrompt, buildWritePrompt, type FileFailures } from './stages/prompts.ts';
import { fixOutputSchema, planOutputSchema, reviewOutputSchema, writeOutputSchema, type PlannedCase } from './stages/schemas.ts';
import { loopLimits, stageSettings } from './stages.ts';
import { compareTestFile, findCasesByRuntimeNames, removeCases, revertCases, type CaseChange } from './tests/test-changes.ts';
import { findBannedPatterns, newBannedPatterns } from './tests/test-cases.ts';

const maxRepositoryFileBytes = 2_000_000;

type StageAgents = {
  planner: AgentDefinition;
  reviewer: AgentDefinition;
  writer: AgentDefinition;
  fixer: AgentDefinition;
};

type WorkspaceContext = {
  name: string;
  repositoryRoot: string;
  knownFiles: Set<string>;
  testedFilesByTest: Map<string, string[]>;
  workspace: WorkspaceConfig;
  skill: Skill;
  readingSkill: Skill;
  agents: StageAgents;
  directories: RunDirectories;
  manifest: StagingManifest;
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
};

export type TestFileChanges = {
  testFile: string;
  changes: CaseChange[];
};

export type WorkspaceResult = {
  name: string;
  coverageBefore: CoverageByFile;
  fullyCovered: string[];
  batches: BatchResult[];
  changes: StagingChanges;
  testFileChanges: TestFileChanges[];
  usages: StageUsage[];
};

let transcriptCounter = 0;

type ContextStageOptions<Schema extends z.ZodType> = {
  agent: AgentDefinition;
  prompt: string;
  settings: StageSettings;
  model?: string;
  outputSchema: Schema;
};

async function runContextStage<Schema extends z.ZodType>(context: WorkspaceContext, options: ContextStageOptions<Schema>) {
  transcriptCounter += 1;
  const { output, usages } = await runStage({
    ...options,
    workingDirectory: context.directories.staging,
    logger: context.logger,
    transcriptFile: path.join(context.transcriptDirectory, `${String(transcriptCounter).padStart(3, '0')}-${options.agent.name}.jsonl`),
  });
  context.usages.push(...usages);
  return output;
}

async function checkStagingChanges(context: WorkspaceContext) {
  const changes = await diffStagingCopy(context.directories.staging, context.manifest);
  if (changes.symbolicLinks.length > 0) throw new Error(`The agent created symbolic links: ${changes.symbolicLinks.join(', ')}`);
  const disallowed = findDisallowedChanges(changes, context.workspace);
  if (disallowed.length > 0) throw new Error(`The agent changed files outside the writable paths: ${disallowed.join(', ')}`);
  await syncStagingToRunner(context.directories.staging, context.directories.runner, context.workspace.root, changes);
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

async function runTouchedTests(context: WorkspaceContext, testFiles: string[], attemptLabel: string) {
  const { logger, workspace, directories } = context;
  if (testFiles.length === 0) return [];
  logger.startStep(`run · ${attemptLabel}`);
  const typecheck = await runTypecheck(directories.runner, directories.output, workspace);
  const prefix = `${workspace.root}/`;
  const testRun = await runTests({
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
  for (const testFile of testFiles) {
    const bannedPatterns = await findNewBannedPatterns(context, testFile);
    if (bannedPatterns.length === 0) continue;
    const existing = failures.find((failure) => failure.testFile === testFile);
    if (existing) existing.bannedPatterns = bannedPatterns;
    else failures.push({ testFile, failingCases: [], typecheckErrors: [], bannedPatterns });
  }
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

async function planBatch(context: WorkspaceContext, batch: WorkBatch) {
  const { logger, agents, skill, workspace } = context;
  const isWritable = createMatcher(workspace.root, workspace.writable);
  const sourceFiles = new Set(batch.items.map((item) => item.sourceFile));
  const decisions: CaseDecision[] = [];
  const rejectedCases: BatchResult['rejectedCases'] = [];
  let skipped: BatchResult['skipped'] = [];
  let missingBehaviours: { sourceFile: string; behaviour: string; reason: string }[] = [];
  let firstCaseNumber = 1;

  for (let round = 1; round <= loopLimits.planRounds; round += 1) {
    const approvedCases = decisions.filter((decision) => decision.verdict === 'keep');
    logger.startStep(`plan · ${batch.module} · round ${round}`);
    const plan = await runContextStage(context, {
      agent: agents.planner,
      prompt: buildPlanPrompt({ skill, workItems: batch.items, missingBehaviours, approvedCases }),
      settings: stageSettings.plan,
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
      agent: agents.reviewer,
      prompt: buildReviewPrompt({ skill, workItems: batch.items, cases: accepted, approvedCases }),
      settings: stageSettings.planReview,
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

async function fixFailures(context: WorkspaceContext, cases: PlannedCase[], initialFailures: FileFailures[]) {
  const { logger, agents, skill, readingSkill } = context;
  let failures = initialFailures;
  let attempt = 0;
  const notes: string[] = [];
  while (failures.length > 0 && attempt < loopLimits.fixAttempts) {
    attempt += 1;
    const isLastAttempt = attempt === loopLimits.fixAttempts;
    await mapWithConcurrency(failures, loopLimits.agentParallelism, async (fileFailures) => {
      const buffered = createBufferedLogger();
      const fixerContext = { ...context, logger: buffered.logger };
      buffered.logger.startStep(`fix · attempt ${attempt}/${loopLimits.fixAttempts}`);
      buffered.logger.untrusted(fileFailures.testFile);
      const fixResult = await runContextStage(fixerContext, {
        agent: agents.fixer,
        prompt: buildFixPrompt({
          skill,
          readingSkill,
          failures: fileFailures,
          cases: cases.filter((plannedCase) => plannedCase.testFile === fileFailures.testFile),
          attempt,
          maxAttempts: loopLimits.fixAttempts,
        }),
        settings: isLastAttempt ? stageSettings.lastFix : stageSettings.fix,
        model: isLastAttempt ? loopLimits.lastFixModel : undefined,
        outputSchema: fixOutputSchema,
      });
      if (fixResult.notes.trim()) notes.push(`${fileFailures.testFile}: ${fixResult.notes.trim()}`);
      buffered.logger.endStep(`${fixResult.changed.length} files changed`);
      buffered.flush(logger);
    });
    await checkStagingChanges(context);
    failures = await runTouchedTests(context, failures.map((failure) => failure.testFile), `after fix attempt ${attempt}`);
  }
  return { failures, attempts: attempt, notes };
}

async function restoreFile(context: WorkspaceContext, testFile: string) {
  const original = await readOriginalFile(context, testFile);
  const stagedPath = path.join(context.directories.staging, testFile);
  if (original === undefined) await rm(stagedPath, { force: true });
  else await writeFile(stagedPath, original);
}

async function cleanUpRemainingFailures(context: WorkspaceContext, failures: FileFailures[]) {
  const { logger } = context;
  const removedCases: BatchResult['removedCases'] = [];
  const revertedCases: BatchResult['revertedCases'] = [];
  const revertedFiles: string[] = [];
  const cleanup = { removedCases, revertedCases, revertedFiles };
  if (failures.length === 0) return { ...cleanup, remainingFailures: [] };
  logger.startStep('clean up remaining failures');
  for (const failure of failures) {
    const current = await readStagedFile(context, failure.testFile);
    const original = await readOriginalFile(context, failure.testFile);
    const fileIsBroken = failure.loadError || failure.typecheckErrors.length > 0 || failure.bannedPatterns.length > 0;
    if (current === undefined || fileIsBroken) {
      await restoreFile(context, failure.testFile);
      cleanup.revertedFiles.push(failure.testFile);
      logger.untrusted(`reverted ${failure.testFile}`);
      continue;
    }
    const changesByName = new Map(compareTestFile(failure.testFile, original, current).map((change) => [change.name, change]));
    const failingCases = findCasesByRuntimeNames(failure.testFile, current, failure.failingCases.map((failingCase) => failingCase.fullName));
    const added = failingCases.filter((testCase) => changesByName.get(testCase.name)?.kind === 'added').map((testCase) => testCase.name);
    const modified = failingCases.filter((testCase) => changesByName.get(testCase.name)?.kind === 'modified').map((testCase) => testCase.name);
    let updated = removeCases(failure.testFile, current, added);
    if (original !== undefined) updated = revertCases(failure.testFile, updated, original, modified);
    await writeFile(path.join(context.directories.staging, failure.testFile), updated);
    for (const name of added) cleanup.removedCases.push({ testFile: failure.testFile, name });
    for (const name of modified) cleanup.revertedCases.push({ testFile: failure.testFile, name });
    for (const name of [...added, ...modified]) logger.untrusted(`${added.includes(name) ? 'removed' : 'reverted'} ${failure.testFile}: ${name}`);
  }
  await checkStagingChanges(context);
  const remaining = await runTouchedTests(context, failures.map((failure) => failure.testFile).filter((testFile) => !cleanup.revertedFiles.includes(testFile)), 'after clean-up');
  for (const failure of remaining) {
    const developerCasesOnly = failure.failingCases.length > 0 && !failure.loadError && failure.typecheckErrors.length === 0 && failure.bannedPatterns.length === 0;
    if (developerCasesOnly) continue;
    await restoreFile(context, failure.testFile);
    cleanup.revertedFiles.push(failure.testFile);
  }
  if (cleanup.revertedFiles.length > 0) await checkStagingChanges(context);
  logger.endStep(`${cleanup.removedCases.length} cases removed, ${cleanup.revertedCases.length} cases reverted, ${cleanup.revertedFiles.length} files reverted`);
  return { ...cleanup, remainingFailures: remaining.filter((failure) => !cleanup.revertedFiles.includes(failure.testFile)) };
}

async function processBatch(context: WorkspaceContext, batch: WorkBatch): Promise<BatchResult> {
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
    agent: context.agents.writer,
    prompt: buildWritePrompt({ skill: context.skill, cases: keptCases }),
    settings: stageSettings.write,
    outputSchema: writeOutputSchema,
  });
  const changes = await checkStagingChanges(context);
  context.logger.endStep(`${written.written.length} test files written`);

  const changedPaths = new Set([...changes.added, ...changes.modified]);
  const touchedTestFiles = [...new Set(keptCases.map((keptCase) => keptCase.testFile))].filter((testFile) => changedPaths.has(testFile));
  const failures = await runTouchedTests(context, touchedTestFiles, 'after write');
  const fixed = await fixFailures(context, keptCases, failures);
  const cleanup = await cleanUpRemainingFailures(context, fixed.failures);
  return { ...result, fixAttempts: fixed.attempts, fixerNotes: fixed.notes, ...cleanup };
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
  const agents: StageAgents = {
    planner: await loadAgentDefinition(repositoryRoot, 'test-planner'),
    reviewer: await loadAgentDefinition(repositoryRoot, 'plan-reviewer'),
    writer: await loadAgentDefinition(repositoryRoot, 'test-writer'),
    fixer: await loadAgentDefinition(repositoryRoot, 'test-fixer'),
  };
  const readingSkill = await loadSkill(repositoryRoot, 'reading-test-results');
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
        skill: await loadSkill(repositoryRoot, workspace.skill),
        readingSkill,
        agents,
        directories,
        manifest,
        logger,
        transcriptDirectory,
        usages: [],
      };
      const batchResults: BatchResult[] = [];
      for (const batch of batches) batchResults.push(await processBatch(context, batch));

      const changes = await diffStagingCopy(directories.staging, manifest);
      const testFileChanges: TestFileChanges[] = [];
      for (const testFile of [...changes.added, ...changes.modified, ...changes.deleted]) {
        const fileChanges = compareTestFile(testFile, await readOriginalFile(context, testFile), await readStagedFile(context, testFile));
        if (fileChanges.length > 0) testFileChanges.push({ testFile, changes: fileChanges });
      }
      await applyStagingToRepository(directories.staging, repositoryRoot, changes);
      results.push({
        name,
        coverageBefore: coverage,
        fullyCovered: work.fullyCovered,
        batches: batchResults,
        changes,
        testFileChanges,
        usages: context.usages,
      });
    } finally {
      await removeRunDirectories(directories);
    }
  }
  return results;
}
