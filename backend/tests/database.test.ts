import { expect, it, vi } from 'vitest';
import { initialize } from '../src/core/database.ts';
import type { Database } from '../src/features/todos/types.ts';

function setup() {
  const executeRaw = vi.fn().mockResolvedValue(0);
  const database = { $executeRaw: executeRaw } as unknown as Database;
  return { database, executeRaw };
}

it('initialize creates the todos table only if it does not exist', async () => {
  const { database, executeRaw } = setup();

  await initialize(database);

  expect(executeRaw).toHaveBeenCalledTimes(1);
  const sql = (executeRaw.mock.calls[0][0] as string[]).join('');
  expect(sql).toContain('CREATE TABLE IF NOT EXISTS todos');
  expect(sql).toContain('title ');
  expect(sql).toContain('description ');
  expect(sql).toContain('priority ');
  expect(sql).toContain('due_date ');
  expect(sql).toContain('completed ');
  expect(sql).toContain('created_at ');
  expect(sql).toContain('updated_at ');
});
