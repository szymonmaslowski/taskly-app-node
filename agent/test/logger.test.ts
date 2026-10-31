import { describe, expect, it } from 'vitest';
import { createBufferedLogger, createLogger } from '../src/logger.ts';

function collect(githubActions: boolean) {
  const lines: string[] = [];
  let clock = 0;
  const logger = createLogger({ githubActions, write: (line) => lines.push(line), now: () => (clock += 1500) });
  return { lines, logger };
}

describe('createLogger', () => {
  it('groups steps and keeps untrusted text from acting as workflow commands on GitHub Actions', () => {
    const { lines, logger } = collect(true);
    logger.startStep('plan · backend');
    logger.untrusted('::add-mask::Read src/router.ts');
    logger.info('model claude-sonnet-5-5');
    logger.endStep('6 cases planned');
    const [stop] = lines.filter((line) => line.startsWith('::stop-commands::'));
    const token = stop.slice('::stop-commands::'.length);
    expect(lines).toEqual([
      '::group::plan · backend',
      stop,
      '::add-mask::Read src/router.ts',
      `::${token}::`,
      'model claude-sonnet-5-5',
      '6 cases planned (1.5s)',
      '::endgroup::',
    ]);
  });

  it('prints plain indented lines in a terminal', () => {
    const { lines, logger } = collect(false);
    logger.startStep('write · backend');
    logger.untrusted('Edit tests/router.test.ts');
    logger.endStep('1 file written');
    expect(lines).toEqual(['▸ write · backend', '  Edit tests/router.test.ts', '  1 file written (1.5s)']);
  });
});

describe('createBufferedLogger', () => {
  it('replays a step later with the duration it really took', () => {
    let clock = 0;
    const buffered = createBufferedLogger(() => (clock += 2000));
    buffered.logger.startStep('fix · attempt 1/4');
    buffered.logger.untrusted('backend/tests/health.test.ts');
    buffered.logger.endStep('1 files changed');
    const { lines, logger } = collect(false);
    buffered.flush(logger);
    expect(lines).toEqual(['▸ fix · attempt 1/4', '  backend/tests/health.test.ts', '  1 files changed (2.0s)']);
  });

  it('keeps the original duration when one buffer is flushed into another', () => {
    let clock = 0;
    const inner = createBufferedLogger(() => (clock += 2000));
    inner.logger.startStep('plan · backend/src/api');
    inner.logger.endStep('3 cases planned');
    const outer = createBufferedLogger(() => (clock += 60_000));
    inner.flush(outer.logger);
    const { lines, logger } = collect(false);
    outer.flush(logger);
    expect(lines).toEqual(['▸ plan · backend/src/api', '  3 cases planned (2.0s)']);
  });
});
