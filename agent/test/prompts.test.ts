import { describe, expect, it } from 'vitest';
import { buildFixPrompt, buildPlanPrompt, buildReviewPrompt } from '../src/stages/prompts.ts';
import type { PlannedCase } from '../src/stages/schemas.ts';

const skills = [{ name: 'backend-unit-tests', instructions: 'Use Supertest.' }];
const workItems = [{ sourceFile: 'backend/src/api/health.ts', testFiles: [] }];
const approved: PlannedCase = {
  id: 'c1',
  sourceFile: 'backend/src/api/health.ts',
  testFile: 'backend/tests/health.test.ts',
  name: 'reports ok',
  behaviour: 'returns status ok',
  catches: 'reports down when up',
  reason: 'happy path',
  overlap: 'none',
  updatesExistingTest: false,
};

describe('buildPlanPrompt', () => {
  it('asks for a full plan in the first round', () => {
    const prompt = buildPlanPrompt({ skills, workItems });
    expect(prompt).toContain('Plan unit tests for the source files below.');
    expect(prompt).not.toContain('Already approved cases');
  });

  it('keeps approved cases and asks only for the missing behaviours in a follow-up round', () => {
    const prompt = buildPlanPrompt({
      skills,
      workItems,
      approvedCases: [approved],
      missingBehaviours: [{ sourceFile: 'backend/src/api/health.ts', behaviour: 'fails when the database fails', reason: 'error path' }],
    });
    expect(prompt).toContain('## Already approved cases');
    expect(prompt).toContain('"id": "c1"');
    expect(prompt).toContain('fails when the database fails');
    expect(prompt).toContain('Return only the new cases');
  });
});

describe('skills in prompts', () => {
  it('includes every skill of the stage under its own name, in order', () => {
    const prompt = buildPlanPrompt({
      skills: [
        { name: 'unit-test-planning', instructions: 'Plan behaviours.' },
        { name: 'backend-unit-tests/planning.md', instructions: 'Plan routes against the contract.' },
      ],
      workItems,
    });
    expect(prompt.indexOf('### unit-test-planning\n\nPlan behaviours.')).toBeGreaterThan(-1);
    expect(prompt.indexOf('### backend-unit-tests/planning.md')).toBeGreaterThan(prompt.indexOf('### unit-test-planning'));
  });
});

describe('buildReviewPrompt', () => {
  it('shows earlier approved cases as context, separate from the cases under review', () => {
    const prompt = buildReviewPrompt({ skills, workItems, cases: [{ ...approved, id: 'c2', name: 'propagates errors' }], approvedCases: [approved] });
    expect(prompt.indexOf('## Cases approved earlier')).toBeLessThan(prompt.indexOf('## Planned cases'));
    expect(prompt.slice(prompt.indexOf('## Planned cases'))).not.toContain('"id": "c1"');
  });
});

describe('buildFixPrompt', () => {
  it('caps the number of failing cases and type errors so the prompt stays bounded', () => {
    const prompt = buildFixPrompt({
      skills,
      failures: {
        testFile: 'backend/tests/health.test.ts',
        failingCases: Array.from({ length: 60 }, (_, index) => ({ fullName: `case ${index}`, failureMessages: ['x'.repeat(5_000)] })),
        typecheckErrors: Array.from({ length: 100 }, (_, index) => `tests/health.test.ts(${index},1): error TS2345: bad`),
        bannedPatterns: [],
      },
      cases: [approved],
      attempt: 1,
      maxAttempts: 4,
    });
    expect(prompt).toContain('"failingCasesOmitted": 40');
    expect(prompt).toContain('"typecheckErrorsOmitted": 60');
    expect(prompt.length).toBeLessThan(100_000);
  });
});
