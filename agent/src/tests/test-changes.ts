import { extractTestCases, type TestCase } from './test-cases.ts';

export type CaseChange =
  | { kind: 'added'; name: string; expectCount: number }
  | { kind: 'deleted'; name: string; expectCount: number }
  | { kind: 'modified'; name: string; expectsBefore: number; expectsAfter: number; before: string; after: string };

function indexByName(cases: TestCase[]) {
  const casesByName = new Map<string, TestCase>();
  for (const testCase of cases) if (!casesByName.has(testCase.name)) casesByName.set(testCase.name, testCase);
  return casesByName;
}

export function compareTestFile(fileName: string, before: string | undefined, after: string | undefined) {
  const casesBefore = indexByName(before === undefined ? [] : extractTestCases(fileName, before));
  const casesAfter = indexByName(after === undefined ? [] : extractTestCases(fileName, after));
  const changes: CaseChange[] = [];
  for (const [name, caseAfter] of casesAfter) {
    const caseBefore = casesBefore.get(name);
    if (!caseBefore) changes.push({ kind: 'added', name, expectCount: caseAfter.expectCount });
    else if (caseBefore.text !== caseAfter.text) {
      changes.push({
        kind: 'modified',
        name,
        expectsBefore: caseBefore.expectCount,
        expectsAfter: caseAfter.expectCount,
        before: caseBefore.text,
        after: caseAfter.text,
      });
    }
  }
  for (const [name, caseBefore] of casesBefore) {
    if (!casesAfter.has(name)) changes.push({ kind: 'deleted', name, expectCount: caseBefore.expectCount });
  }
  return changes;
}

function escapeForPattern(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function matchesCaseName(sourceName: string, runtimeName: string) {
  if (sourceName === runtimeName) return true;
  const pattern = sourceName
    .split(/(%[sdifjo#%]|\$[\w.]+)/)
    .map((part, index) => (index % 2 === 1 ? '.*' : escapeForPattern(part)))
    .join('');
  return new RegExp(`^${pattern}$`, 's').test(runtimeName);
}

// A runtime name counts as matched only when exactly one case has a matching, unique name; anything else can't be cleaned up case by case.
export function matchFailingCases(fileName: string, content: string, runtimeNames: string[]) {
  const cases = extractTestCases(fileName, content);
  const nameCounts = new Map<string, number>();
  for (const testCase of cases) nameCounts.set(testCase.name, (nameCounts.get(testCase.name) ?? 0) + 1);
  const matched = new Set<TestCase>();
  let allMatched = true;
  for (const runtimeName of runtimeNames) {
    const candidates = cases.filter((testCase) => matchesCaseName(testCase.name, runtimeName));
    if (candidates.length === 1 && nameCounts.get(candidates[0].name) === 1) matched.add(candidates[0]);
    else allMatched = false;
  }
  return { cases: [...matched], allMatched };
}

export function findCasesByRuntimeNames(fileName: string, content: string, runtimeNames: string[]) {
  return extractTestCases(fileName, content).filter((testCase) =>
    runtimeNames.some((runtimeName) => matchesCaseName(testCase.name, runtimeName)),
  );
}

function withoutTrailingNewline(content: string, end: number) {
  return content[end] === '\n' ? end + 1 : end;
}

export function removeCases(fileName: string, content: string, caseNames: string[]) {
  const names = new Set(caseNames);
  const casesToRemove = extractTestCases(fileName, content)
    .filter((testCase) => names.has(testCase.name))
    .sort((first, second) => second.start - first.start);
  let result = content;
  for (const testCase of casesToRemove) {
    result = result.slice(0, testCase.start) + result.slice(withoutTrailingNewline(result, testCase.end));
  }
  return result;
}

export function revertCases(fileName: string, after: string, before: string, caseNames: string[]) {
  const originals = indexByName(extractTestCases(fileName, before));
  const names = new Set(caseNames);
  const casesToRevert = extractTestCases(fileName, after)
    .filter((testCase) => names.has(testCase.name) && originals.has(testCase.name))
    .sort((first, second) => second.start - first.start);
  let result = after;
  for (const testCase of casesToRevert) {
    result = result.slice(0, testCase.start) + (originals.get(testCase.name)?.text ?? '') + result.slice(testCase.end);
  }
  return result;
}
