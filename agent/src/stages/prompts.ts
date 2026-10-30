import type { WorkItem } from '../analyze/repository.ts';
import type { Skill } from '../skills.ts';
import type { PlannedCase } from './schemas.ts';

const maxFailureMessageLength = 2_000;

export type TestFailure = {
  fullName: string;
  failureMessages: string[];
};

export type FileFailures = {
  testFile: string;
  failingCases: TestFailure[];
  loadError?: string;
  typecheckErrors: string[];
  bannedPatterns: string[];
};

function section(title: string, body: string) {
  return `## ${title}\n\n${body}`;
}

function jsonBlock(value: object) {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function describeWorkItem(item: WorkItem) {
  return {
    sourceFile: item.sourceFile,
    existingTestFiles: item.testFiles,
    coverage: item.coverage
      ? {
          statements: `${item.coverage.statements.covered}/${item.coverage.statements.total}`,
          branches: `${item.coverage.branches.covered}/${item.coverage.branches.total}`,
          uncoveredLines: item.coverage.uncoveredLines,
          partlyTakenBranches: item.coverage.uncoveredBranches.map(
            (branch) => `line ${branch.line} (${branch.type}, ${branch.takenOutcomes} of ${branch.totalOutcomes} outcomes taken)`,
          ),
        }
      : 'no coverage data',
  };
}

function describeCase(plannedCase: PlannedCase) {
  return {
    id: plannedCase.id,
    sourceFile: plannedCase.sourceFile,
    testFile: plannedCase.testFile,
    name: plannedCase.name,
    behaviour: plannedCase.behaviour,
    reason: plannedCase.reason,
    overlap: plannedCase.overlap,
    updatesExistingTest: plannedCase.updatesExistingTest,
  };
}

function truncate(text: string) {
  return text.length > maxFailureMessageLength ? `${text.slice(0, maxFailureMessageLength)}\n[truncated]` : text;
}

type PlanPromptOptions = {
  skill: Skill;
  workItems: WorkItem[];
  missingBehaviours?: { sourceFile: string; behaviour: string; reason: string }[];
  approvedCases?: PlannedCase[];
};

export function buildPlanPrompt({ skill, workItems, missingBehaviours = [], approvedCases = [] }: PlanPromptOptions) {
  const isFollowUp = missingBehaviours.length > 0;
  const sections = [
    isFollowUp
      ? 'Add unit test cases for the behaviours a reviewer found missing from an approved plan. All paths are relative to your working directory.'
      : 'Plan unit tests for the source files below. All paths are relative to your working directory.',
    section('Conventions for this workspace', skill.instructions),
    section('Work items', jsonBlock(workItems.map(describeWorkItem))),
  ];
  if (isFollowUp) {
    sections.push(
      section('Already approved cases', `These stay as they are. Don't repeat them.\n\n${jsonBlock(approvedCases.map(describeCase))}`),
      section('Missing behaviours', `Plan cases only for these, unless existing tests or approved cases already cover them:\n\n${jsonBlock(missingBehaviours)}`),
      section('Output', 'Return only the new cases, with the test file each goes into. Leave `skipped` empty.'),
    );
  } else {
    sections.push(
      section(
        'Output',
        'Return every source file you plan cases for, with the test file the cases go into and the cases. Set `updatesExistingTest` only for a case that changes an existing test. List source files that need no new cases under `skipped`, with the reason.',
      ),
    );
  }
  return sections.join('\n\n');
}

type ReviewPromptOptions = {
  skill: Skill;
  workItems: WorkItem[];
  cases: PlannedCase[];
  approvedCases?: PlannedCase[];
};

export function buildReviewPrompt({ skill, workItems, cases, approvedCases = [] }: ReviewPromptOptions) {
  const sections = [
    'Review this unit test plan. All paths are relative to your working directory.',
    section('Conventions for this workspace', skill.instructions),
    section('Source files and their existing tests', jsonBlock(workItems.map(describeWorkItem))),
  ];
  if (approvedCases.length > 0) {
    sections.push(section('Cases approved earlier', `Not for review. Use them to spot duplicates.\n\n${jsonBlock(approvedCases.map(describeCase))}`));
  }
  sections.push(
    section('Planned cases', jsonBlock(cases.map(describeCase))),
    section(
      'Output',
      'Give a verdict for every planned case id, with a one-sentence reason. Under `missing`, list important untested behaviours the plan misses, or nothing.',
    ),
  );
  return sections.join('\n\n');
}

type WritePromptOptions = {
  skill: Skill;
  cases: PlannedCase[];
};

export function buildWritePrompt({ skill, cases }: WritePromptOptions) {
  return [
    'Write these approved unit test cases. All paths are relative to your working directory.',
    section('Conventions for this workspace', skill.instructions),
    section('Approved cases', jsonBlock(cases.map(describeCase))),
    section('Output', 'Return every test file you wrote or changed, with the ids of the cases it now contains.'),
  ].join('\n\n');
}

type FixPromptOptions = {
  skill: Skill;
  readingSkill: Skill;
  failures: FileFailures;
  cases: PlannedCase[];
  attempt: number;
  maxAttempts: number;
};

export function buildFixPrompt({ skill, readingSkill, failures, cases, attempt, maxAttempts }: FixPromptOptions) {
  const report = {
    testFile: failures.testFile,
    typecheckErrors: failures.typecheckErrors,
    forbiddenShortcuts: failures.bannedPatterns,
    loadError: failures.loadError ? truncate(failures.loadError) : undefined,
    failingCases: failures.failingCases.map((failure) => ({
      name: failure.fullName,
      messages: failure.failureMessages.map(truncate),
    })),
  };
  return [
    `Fix the failing tests in ${failures.testFile}. This is attempt ${attempt} of ${maxAttempts}. All paths are relative to your working directory.`,
    section('Conventions for this workspace', skill.instructions),
    section('How to read the failures', readingSkill.instructions),
    section('The cases this file is meant to contain', jsonBlock(cases.map(describeCase))),
    section('Failures', jsonBlock(report)),
    section('Output', 'Return the test files you changed, and notes on anything you couldn\'t fix or chose not to change.'),
  ].join('\n\n');
}
