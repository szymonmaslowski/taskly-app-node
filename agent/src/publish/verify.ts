import { loadConfig } from '../config.ts';
import { measureCoverage } from '../analyze/repository.ts';
import { collectFailures } from '../failures.ts';
import { totalCoverage, type CoverageTotals } from '../report/report.ts';
import { createRunDirectories, removeRunDirectories } from '../sandbox/directories.ts';
import { listTrackedFiles } from '../sandbox/files.ts';
import { buildImages } from '../sandbox/images.ts';
import { installRunnerWorkspace, prepareRunnerWorkspace, runTypecheck } from '../sandbox/runner.ts';
import { listChangedPaths } from './patch.ts';

export type WorkspaceVerification = {
  name: string;
  typecheckPassed: boolean;
  testsPassed: number;
  testsFailed: number;
  failingTestFiles: string[];
  coverage: CoverageTotals;
};

// Runs in a job without secrets: the patched head is installed, typechecked and tested in the runner, like any other PR code.
export async function verifyPatchedCheckout(trustedRepositoryRoot: string, repositoryRoot: string) {
  const config = await loadConfig(trustedRepositoryRoot);
  await buildImages(trustedRepositoryRoot, ['runner']);
  const trackedFiles = await listTrackedFiles(repositoryRoot);
  const changedPaths = new Set(await listChangedPaths(repositoryRoot));
  const workspaces: WorkspaceVerification[] = [];
  const problems: string[] = [];
  for (const [name, workspace] of Object.entries(config.workspaces)) {
    const changedInWorkspace = [...changedPaths].filter((changedPath) => changedPath.startsWith(`${workspace.root}/`));
    if (changedInWorkspace.length === 0) continue;
    const directories = await createRunDirectories();
    try {
      await prepareRunnerWorkspace({ repositoryRoot, trackedFiles, workspace, destination: directories.runner });
      await installRunnerWorkspace(directories.runner, directories.output, workspace);
      const typecheck = await runTypecheck(directories.runner, directories.output, workspace);
      const { testRun, coverage } = await measureCoverage({ runnerDirectory: directories.runner, outputDirectory: directories.output, workspace });
      const failures = collectFailures({
        workspaceRoot: workspace.root,
        testFiles: [...new Set([...testRun.cases.map((testCase) => `${workspace.root}/${testCase.file}`), ...changedInWorkspace])],
        cases: testRun.cases,
        fileErrors: testRun.fileErrors,
        typecheckOutput: typecheck.output,
      });
      const failingTestFiles = failures.filter((failure) => failure.failingCases.length > 0 || failure.loadError).map((failure) => failure.testFile);
      for (const failure of failures.filter((candidate) => changedInWorkspace.includes(candidate.testFile))) {
        problems.push(`${failure.testFile}, which the agent changed, ${failure.typecheckErrors.length > 0 ? 'does not compile' : 'fails'}`);
      }
      workspaces.push({
        name,
        typecheckPassed: typecheck.passed,
        testsPassed: testRun.cases.filter((testCase) => testCase.status === 'passed').length,
        testsFailed: testRun.cases.filter((testCase) => testCase.status === 'failed').length + testRun.fileErrors.length,
        failingTestFiles,
        coverage: totalCoverage(coverage),
      });
    } finally {
      await removeRunDirectories(directories);
    }
  }
  return { workspaces, problems };
}
