import type { StageSettings } from './run-stage.ts';

export const stageSettings = {
  plan: { effort: 'high', maxTurns: 30, timeoutMinutes: 10, maxBudgetUsd: 3 },
  planReview: { effort: 'high', maxTurns: 20, timeoutMinutes: 10, maxBudgetUsd: 3 },
  write: { effort: 'medium', maxTurns: 40, timeoutMinutes: 15, maxBudgetUsd: 4 },
  fix: { effort: 'medium', maxTurns: 25, timeoutMinutes: 10, maxBudgetUsd: 3 },
  lastFix: { effort: 'high', maxTurns: 30, timeoutMinutes: 12, maxBudgetUsd: 5 },
} satisfies Record<string, StageSettings>;

export const loopLimits = {
  planRounds: 2,
  // One retry with the rejection reason fixes a malformed answer; a second failure means the task was misread.
  outputAttempts: 2,
  fixAttempts: 4,
  lastFixModel: 'claude-opus-5-5',
  // Fixers share one writable staging copy, so two of them could edit the same fixture at once.
  agentParallelism: 1,
};
