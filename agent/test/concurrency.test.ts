import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from '../src/concurrency.ts';

describe('mapWithConcurrency', () => {
  it('keeps the result order and never runs more operations at once than the limit', async () => {
    let running = 0;
    let mostRunning = 0;
    const results = await mapWithConcurrency([30, 10, 20, 5], 2, async (delay) => {
      running += 1;
      mostRunning = Math.max(mostRunning, running);
      await new Promise((resolve) => setTimeout(resolve, delay));
      running -= 1;
      return delay * 2;
    });
    expect(results).toEqual([60, 20, 40, 10]);
    expect(mostRunning).toBe(2);
  });
});
