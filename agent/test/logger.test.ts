import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/logger.ts';

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
