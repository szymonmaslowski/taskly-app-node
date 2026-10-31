import { it, expect } from 'vitest';
import { dueOnOrBefore } from '../src/features/todos/filters.ts';
import { todo } from './fixture.ts';

it('keeps tasks due on or before the date, including the boundary day', () => {
  const before = { ...todo, id: 1, due_date: '2026-10-14' };
  const on = { ...todo, id: 2, due_date: '2026-10-15' };
  const after = { ...todo, id: 3, due_date: '2026-10-16' };

  expect(dueOnOrBefore([before, on, after], '2026-10-15')).toEqual([before, on]);
});

it('leaves out tasks without a due date', () => {
  const undated = { ...todo, id: 1, due_date: null };
  const dated = { ...todo, id: 2, due_date: '2026-10-01' };

  expect(dueOnOrBefore([undated, dated], '2026-12-31')).toEqual([dated]);
});
