import { describe, expect, it } from 'vitest';
import { extractTestCases, findBannedPatterns, newBannedPatterns } from '../src/tests/test-cases.ts';
import { changesOutsideCases, compareTestFile, findCasesByRuntimeNames, matchFailingCases, matchesCaseName, removeCases, revertCases } from '../src/tests/test-changes.ts';

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

describe('changesOutsideCases', () => {
  it('ignores new cases, new describe blocks and new imports', () => {
    const changed = `import { toModel } from '../src/mappers.ts';\n${original}describe('toModel', () => {\n  it('maps back', () => {});\n});\n`;
    expect(changesOutsideCases('mappers.test.ts', original, changed)).toBe(false);
  });

  it.each([
    ['a changed mock factory', "vi.mock('../src/api.ts', () => ({ list: vi.fn() }));\n", "vi.mock('../src/api.ts', () => ({ list: vi.fn(() => []) }));\n"],
    ['a changed hook inside a describe', "describe('x', () => {\n  beforeEach(() => reset());\n});\n", "describe('x', () => {\n  beforeEach(() => {});\n});\n"],
  ])('reports %s', (_description, before, after) => {
    expect(changesOutsideCases('cases.test.ts', before, after)).toBe(true);
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

describe('matchFailingCases', () => {
  it('matches runtime names of parameterised cases to their source case', () => {
    const { cases, allMatched } = matchFailingCases('mappers.test.ts', original, ['dates keeps due date null', 'dates keeps due date 2026-10-15']);
    expect(allMatched).toBe(true);
    expect(cases.map((testCase) => testCase.name)).toEqual(['dates keeps due date %s']);
  });

  it.each([
    ['a template literal title', "it(`maps ${kind}`, () => {});", 'maps record'],
    ['a duplicate title', "it('maps', () => {});\nit('maps', () => {});", 'maps'],
  ])('does not match %s', (_description, content, runtimeName) => {
    expect(matchFailingCases('cases.test.ts', content, [runtimeName]).allMatched).toBe(false);
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

  it('finds skipped, focused and inverted cases, expects inside try or catch and mocks of the module under test', () => {
    const content = `
vi.mock('../src/mappers.ts', () => ({ fromModel: vi.fn() }));
it.skip('skipped', () => {});
it.only('focused', () => {});
it.fails('inverted', () => { expect(1).toBe(2); });
it('swallows', () => {
  try { expect(fromModel({})).toThrow(); } catch {}
});
it('passes when nothing throws', async () => {
  try { await fromModel({}); } catch (error) { expect(error).toBeInstanceOf(Error); }
});
`;
    const patterns = findBannedPatterns({ fileName: 'backend/tests/mappers.test.ts', content, testedFiles: ['backend/src/mappers.ts'], knownFiles });
    expect(patterns.map(({ kind, caseName }) => `${kind}|${caseName}`)).toEqual([
      'mock of the module under test|',
      'it.skip|skipped',
      'it.only|focused',
      'it.fails|inverted',
      'expect inside try|swallows',
      'expect inside catch|passes when nothing throws',
    ]);
  });

  it('only reports patterns the change introduced', () => {
    const before = findBannedPatterns({ fileName: 'a.test.ts', content: "it.skip('old', () => {});", testedFiles: [], knownFiles });
    const after = findBannedPatterns({ fileName: 'a.test.ts', content: "it.skip('old', () => {});\nit.todo('new');", testedFiles: [], knownFiles });
    expect(newBannedPatterns(before, after).map((pattern) => pattern.kind)).toEqual(['it.todo']);
  });
});
