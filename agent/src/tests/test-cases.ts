import ts from 'typescript';
import { resolveRelativeImport } from '../analyze/imports.ts';

const caseFunctions = new Set(['it', 'test']);
const bannedModifiers = new Set(['skip', 'only', 'todo', 'fails', 'skipIf', 'runIf']);

export type TestCase = {
  name: string;
  text: string;
  start: number;
  end: number;
  expectCount: number;
};

export type BannedPattern = {
  kind: string;
  caseName: string;
  line: number;
};

function parse(fileName: string, content: string) {
  return ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true, fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function calleeRootName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return calleeRootName(expression.expression);
  if (ts.isCallExpression(expression)) return calleeRootName(expression.expression);
  return undefined;
}

function calleeModifiers(expression: ts.Expression): string[] {
  if (ts.isPropertyAccessExpression(expression)) return [...calleeModifiers(expression.expression), expression.name.text];
  if (ts.isCallExpression(expression)) return calleeModifiers(expression.expression);
  return [];
}

function titleOf(call: ts.CallExpression, sourceFile: ts.SourceFile) {
  const [firstArgument] = call.arguments;
  if (!firstArgument) return '';
  if (ts.isStringLiteralLike(firstArgument)) return firstArgument.text;
  return firstArgument.getText(sourceFile);
}

function isExpectCall(node: ts.CallExpression) {
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text === 'expect';
  return ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'expect';
}

function countExpects(node: ts.Node): number {
  let count = 0;
  const visit = (child: ts.Node) => {
    if (ts.isCallExpression(child) && isExpectCall(child)) count += 1;
    ts.forEachChild(child, visit);
  };
  visit(node);
  return count;
}

function statementOf(node: ts.Node) {
  let current: ts.Node = node;
  while (current.parent && !ts.isExpressionStatement(current) && !ts.isSourceFile(current.parent)) current = current.parent;
  return current;
}

function isOuterCall(node: ts.CallExpression) {
  return !ts.isCallExpression(node.parent) || node.parent.expression !== node;
}

function walkCalls(sourceFile: ts.SourceFile, onCall: (call: ts.CallExpression, ancestors: string[]) => boolean) {
  const visit = (node: ts.Node, ancestors: string[]) => {
    if (ts.isCallExpression(node)) {
      const rootName = calleeRootName(node.expression);
      if (isOuterCall(node) && rootName === 'describe') {
        const title = titleOf(node, sourceFile);
        ts.forEachChild(node, (child) => visit(child, [...ancestors, title]));
        return;
      }
      if (isOuterCall(node) && rootName && caseFunctions.has(rootName) && onCall(node, ancestors)) return;
    }
    ts.forEachChild(node, (child) => visit(child, ancestors));
  };
  visit(sourceFile, []);
}

export function extractTestCases(fileName: string, content: string) {
  const sourceFile = parse(fileName, content);
  const cases: TestCase[] = [];
  walkCalls(sourceFile, (call, ancestors) => {
    const statement = statementOf(call);
    cases.push({
      name: [...ancestors, titleOf(call, sourceFile)].join(' '),
      text: statement.getText(sourceFile),
      start: statement.getStart(sourceFile),
      end: statement.getEnd(),
      expectCount: countExpects(call),
    });
    return true;
  });
  return cases;
}

type BannedPatternOptions = {
  fileName: string;
  content: string;
  testedFiles: string[];
  knownFiles: Set<string>;
};

export function findBannedPatterns({ fileName, content, testedFiles, knownFiles }: BannedPatternOptions) {
  const sourceFile = parse(fileName, content);
  const patterns: BannedPattern[] = [];
  const lineOf = (node: ts.Node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const visit = (node: ts.Node, caseName: string, insideTry: boolean) => {
    let currentCase = caseName;
    if (ts.isCallExpression(node)) {
      const rootName = calleeRootName(node.expression);
      if (rootName && (caseFunctions.has(rootName) || rootName === 'describe') && isOuterCall(node)) {
        currentCase = titleOf(node, sourceFile) || caseName;
        for (const modifier of calleeModifiers(node.expression)) {
          if (bannedModifiers.has(modifier)) patterns.push({ kind: `${rootName}.${modifier}`, caseName: currentCase, line: lineOf(node) });
        }
      }
      if (isExpectCall(node) && insideTry) patterns.push({ kind: 'expect inside try', caseName, line: lineOf(node) });
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.getText(sourceFile) === 'vi.mock') {
        const [specifier] = node.arguments;
        const mockedFile = specifier && ts.isStringLiteralLike(specifier) ? resolveRelativeImport(fileName, specifier.text, knownFiles) : undefined;
        if (mockedFile && testedFiles.includes(mockedFile)) patterns.push({ kind: 'mock of the module under test', caseName, line: lineOf(node) });
      }
    }
    if (ts.isTryStatement(node)) {
      visit(node.tryBlock, currentCase, true);
      if (node.catchClause) visit(node.catchClause, currentCase, insideTry);
      if (node.finallyBlock) visit(node.finallyBlock, currentCase, insideTry);
      return;
    }
    ts.forEachChild(node, (child) => visit(child, currentCase, insideTry));
  };
  visit(sourceFile, '', false);
  return patterns;
}

export function newBannedPatterns(before: BannedPattern[], after: BannedPattern[]) {
  const existing = new Set(before.map((pattern) => `${pattern.kind}|${pattern.caseName}`));
  return after.filter((pattern) => !existing.has(`${pattern.kind}|${pattern.caseName}`));
}
