import { it, expect } from 'vitest';
import { fromModel, toSummary } from '../src/features/todos/mappers.ts';
import { record, todo } from './fixture.ts';

it.each([false, true])('maps records to JSON without mutation (completed: %s)', (completed) => {
  const input = { ...record, completed };
  const before = structuredClone(input);
  expect(fromModel(input)).toEqual({ ...todo, completed });
  expect(input).toEqual(before);
});
it('preserves an absent due date', () => {
  expect(fromModel({ ...record, due_date: null }).due_date).toBeNull();
});
it('rejects invalid stored data', () => {
  expect(() => fromModel({ ...record, title: '' })).toThrow();
});
it('summarises a task with a due date as title, priority and due date', () => {
  expect(toSummary({ ...todo, completed: false })).toBe('Plan the sprint (high, due 2026-10-15)');
});
it('summarises a task without a due date and omits the due part', () => {
  expect(toSummary({ ...todo, due_date: null })).toBe('Plan the sprint (high)');
});
it.each([
  ['2026-10-15', 'Plan the sprint (high, due 2026-10-15) ✓'],
  [null, 'Plan the sprint (high) ✓'],
])('appends a check mark for completed tasks (due date: %s)', (due_date, expected) => {
  expect(toSummary({ ...todo, due_date, completed: true })).toBe(expected);
});
