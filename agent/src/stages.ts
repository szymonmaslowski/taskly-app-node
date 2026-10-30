export const stageNames = ['plan', 'planReview', 'write', 'fix', 'lastFix'] as const;

export type StageName = (typeof stageNames)[number];

export const stageEfforts = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

type StageWiring = {
  agent: string;
  skills: string[];
  workspaceReference: string;
};

const planningSkills = ['unit-test-principles', 'unit-test-planning'];
const reviewingSkills = ['unit-test-principles', 'unit-test-reviewing'];
const writingSkills = ['unit-test-principles', 'unit-test-writing'];
const fixingSkills = ['unit-test-principles', 'unit-test-writing', 'reading-test-results'];

// The agent prompts name the skills they follow, so which agent and skills a stage uses is part of the pipeline, not a setting.
// Each stage also gets the workspace skill itself; workspaceReference names the file of that skill the stage needs.
export const stageWiring = {
  plan: { agent: 'test-planner', skills: planningSkills, workspaceReference: 'planning.md' },
  planReview: { agent: 'plan-reviewer', skills: reviewingSkills, workspaceReference: 'planning.md' },
  write: { agent: 'test-writer', skills: writingSkills, workspaceReference: 'writing.md' },
  fix: { agent: 'test-fixer', skills: fixingSkills, workspaceReference: 'writing.md' },
  lastFix: { agent: 'test-fixer', skills: fixingSkills, workspaceReference: 'writing.md' },
} satisfies Record<StageName, StageWiring>;

// The config can tighten these but not loosen them, so a typo can't turn into a runaway bill.
export const stageCaps = { maxTurns: 60, timeoutMinutes: 30, maxBudgetUsd: 10 };

export const loopCaps = { planRounds: 3, outputAttempts: 3, fixAttempts: 4, agentParallelism: 4 };
