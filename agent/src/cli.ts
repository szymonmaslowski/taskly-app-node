import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createLogger } from './logger.ts';
import { runAgent, type RunMode } from './orchestrator.ts';
import { renderMarkdownReport } from './report/markdown.ts';
import { buildRunReport } from './report/report.ts';
import { buildSummary } from './report/summary.ts';

const { values } = parseArgs({
  options: {
    mode: { type: 'string', default: 'repo' },
    workspace: { type: 'string', multiple: true },
    module: { type: 'string' },
    'max-batches': { type: 'string' },
    repository: { type: 'string' },
    base: { type: 'string' },
    head: { type: 'string' },
    'description-file': { type: 'string' },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

async function readMode(): Promise<RunMode> {
  if (values.mode === 'pr') {
    if (!values.base || !values.head) fail('--mode pr needs --base and --head commit hashes.');
    const description = values['description-file'] ? await readFile(values['description-file'], 'utf8') : undefined;
    return { kind: 'pr', baseSha: values.base, headSha: values.head, description };
  }
  if (values.mode !== 'repo') fail(`Unsupported mode "${values.mode}". Use --mode repo or --mode pr.`);
  const maxBatches = values['max-batches'] === undefined ? undefined : Number(values['max-batches']);
  if (maxBatches !== undefined && (!Number.isInteger(maxBatches) || maxBatches < 1)) {
    fail(`--max-batches must be a positive whole number, got "${values['max-batches']}".`);
  }
  return { kind: 'repo', modulePrefix: values.module, maxBatches };
}

const mode = await readMode();
const trustedRepositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const logger = createLogger({ githubActions: process.env.GITHUB_ACTIONS === 'true' });
const { results, runDirectory } = await runAgent({
  trustedRepositoryRoot,
  repositoryRoot: values.repository ? path.resolve(values.repository) : trustedRepositoryRoot,
  logger,
  mode,
  workspaceNames: values.workspace,
});

const report = buildRunReport(results, mode.kind);
report.summary = buildSummary(report);
await writeFile(path.join(runDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(path.join(runDirectory, 'report.md'), renderMarkdownReport(report));
for (const paragraph of report.summary.split('\n\n')) logger.info(paragraph);
logger.info(`Report: ${path.relative(process.cwd(), path.join(runDirectory, 'report.md'))}`);
if (results.some((result) => !result.applied)) process.exitCode = 1;
