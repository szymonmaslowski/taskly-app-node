import { randomBytes } from 'node:crypto';

export type Logger = {
  startStep: (title: string) => void;
  endStep: (summary: string) => void;
  info: (line: string) => void;
  untrusted: (line: string) => void;
};

type CreateLoggerOptions = {
  githubActions: boolean;
  write?: (line: string) => void;
  now?: () => number;
};

function formatDuration(milliseconds: number) {
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

export function createLogger({ githubActions, write = (line) => process.stdout.write(`${line}\n`), now = Date.now }: CreateLoggerOptions): Logger {
  const stopToken = randomBytes(16).toString('hex');
  let commandsStopped = false;
  let stepStartedAt: number | undefined;

  function resumeCommands() {
    if (!commandsStopped) return;
    write(`::${stopToken}::`);
    commandsStopped = false;
  }

  function stopCommands() {
    if (commandsStopped || !githubActions) return;
    write(`::stop-commands::${stopToken}`);
    commandsStopped = true;
  }

  const indent = githubActions ? '' : '  ';

  return {
    startStep(title) {
      stepStartedAt = now();
      resumeCommands();
      write(githubActions ? `::group::${title}` : `▸ ${title}`);
    },
    endStep(summary) {
      const duration = stepStartedAt === undefined ? '' : ` (${formatDuration(now() - stepStartedAt)})`;
      stepStartedAt = undefined;
      resumeCommands();
      write(`${indent}${summary}${duration}`);
      if (githubActions) write('::endgroup::');
    },
    info(line) {
      resumeCommands();
      write(`${indent}${line}`);
    },
    untrusted(line) {
      stopCommands();
      write(`${indent}${line}`);
    },
  };
}
