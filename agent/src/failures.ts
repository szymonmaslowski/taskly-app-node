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

// tsc prints the details of an error, such as which property is missing, on indented lines after it.
function groupTypecheckErrors(typecheckOutput: string) {
  const errors: { file: string; text: string }[] = [];
  for (const line of typecheckOutput.split('\n')) {
    const file = typecheckErrorPattern.exec(line)?.[1];
    if (file !== undefined) errors.push({ file, text: line });
    else if (/^\s+\S/.test(line) && errors.length > 0) errors[errors.length - 1].text += `\n${line}`;
  }
  return errors;
}

export function collectFailures({ workspaceRoot, testFiles, cases, fileErrors, typecheckOutput }: CollectFailuresOptions) {
  const prefix = `${workspaceRoot}/`;
  const typecheckErrors = groupTypecheckErrors(typecheckOutput);
  const failures: FileFailures[] = [];
  for (const testFile of testFiles) {
    const workspacePath = testFile.startsWith(prefix) ? testFile.slice(prefix.length) : testFile;
    const fileTypecheckErrors = typecheckErrors.filter((error) => error.file === workspacePath).map((error) => error.text);
    const failingCases = cases
      .filter((testCase) => testCase.file === workspacePath && testCase.status === 'failed')
      .map((testCase) => ({ fullName: testCase.fullName, failureMessages: testCase.failureMessages }));
    const loadError = fileErrors.find((error) => error.file === workspacePath)?.message;
    if (fileTypecheckErrors.length > 0 || failingCases.length > 0 || loadError) {
      failures.push({ testFile, failingCases, loadError, typecheckErrors: fileTypecheckErrors, bannedPatterns: [] });
    }
  }
  return failures;
}
