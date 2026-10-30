# Backend: patterns

Use with the `unit-test-writing` skill. Each pattern below is taken from an existing test; open that file and follow it.

## Validators and mappers (`validators.test.ts`, `mappers.test.ts`)

Call the function and assert on the result. For rejections, a table with `safeParse`:

```ts
it.each([{ title: '' }, { title: 'x'.repeat(121) }, { title: 'Task', due_date: '2025-02-29' }])(
  'rejects invalid create input: %j', (input) => expect(createSchema.safeParse(input).success).toBe(false));
```

When the rule has its own message, assert the message: `expect(() => updateSchema.parse({})).toThrow('Provide at least one field');`

## Routers (`router.test.ts`)

Mount the router on a fresh Express app with a repository of `vi.fn()` methods and call it with Supertest:

```ts
function setup() {
  const repository = { list: vi.fn().mockResolvedValue([todo]), create: vi.fn().mockResolvedValue(todo), get: vi.fn(), update: vi.fn(), delete: vi.fn() };
  const app = express();
  app.use(express.json());
  app.use('/api/todos', createTodosRouter(repository));
  return { app, repository };
}

it('returns 404 when updating a missing task', async () => {
  const { app, repository } = setup();
  repository.update.mockResolvedValue(null);
  const response = await request(app).patch('/api/todos/999').send({ completed: true });
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ detail: 'Task not found.' });
});
```

Assert status and the full body. On early rejections also assert `expect(repository.update).not.toHaveBeenCalled()`. For a new fake store, type each method through the interface it replaces, so `mockResolvedValue` is checked: `get: vi.fn<TodoStore['get']>()`.

## Repository and app factory (`repository.test.ts`, `factory.test.ts`)

Build the real Prisma client and stub its IO with `vi.spyOn` on the model delegate. No PostgreSQL is needed because nothing connects until a query runs:

```ts
afterEach(() => vi.restoreAllMocks());

function setup() {
  const database = createDatabase('postgresql://test:test@localhost:5432/test');
  return { database, repository: new TodoRepository(database) };
}

it('gets a task by ID and handles missing tasks', async () => {
  const { database, repository } = setup();
  const findUnique = vi.spyOn(database.todo, 'findUnique').mockResolvedValueOnce(record).mockResolvedValueOnce(null);
  expect(await repository.get(1)).toEqual(todo);
  expect(findUnique).toHaveBeenCalledWith({ where: { id: 1 } });
  expect(await repository.get(2)).toBeNull();
});
```

- Generated timestamps: read the argument the delegate received, `const data = create.mock.calls[0][0].data`, then `expect(data.created_at).toBeInstanceOf(Date)` and `expect(data.updated_at).toEqual(data.created_at)`.
- Deliberately invalid input that the types forbid: build it at runtime, `repository.update(1, JSON.parse('{"id":2}'))`, instead of casting.

For the factory, pass the same client to `createApp(database)` and call routes with Supertest. When a case makes the error handler log, silence it: `vi.spyOn(console, 'error').mockImplementation(() => {})`.

## Configuration (`config.test.ts`)

`config.ts` reads `.env` when imported. Stub every variable, then import a fresh copy of the module:

```ts
async function setup(env: Record<string, string> = {}) {
  vi.resetModules();
  for (const name of names) vi.stubEnv(name, env[name] ?? '');
  const { resolveDatabaseUrl } = await import('../src/core/config.ts');
  return { resolveDatabaseUrl };
}

afterEach(() => {
  vi.unstubAllEnvs();
});
```

Stub variables to `''` rather than leaving them out, so a value from a real `.env` can't leak in.

## Start-up and shutdown (`lifespan.test.ts`)

Mock the modules `lifespan.ts` composes (`config.ts`, `createDatabase`, `createApp`) with `vi.mock`, fake the server with an `EventEmitter`, and capture signal handlers through `vi.spyOn(process, 'once')`. For the forced-exit deadline use fake timers and check both sides:

```ts
vi.useFakeTimers();
handlers.SIGTERM();
vi.advanceTimersByTime(9999);
expect(exit).not.toHaveBeenCalled();
vi.advanceTimersByTime(1);
expect(exit).toHaveBeenCalledWith(1);
```

Restore everything in `afterEach`: `vi.restoreAllMocks()`, `vi.unstubAllEnvs()`, `vi.useRealTimers()`. Save and restore `process.exitCode` inside any case that changes it.
