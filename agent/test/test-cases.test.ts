import { describe, expect, it } from 'vitest';
import { extractTestCases, findBannedPatterns, newBannedPatterns } from '../src/tests/test-cases.ts';
import { compareTestFile, findCasesByRuntimeNames, matchesCaseName, removeCases, revertCases } from '../src/tests/test-changes.ts';

const original = `import { it, expect } from 'vitest';
import { fromModel } from '../src/mappers.ts';

it('maps records', () => {
  expect(fromModel(record)).toEqual(todo);
  expect(record).toEqual(before);
});
describe('dates', () => {
  it.each(['2026-10-15', null])('keeps due date %s', (date) => {
    expect(fromModel({ ...record, due_date: date }).due_date).toBe(date);
  });
});
`;

describe('extractTestCases', () => {
  it('names cases with their describe titles and counts their assertions', () => {
    expect(extractTestCases('mappers.test.ts', original).map(({ name, expectCount }) => ({ name, expectCount }))).toEqual([
      { name: 'maps records', expectCount: 2 },
      { name: 'dates keeps due date %s', expectCount: 1 },
    ]);
  });
});

describe('compareTestFile', () => {
  it('reports added, modified and deleted cases with assertion counts', () => {
    const changed = original
      .replace("  expect(record).toEqual(before);\n", '')
      .replace(/describe\('dates'[\s\S]*$/, "it('rejects invalid data', () => {\n  expect(() => fromModel({})).toThrow();\n});\n");
    expect(compareTestFile('mappers.test.ts', original, changed).map((change) => ({ ...change, before: undefined, after: undefined }))).toEqual([
      { kind: 'modified', name: 'maps records', expectsBefore: 2, expectsAfter: 1, before: undefined, after: undefined },
      { kind: 'added', name: 'rejects invalid data', expectCount: 1, before: undefined, after: undefined },
      { kind: 'deleted', name: 'dates keeps due date %s', expectCount: 1, before: undefined, after: undefined },
    ]);
  });
});

describe('matchesCaseName', () => {
  it.each([
    ['dates keeps due date %s', 'dates keeps due date 2026-10-15', true],
    ['rejects input: %j', 'rejects input: {"title":""}', true],
    ['maps records', 'maps records', true],
    ['maps records', 'maps other records', false],
  ])('matches %s against %s', (sourceName, runtimeName, expected) => {
    expect(matchesCaseName(sourceName, runtimeName)).toBe(expected);
  });
});

describe('removeCases and revertCases', () => {
  it('removes the named cases and keeps the rest of the file', () => {
    const [failing] = findCasesByRuntimeNames('mappers.test.ts', original, ['dates keeps due date null']);
    const result = removeCases('mappers.test.ts', original, [failing.name]);
    expect(extractTestCases('mappers.test.ts', result).map((testCase) => testCase.name)).toEqual(['maps records']);
    expect(result).toContain("describe('dates'");
  });

  it('restores the original text of changed cases', () => {
    const changed = original.replace('toEqual(todo)', 'toBeDefined()');
    expect(revertCases('mappers.test.ts', changed, original, ['maps records'])).toBe(original);
  });
});

describe('findBannedPatterns', () => {
  const knownFiles = new Set(['backend/src/mappers.ts', 'backend/tests/mappers.test.ts']);

  it('finds skipped, focused and inverted cases, expects inside try and mocks of the module under test', () => {
    const content = `
vi.mock('../src/mappers.ts', () => ({ fromModel: vi.fn() }));
it.skip('skipped', () => {});
it.only('focused', () => {});
it.fails('inverted', () => { expect(1).toBe(2); });
it('swallows', () => {
  try { expect(fromModel({})).toThrow(); } catch {}
});
`;
    const patterns = findBannedPatterns({ fileName: 'backend/tests/mappers.test.ts', content, testedFiles: ['backend/src/mappers.ts'], knownFiles });
    expect(patterns.map(({ kind, caseName }) => `${kind}|${caseName}`)).toEqual([
      'mock of the module under test|',
      'it.skip|skipped',
      'it.only|focused',
      'it.fails|inverted',
      'expect inside try|swallows',
    ]);
  });

  it('only reports patterns the change introduced', () => {
    const before = findBannedPatterns({ fileName: 'a.test.ts', content: "it.skip('old', () => {});", testedFiles: [], knownFiles });
    const after = findBannedPatterns({ fileName: 'a.test.ts', content: "it.skip('old', () => {});\nit.todo('new');", testedFiles: [], knownFiles });
    expect(newBannedPatterns(before, after).map((pattern) => pattern.kind)).toEqual(['it.todo']);
  });
});
