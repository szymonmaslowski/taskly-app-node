import { todoSchema } from './validators.ts';
import type { TodoRecord, Todo } from './types.ts';

export function fromModel(record: TodoRecord): Todo {
  return todoSchema.parse({
    id: record.id,
    title: record.title,
    description: record.description,
    priority: record.priority,
    due_date: record.due_date?.toISOString().slice(0, 10) ?? null,
    completed: record.completed,
    created_at: record.created_at.toISOString(),
    updated_at: record.updated_at.toISOString(),
  });
}

export function toSummary(todo: Todo) {
  const due = todo.due_date ? `, due ${todo.due_date}` : '';
  return `${todo.title} (${todo.priority}${due})${todo.completed ? ' ✓' : ''}`;
}
