import { describe, expect, it } from 'vitest';
import { buildPlanPrompt, buildReviewPrompt } from '../src/stages/prompts.ts';
import type { PlannedCase } from '../src/stages/schemas.ts';

const skill = { name: 'backend-unit-tests', instructions: 'Use Supertest.' };
const workItems = [{ sourceFile: 'backend/src/api/health.ts', testFiles: [] }];
const approved: PlannedCase = {
  id: 'c1',
  sourceFile: 'backend/src/api/health.ts',
  testFile: 'backend/tests/health.test.ts',
  name: 'reports ok',
  behaviour: 'returns status ok',
  reason: 'happy path',
  overlap: 'none',
  updatesExistingTest: false,
};

describe('buildPlanPrompt', () => {
  it('asks for a full plan in the first round', () => {
    const prompt = buildPlanPrompt({ skill, workItems });
    expect(prompt).toContain('Plan unit tests for the source files below.');
    expect(prompt).not.toContain('Already approved cases');
  });

  it('keeps approved cases and asks only for the missing behaviours in a follow-up round', () => {
    const prompt = buildPlanPrompt({
      skill,
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

describe('buildReviewPrompt', () => {
  it('shows earlier approved cases as context, separate from the cases under review', () => {
    const prompt = buildReviewPrompt({ skill, workItems, cases: [{ ...approved, id: 'c2', name: 'propagates errors' }], approvedCases: [approved] });
    expect(prompt.indexOf('## Cases approved earlier')).toBeLessThan(prompt.indexOf('## Planned cases'));
    expect(prompt.slice(prompt.indexOf('## Planned cases'))).not.toContain('"id": "c1"');
  });
});
