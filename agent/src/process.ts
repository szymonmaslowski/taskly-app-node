import { spawn } from 'node:child_process';

export type ProcessResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

type RunProcessOptions = {
  cwd?: string;
  timeoutMilliseconds: number;
  maxOutputBytes?: number;
  onStdoutLine?: (line: string) => void;
};

function appendCapped(buffer: string, chunk: string, maxBytes: number) {
  if (buffer.length >= maxBytes) return buffer;
  return (buffer + chunk).slice(0, maxBytes);
}

export function runProcess(command: string, args: string[], options: RunProcessOptions) {
  const maxOutputBytes = options.maxOutputBytes ?? 1_000_000;
  return new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let pendingLine = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMilliseconds);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout = appendCapped(stdout, chunk, maxOutputBytes);
      if (!options.onStdoutLine) return;
      const lines = (pendingLine + chunk).split('\n');
      pendingLine = lines.pop() ?? '';
      for (const line of lines) options.onStdoutLine(line);
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = appendCapped(stderr, chunk, maxOutputBytes);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      if (pendingLine && options.onStdoutLine) options.onStdoutLine(pendingLine);
      resolve({ exitCode, stdout, stderr, timedOut });
    });
  });
}
