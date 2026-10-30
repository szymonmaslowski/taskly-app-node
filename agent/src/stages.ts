import type { StageSettings } from './run-stage.ts';

export const stageNames = ['plan', 'planReview', 'write', 'fix', 'lastFix'] as const;

export type StageName = (typeof stageNames)[number];

export const stageEfforts = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

const planningSkills = { skills: ['unit-test-principles', 'unit-test-planning'], workspaceReference: 'planning.md' };
const reviewingSkills = { skills: ['unit-test-principles', 'unit-test-reviewing'], workspaceReference: 'planning.md' };
const writingSkills = { skills: ['unit-test-principles', 'unit-test-writing'], workspaceReference: 'writing.md' };
const fixingSkills = { skills: ['unit-test-principles', 'unit-test-writing', 'reading-test-results'], workspaceReference: 'writing.md' };

// Each stage also gets the workspace skill itself; workspaceReference names the file of that skill the stage needs.
export const defaultStages = {
  plan: { agent: 'test-planner', model: 'claude-sonnet-5-5', effort: 'high', maxTurns: 30, timeoutMinutes: 10, maxBudgetUsd: 3, ...planningSkills },
  planReview: { agent: 'plan-reviewer', model: 'claude-opus-5-5', effort: 'high', maxTurns: 20, timeoutMinutes: 10, maxBudgetUsd: 3, ...reviewingSkills },
  write: { agent: 'test-writer', model: 'claude-sonnet-5-5', effort: 'medium', maxTurns: 40, timeoutMinutes: 15, maxBudgetUsd: 4, ...writingSkills },
  fix: { agent: 'test-fixer', model: 'claude-sonnet-5-5', effort: 'medium', maxTurns: 25, timeoutMinutes: 10, maxBudgetUsd: 3, ...fixingSkills },
  lastFix: { agent: 'test-fixer', model: 'claude-opus-5-5', effort: 'high', maxTurns: 30, timeoutMinutes: 12, maxBudgetUsd: 5, ...fixingSkills },
} satisfies Record<StageName, StageSettings & { agent: string; model: string; skills: string[]; workspaceReference: string }>;

// The config can tighten these but not loosen them, so a typo can't turn into a runaway bill.
export const stageCaps = { maxTurns: 60, timeoutMinutes: 30, maxBudgetUsd: 10 };

export const defaultLoop = {
  planRounds: 2,
  // One retry with the rejection reason fixes a malformed answer; a second failure means the task was misread.
  outputAttempts: 2,
  fixAttempts: 4,
  // Fixers share one writable staging copy, so two of them could edit the same fixture at once.
  agentParallelism: 1,
};

export const loopCaps = { planRounds: 3, outputAttempts: 3, fixAttempts: 4, agentParallelism: 4 };
