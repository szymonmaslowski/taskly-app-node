import { z } from 'zod';

export const containerWorkspacePath = '/workspace/';

const vitestJsonReportSchema = z.object({
  testResults: z.array(
    z.object({
      name: z.string(),
      status: z.string(),
      message: z.string().optional(),
      assertionResults: z.array(
        z.object({
          fullName: z.string(),
          title: z.string(),
          ancestorTitles: z.array(z.string()),
          status: z.string(),
          failureMessages: z.array(z.string()).nullish(),
        }),
      ),
    }),
  ),
});

export type TestCaseStatus = 'passed' | 'failed' | 'skipped';

export type TestCaseResult = {
  file: string;
  fullName: string;
  title: string;
  ancestorTitles: string[];
  status: TestCaseStatus;
  failureMessages: string[];
};

export type TestFileError = {
  file: string;
  message: string;
};

function toWorkspaceRelativePath(containerPath: string) {
  return containerPath.startsWith(containerWorkspacePath) ? containerPath.slice(containerWorkspacePath.length) : containerPath;
}

function toTestCaseStatus(status: string): TestCaseStatus {
  if (status === 'passed' || status === 'failed') return status;
  return 'skipped';
}

export function parseVitestJsonReport(report: unknown) {
  const parsed = vitestJsonReportSchema.parse(report);
  const cases: TestCaseResult[] = [];
  const fileErrors: TestFileError[] = [];
  for (const fileResult of parsed.testResults) {
    const file = toWorkspaceRelativePath(fileResult.name);
    const hasFailedCase = fileResult.assertionResults.some((assertion) => assertion.status === 'failed');
    if (fileResult.status === 'failed' && (fileResult.message || !hasFailedCase)) {
      fileErrors.push({ file, message: fileResult.message || 'The test file failed outside its test cases.' });
    }
    for (const assertion of fileResult.assertionResults) {
      cases.push({
        file,
        fullName: assertion.fullName,
        title: assertion.title,
        ancestorTitles: assertion.ancestorTitles,
        status: toTestCaseStatus(assertion.status),
        failureMessages: assertion.failureMessages ?? [],
      });
    }
  }
  return { cases, fileErrors };
}
