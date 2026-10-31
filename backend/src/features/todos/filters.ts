import type { Todo } from './types.ts';

export function dueOnOrBefore(todos: Todo[], date: string) {
  return todos.filter((todo) => todo.due_date !== null && todo.due_date <= date);
}
