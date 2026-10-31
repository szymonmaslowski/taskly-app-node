import { describe, expect, it } from 'vitest';
import { classifyOnBase } from '../src/analyze/base-check.ts';
import type { TestCaseResult } from '../src/sandbox/test-results.ts';

function testCase(status: TestCaseResult['status'], failureMessages: string[] = []): TestCaseResult {
  return { file: 'tests/router.test.ts', fullName: 'router lists tasks', title: 'lists tasks', ancestorTitles: ['router'], status, failureMessages };
}

describe('classifyOnBase', () => {
  it.each([
    ['AssertionError: expected 200 to be 422', 'fails on base'],
    ['TestingLibraryElementError: Unable to find a label with the text of: Due', 'fails on base'],
    ['Error: expect(element).toBeInTheDocument()', 'fails on base'],
    ["TypeError: Cannot read properties of undefined (reading 'filter')", 'inconclusive'],
    ['SyntaxError: The requested module does not provide an export named matchesDue', 'inconclusive'],
  ])('treats a failure starting "%s" as %s', (message, outcome) => {
    expect(classifyOnBase(testCase('failed', [message]))).toBe(outcome);
  });

  it('marks a passing case and a skipped one', () => {
    expect(classifyOnBase(testCase('passed'))).toBe('passes on base');
    expect(classifyOnBase(testCase('skipped'))).toBe('inconclusive');
  });
});
