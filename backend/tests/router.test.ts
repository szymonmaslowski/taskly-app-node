import express from 'express';
import request from 'supertest';
import { it, expect, vi } from 'vitest';
import { createTodosRouter } from '../src/features/todos/router.ts';
import { todo } from './fixture.ts';

function setup() {
  const repository = { list: vi.fn().mockResolvedValue([todo]), create: vi.fn().mockResolvedValue(todo), get: vi.fn(), update: vi.fn(), delete: vi.fn() };
  const app = express();
  app.use(express.json());
  app.use('/api/todos', createTodosRouter(repository));
  return { app, repository };
}
it('lists tasks from the repository', async () => {
  const { app, repository } = setup();
  const response = await request(app).get('/api/todos');
  expect(response.status).toBe(200);
  expect(response.body).toEqual([todo]);
  expect(repository.list).toHaveBeenCalledOnce();
});
it('returns only tasks due on or before due_before', async () => {
  const { app, repository } = setup();
  const early = { ...todo, id: 1, due_date: '2026-10-10' };
  const boundary = { ...todo, id: 2, due_date: '2026-10-15' };
  const late = { ...todo, id: 3, due_date: '2026-10-20' };
  const undated = { ...todo, id: 4, due_date: null };
  repository.list.mockResolvedValue([early, boundary, late, undated]);
  const response = await request(app).get('/api/todos?due_before=2026-10-15');
  expect(response.status).toBe(200);
  expect(response.body).toEqual([early, boundary]);
});
it.each(['2026-02-30', 'tomorrow', '2026-10-15T12:00:00Z'])(
  'rejects an invalid due_before with 422 without listing: %s', async (value) => {
    const { app, repository } = setup();
    const response = await request(app).get('/api/todos').query({ due_before: value });
    expect(response.status).toBe(422);
    expect(Array.isArray(response.body.detail)).toBe(true);
    expect(repository.list).not.toHaveBeenCalled();
  },
);
it('creates tasks with trimmed input and defaults', async () => {
  const { app, repository } = setup();
  const response = await request(app).post('/api/todos').send({ title: '  Plan the sprint  ', priority: 'high' });
  expect(response.status).toBe(201);
  expect(response.body).toEqual(todo);
  expect(repository.create).toHaveBeenCalledWith({ title: 'Plan the sprint', description: '', priority: 'high', due_date: null, completed: false });
});
it.each([{ title: '  ' }, { title: 'x'.repeat(121) }, { title: 'Task', priority: 'urgent' }, { title: 'Task', due_date: '2026-02-30' }])(
  'rejects invalid create input without calling the repository: %j', async (payload) => {
    const { app, repository } = setup();
    expect((await request(app).post('/api/todos').send(payload)).status).toBe(422);
    expect(repository.create).not.toHaveBeenCalled();
  },
);
it('returns a task by id', async () => {
  const { app, repository } = setup();
  repository.get.mockResolvedValue(todo);
  const response = await request(app).get('/api/todos/1');
  expect(response.status).toBe(200);
  expect(response.body).toEqual(todo);
  expect(repository.get).toHaveBeenCalledOnce();
  expect(repository.get).toHaveBeenCalledWith(1);
});
it('returns 404 when a task is missing on get', async () => {
  const { app, repository } = setup();
  repository.get.mockResolvedValue(null);
  const response = await request(app).get('/api/todos/999');
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ detail: 'Task not found.' });
});
it.each(['0', '-1', '1.5', 'abc', '9007199254740992'])(
  'rejects invalid ids with 422 without calling the repository: %s', async (id) => {
    const { app, repository } = setup();
    const response = await request(app).get(`/api/todos/${id}`);
    expect(response.status).toBe(422);
    expect(Array.isArray(response.body.detail)).toBe(true);
    expect(repository.get).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
    expect(repository.delete).not.toHaveBeenCalled();
  },
);
it('rejects an invalid id on patch and delete with 422', async () => {
  const { app, repository } = setup();
  const patched = await request(app).patch('/api/todos/abc').send({ completed: true });
  const deleted = await request(app).delete('/api/todos/0');
  expect(patched.status).toBe(422);
  expect(deleted.status).toBe(422);
  expect(repository.update).not.toHaveBeenCalled();
  expect(repository.delete).not.toHaveBeenCalled();
});
it('updates a task with the parsed partial body', async () => {
  const { app, repository } = setup();
  repository.update.mockResolvedValue(todo);
  const response = await request(app).patch('/api/todos/1').send({ title: '  New title  ', completed: true });
  expect(response.status).toBe(200);
  expect(response.body).toEqual(todo);
  expect(repository.update).toHaveBeenCalledOnce();
  expect(repository.update).toHaveBeenCalledWith(1, { title: 'New title', completed: true });
});
it.each([{}, { title: '  ' }, { priority: 'urgent' }, { unknown: 1 }])(
  'rejects invalid update bodies without calling the repository: %j', async (payload) => {
    const { app, repository } = setup();
    expect((await request(app).patch('/api/todos/1').send(payload)).status).toBe(422);
    expect(repository.update).not.toHaveBeenCalled();
  },
);
it('returns 404 when updating a missing task', async () => {
  const { app, repository } = setup();
  repository.update.mockResolvedValue(null);
  const response = await request(app).patch('/api/todos/999').send({ title: 'x' });
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ detail: 'Task not found.' });
});
it('deletes a task and responds 204 with an empty body', async () => {
  const { app, repository } = setup();
  repository.delete.mockResolvedValue(true);
  const response = await request(app).delete('/api/todos/1');
  expect(response.status).toBe(204);
  expect(response.text).toBe('');
  expect(repository.delete).toHaveBeenCalledOnce();
  expect(repository.delete).toHaveBeenCalledWith(1);
});
it('returns 404 when deleting a missing task', async () => {
  const { app, repository } = setup();
  repository.delete.mockResolvedValue(false);
  const response = await request(app).delete('/api/todos/999');
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ detail: 'Task not found.' });
});
