import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createLogger } from './logger.ts';
import { runRepositoryMode } from './orchestrator.ts';
import { renderMarkdownReport } from './report/markdown.ts';
import { buildRunReport } from './report/report.ts';
import { buildSummary } from './report/summary.ts';

const { values } = parseArgs({
  options: {
    mode: { type: 'string', default: 'repo' },
    workspace: { type: 'string', multiple: true },
    module: { type: 'string' },
    'max-batches': { type: 'string' },
  },
});

if (values.mode !== 'repo') {
  console.error(`Unsupported mode "${values.mode}". Use --mode repo.`);
  process.exit(2);
}

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const logger = createLogger({ githubActions: process.env.GITHUB_ACTIONS === 'true' });
const { results, runDirectory } = await runRepositoryMode({
  repositoryRoot,
  logger,
  workspaceNames: values.workspace,
  modulePrefix: values.module,
  maxBatches: values['max-batches'] ? Number(values['max-batches']) : undefined,
});

const report = buildRunReport(results);
report.summary = buildSummary(report);
await writeFile(path.join(runDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(path.join(runDirectory, 'report.md'), renderMarkdownReport(report));
for (const paragraph of report.summary.split('\n\n')) logger.info(paragraph);
logger.info(`Report: ${path.relative(process.cwd(), path.join(runDirectory, 'report.md'))}`);
if (results.some((result) => !result.applied)) process.exitCode = 1;
