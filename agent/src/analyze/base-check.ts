import type { TestCaseResult } from '../sandbox/test-results.ts';

export type BaseCheckOutcome = 'fails on base' | 'passes on base' | 'inconclusive';

export type BaseCheckCase = {
  testFile: string;
  name: string;
  outcome: BaseCheckOutcome;
};

// Only a failed expectation shows that the test notices the change. A crash, a missing export or a type the base lacks says nothing either way.
const assertionFailurePattern = /^(AssertionError|TestingLibraryElementError)\b|^Error: expect\(/;

// A table case runs once per row; it notices the change when any row fails on an expectation.
export function combineOutcomes(outcomes: BaseCheckOutcome[]): BaseCheckOutcome {
  if (outcomes.includes('fails on base')) return 'fails on base';
  if (outcomes.length > 0 && outcomes.every((outcome) => outcome === 'passes on base')) return 'passes on base';
  return 'inconclusive';
}

export function classifyOnBase(testCase: TestCaseResult): BaseCheckOutcome {
  if (testCase.status === 'passed') return 'passes on base';
  if (testCase.status === 'failed' && assertionFailurePattern.test(testCase.failureMessages[0] ?? '')) return 'fails on base';
  return 'inconclusive';
}
