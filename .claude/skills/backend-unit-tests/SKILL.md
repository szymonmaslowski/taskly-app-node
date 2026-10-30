---
name: backend-unit-tests
description: Conventions for unit tests of the taskly backend (Express, Prisma, Zod, Vitest, Supertest). Use when planning, writing, reviewing or fixing backend tests.
---

# Backend unit tests

The backend is Express 5 with TypeScript, Prisma 7 (PostgreSQL) and Zod 4. Tests use Vitest and Supertest and never need a database.

## Where tests live

- Tests are in `backend/tests/`, named `<module>.test.ts` after the module under test (`router.test.ts` for `src/features/todos/router.ts`). Vitest only picks up `tests/**/*.test.ts`.
- Shared records are in `backend/tests/fixture.ts`: `record` (a database row, `TodoRecord`) and `todo` (the same task as returned by the API, `Todo`). Reuse them and spread overrides: `{ ...record, completed: true }`.
- Import source files with the `.ts` extension: `import { createTodosRouter } from '../src/features/todos/router.ts';`

## Style

Match the existing tests:

- Short, flat files: top-level `it(...)` without `describe` unless grouping really helps.
- A `setup()` function per file that builds what each case needs and returns it, called at the start of every case.
- `it.each` for tables of inputs, with `%j` or `%s` in the title.
- Semicolons, single quotes, one assertion idea per line.
- Test names state the behaviour: `'rejects invalid create input without calling the repository: %j'`.

## Patterns

**Validators and mappers** are pure: call them and assert on the result or `safeParse(...).success`. Cover boundaries (lengths, dates such as `2024-02-29` and `2025-02-29`) and every rejection rule.

**Routers**: mount the router on a fresh Express app with `express.json()` and a repository of `vi.fn()` methods, then call it with Supertest:

```ts
function setup() {
  const repository = { list: vi.fn().mockResolvedValue([todo]), create: vi.fn(), get: vi.fn(), update: vi.fn(), delete: vi.fn() };
  const app = express();
  app.use(express.json());
  app.use('/api/todos', createTodosRouter(repository));
  return { app, repository };
}
```

Assert the status code and body the API contract promises. The contract is `backend/openapi.json`: status codes, response shapes and error bodies (`{ detail: ... }`). Test against the contract, not against whatever the code returns today. For 404 and 422 paths, also assert the repository wasn't called when the request is rejected early.

**Repository and database code**: build the real Prisma client and stub its IO with `vi.spyOn` on the model delegate, so no PostgreSQL is needed:

```ts
const database = createDatabase('postgresql://test:test@localhost:5432/test');
const findMany = vi.spyOn(database.todo, 'findMany').mockResolvedValue([record]);
```

Record shapes come from `backend/prisma/schema.prisma` and `src/features/todos/types.ts`. Restore spies with `afterEach(() => vi.restoreAllMocks())`.

**App factory and health route**: `createApp(database)` takes the database as an argument, so pass an object with the delegate methods the route uses, or a real client with spied methods, and call it with Supertest.

**Configuration**: `src/core/config.ts` loads the repository's root `.env` through dotenv **when the module is imported**. Set variables with `vi.stubEnv` before importing the module (`vi.resetModules()` then `await import(...)`), and undo them with `vi.unstubAllEnvs()`. Never rely on a real `.env` file.

## Don't

- Don't start the server, connect to a database or open network connections.
- Don't test `src/main.ts` or generated Prisma code.
- Don't assert only that a mock was called when the response or result can be asserted instead.
