import { afterEach, it, expect, vi } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { createDatabase } from '../src/core/database.ts';
import { createApp } from '../src/factory.ts';

afterEach(() => vi.restoreAllMocks());

function setup() {
  const database = createDatabase('postgresql://test:test@localhost:5432/test');
  return { database, app: createApp(database) };
}

it("responds 422 'Invalid JSON.' for a malformed JSON body", async () => {
  const { database, app } = setup();
  const create = vi.spyOn(database.todo, 'create');

  const response = await request(app).post('/api/todos').set('Content-Type', 'application/json').send('{"title":');

  expect(response.status).toBe(422);
  expect(response.body).toEqual({ detail: 'Invalid JSON.' });
  expect(create).not.toHaveBeenCalled();
});

it("responds 413 'Request body too large.' for an oversized body", async () => {
  const { database, app } = setup();
  const create = vi.spyOn(database.todo, 'create');

  const response = await request(app).post('/api/todos').send({ title: 'x'.repeat(200000) });

  expect(response.status).toBe(413);
  expect(response.body).toEqual({ detail: 'Request body too large.' });
  expect(create).not.toHaveBeenCalled();
});

it('responds 500 with a generic body and logs the error when the database throws', async () => {
  const { database, app } = setup();
  const error = new Error('connection refused: secret-host');
  vi.spyOn(database.todo, 'findFirst').mockRejectedValue(error);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});

  const response = await request(app).get('/api/health');

  expect(response.status).toBe(500);
  expect(response.body).toEqual({ detail: 'Internal Server Error' });
  expect(response.text).not.toContain('secret-host');
  expect(log).toHaveBeenCalledTimes(1);
  expect(log).toHaveBeenCalledWith(error);
});

it.each(['boom', null])('responds 500 for a thrown value that is not an object: %j', async (thrown) => {
  const { database, app } = setup();
  vi.spyOn(database.todo, 'findFirst').mockRejectedValue(thrown);
  vi.spyOn(console, 'error').mockImplementation(() => {});

  const response = await request(app).get('/api/health');

  expect(response.status).toBe(500);
  expect(response.body).toEqual({ detail: 'Internal Server Error' });
});

it('responds 500 for an object error whose type is unrelated', async () => {
  const { database, app } = setup();
  vi.spyOn(database.todo, 'findFirst').mockRejectedValue({ type: 'something.else' });
  vi.spyOn(console, 'error').mockImplementation(() => {});

  const response = await request(app).get('/api/health');

  expect(response.status).toBe(500);
  expect(response.body).toEqual({ detail: 'Internal Server Error' });
});

it('serves the health route under /api with a database ping', async () => {
  const { database, app } = setup();
  const findFirst = vi.spyOn(database.todo, 'findFirst').mockResolvedValue(null);

  const response = await request(app).get('/api/health');

  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: 'ok' });
  expect(findFirst).toHaveBeenCalledTimes(1);
  expect(findFirst).toHaveBeenCalledWith({ select: { id: true } });
});

it('mounts the todos router under /api/todos on a repository built from the database', async () => {
  const { database, app } = setup();
  const findMany = vi.spyOn(database.todo, 'findMany').mockResolvedValue([]);

  const response = await request(app).get('/api/todos');

  expect(response.status).toBe(200);
  expect(response.body).toEqual([]);
  expect(findMany).toHaveBeenCalledTimes(1);
});

it('serves the OpenAPI specification at /openapi.json', async () => {
  const { app } = setup();
  const specification = JSON.parse(readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'));

  const response = await request(app).get('/openapi.json');

  expect(response.status).toBe(200);
  expect(response.body).toEqual(specification);
});

it('serves the Swagger UI docs at /docs', async () => {
  const { app } = setup();

  const response = await request(app).get('/docs/');

  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toContain('text/html');
});

it('responds with a JSON 404 for unknown routes', async () => {
  const { database, app } = setup();
  vi.spyOn(database.todo, 'findFirst').mockResolvedValue(null);

  const unknown = await request(app).get('/api/unknown');
  const health = await request(app).get('/api/health');

  expect(unknown.status).toBe(404);
  expect(unknown.body).toEqual({ detail: 'Not Found' });
  expect(unknown.headers['content-type']).toContain('application/json');
  expect(health.status).toBe(200);
});

it('does not send the x-powered-by header', async () => {
  const { database, app } = setup();
  vi.spyOn(database.todo, 'findFirst').mockResolvedValue(null);

  const response = await request(app).get('/api/health');

  expect(response.headers['x-powered-by']).toBeUndefined();
});
