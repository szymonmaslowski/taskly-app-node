import type { TestCaseResult, TestFileError } from './sandbox/test-results.ts';
import type { FileFailures } from './stages/prompts.ts';

const typecheckErrorPattern = /^(.+?)\(\d+,\d+\): error TS\d+:/;

type CollectFailuresOptions = {
  workspaceRoot: string;
  testFiles: string[];
  cases: TestCaseResult[];
  fileErrors: TestFileError[];
  typecheckOutput: string;
};

export function collectFailures({ workspaceRoot, testFiles, cases, fileErrors, typecheckOutput }: CollectFailuresOptions) {
  const prefix = `${workspaceRoot}/`;
  const typecheckLines = typecheckOutput.split('\n');
  const failures: FileFailures[] = [];
  for (const testFile of testFiles) {
    const workspacePath = testFile.startsWith(prefix) ? testFile.slice(prefix.length) : testFile;
    const typecheckErrors = typecheckLines.filter((line) => typecheckErrorPattern.exec(line)?.[1] === workspacePath);
    const failingCases = cases
      .filter((testCase) => testCase.file === workspacePath && testCase.status === 'failed')
      .map((testCase) => ({ fullName: testCase.fullName, failureMessages: testCase.failureMessages }));
    const loadError = fileErrors.find((error) => error.file === workspacePath)?.message;
    if (typecheckErrors.length > 0 || failingCases.length > 0 || loadError) {
      failures.push({ testFile, failingCases, loadError, typecheckErrors, bannedPatterns: [] });
    }
  }
  return failures;
}
