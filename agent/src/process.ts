import { spawn } from 'node:child_process';

export type ProcessResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export type RunProcessOptions = {
  cwd?: string;
  timeoutMilliseconds: number;
  maxOutputCharacters?: number;
  onStdoutLine?: (line: string) => void;
};

function appendCapped(buffer: string, chunk: string, maxCharacters: number) {
  if (buffer.length >= maxCharacters) return buffer;
  return (buffer + chunk).slice(0, maxCharacters);
}

export function runProcess(command: string, args: string[], options: RunProcessOptions) {
  const maxOutputCharacters = options.maxOutputCharacters ?? 1_000_000;
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
      stdout = appendCapped(stdout, chunk, maxOutputCharacters);
      if (!options.onStdoutLine) return;
      const lines = (pendingLine + chunk).split('\n');
      pendingLine = lines.pop() ?? '';
      if (pendingLine.length > maxOutputCharacters) {
        lines.push(pendingLine.slice(0, maxOutputCharacters));
        pendingLine = '';
      }
      for (const line of lines) options.onStdoutLine(line);
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = appendCapped(stderr, chunk, maxOutputCharacters);
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
