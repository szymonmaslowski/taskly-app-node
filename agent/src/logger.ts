import { randomBytes } from 'node:crypto';

export type Logger = {
  startStep: (title: string) => void;
  endStep: (summary: string, durationMilliseconds?: number) => void;
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
    endStep(summary, durationMilliseconds) {
      const elapsed = durationMilliseconds ?? (stepStartedAt === undefined ? undefined : now() - stepStartedAt);
      const duration = elapsed === undefined ? '' : ` (${formatDuration(elapsed)})`;
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

type LoggerCall =
  | { method: 'startStep' | 'info' | 'untrusted'; text: string }
  | { method: 'endStep'; text: string; durationMilliseconds: number };

export function createBufferedLogger(now: () => number = Date.now) {
  const calls: LoggerCall[] = [];
  let stepStartedAt = now();
  const logger: Logger = {
    startStep(text) {
      stepStartedAt = now();
      calls.push({ method: 'startStep', text });
    },
    endStep(text) {
      calls.push({ method: 'endStep', text, durationMilliseconds: now() - stepStartedAt });
    },
    info: (text) => calls.push({ method: 'info', text }),
    untrusted: (text) => calls.push({ method: 'untrusted', text }),
  };
  return {
    logger,
    flush(target: Logger) {
      for (const call of calls.splice(0)) {
        if (call.method === 'endStep') target.endStep(call.text, call.durationMilliseconds);
        else target[call.method](call.text);
      }
    },
  };
}
