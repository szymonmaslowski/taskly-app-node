import { describe, expect, it } from 'vitest';
import { runProcess } from '../src/process.ts';

describe('runProcess', () => {
  it('returns the exit code and output of a finished process', async () => {
    const result = await runProcess('sh', ['-c', 'echo out; echo err >&2; exit 3'], { timeoutMilliseconds: 5_000 });
    expect(result).toEqual({ exitCode: 3, stdout: 'out\n', stderr: 'err\n', timedOut: false });
  });

  it('passes the input on stdin', async () => {
    const result = await runProcess('cat', [], { timeoutMilliseconds: 5_000, input: 'prompt text' });
    expect(result.stdout).toBe('prompt text');
  });

  it('kills a process that runs past its timeout', async () => {
    const result = await runProcess('sleep', ['5'], { timeoutMilliseconds: 100 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
  });

  it('caps the collected output', async () => {
    const result = await runProcess('sh', ['-c', 'printf 1234567890'], { timeoutMilliseconds: 5_000, maxOutputCharacters: 4 });
    expect(result.stdout).toBe('1234');
  });

  it('passes complete stdout lines to the line callback, including a final line without a newline', async () => {
    const lines: string[] = [];
    await runProcess('sh', ['-c', 'printf "first\\nsec"; printf "ond\\nlast"'], {
      timeoutMilliseconds: 5_000,
      onStdoutLine: (line) => lines.push(line),
    });
    expect(lines).toEqual(['first', 'second', 'last']);
  });

  it('cuts an endless line instead of buffering it without limit', async () => {
    const lines: string[] = [];
    await runProcess('sh', ['-c', 'printf 1234567890'], {
      timeoutMilliseconds: 5_000,
      maxOutputCharacters: 4,
      onStdoutLine: (line) => lines.push(line),
    });
    expect(lines.every((line) => line.length <= 4)).toBe(true);
  });
});
