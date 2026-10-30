import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createLogger } from './logger.ts';
import { runRepositoryMode } from './orchestrator.ts';

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
const results = await runRepositoryMode({
  repositoryRoot,
  logger,
  workspaceNames: values.workspace,
  modulePrefix: values.module,
  maxBatches: values['max-batches'] ? Number(values['max-batches']) : undefined,
});

for (const result of results) {
  const remaining = result.batches.reduce((count, batch) => count + batch.remainingFailures.length, 0);
  const costUsd = result.usages.reduce((total, usage) => total + usage.costUsd, 0);
  logger.info(
    `${result.name}: ${result.changes.added.length} test files added, ${result.changes.modified.length} changed, ${remaining} files still failing, $${costUsd.toFixed(2)}`,
  );
}
