import { Router } from 'express';
import type { Database } from '../features/todos/types.ts';

export function createHealthRouter(database: Database) {
  const router = Router();
  router.get('/health', async (req, res) => {
    await database.todo.findFirst({ select: { id: true } });
    res.json({ status: 'ok' });
  });
  return router;
}
