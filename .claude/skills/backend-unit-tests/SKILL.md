---
name: backend-unit-tests
description: Facts and conventions for unit tests of the taskly backend (Express 5, Prisma 7, Zod 4, Vitest, Supertest), with per-activity notes for planning, writing and reviewing. Use when planning, writing, reviewing or fixing tests under backend/.
---

# Backend unit tests

The backend is Express 5 with TypeScript, Prisma 7 (PostgreSQL) and Zod 4. Tests use Vitest and Supertest and never need a database.

Read the file for your activity as well:

- [planning.md](planning.md): what is worth testing in each kind of module;
- [writing.md](writing.md): ready patterns for routers, the repository, configuration and start-up;
- [reviewing.md](reviewing.md): problems specific to these tests.

## Where things are

| What | Where |
|---|---|
| Tests | `backend/tests/<module>.test.ts`, named after the module: `router.test.ts` for `src/features/todos/router.ts`. Vitest only picks up `tests/**/*.test.ts`. |
| Shared fixture | `backend/tests/fixture.ts`: `record` (a database row, `TodoRecord`) and `todo` (the same task as the API returns it, `Todo`). |
| API contract | `backend/openapi.json`: status codes, response shapes, error bodies `{ detail: ... }`. |
| Record shapes | `backend/prisma/schema.prisma` and `src/features/todos/types.ts`. |
| Not tested | `src/main.ts` (entry point), `src/generated/**` (Prisma client), `src/**/types.ts`. |

Import source files with the `.ts` extension: `import { createTodosRouter } from '../src/features/todos/router.ts';`

## Style

- Top-level `it(...)`; `describe` only when grouping helps, as in `validators.test.ts`.
- A `setup()` function per file, called at the start of every case, returning what the case needs.
- `it.each` for tables of inputs, with `%j` or `%s` in the title.
- Semicolons and single quotes. Match the spacing of the file you edit: older files are dense, newer ones (`config.test.ts`, `lifespan.test.ts`) separate arrange, act and assert with blank lines.
- Names state the behaviour: `'rejects invalid create input without calling the repository: %j'`.

## Hard limits

- No server start, database connection or network. Supertest calls the Express app in memory.
- No real `.env`: `src/core/config.ts` loads the repository's root `.env` when imported, so tests stub every variable they depend on.
- `src/features/todos/validators.ts` and `mappers.ts` must stay at 100% statements, branches, functions and lines; `vitest.config.ts` enforces it per file.

## Commands

Run from `backend/` when you can run commands. In the test agent's pipeline the orchestrator runs them.

```bash
npx vitest run tests/<module>.test.ts   # one file
npm test                                # whole suite
npm run typecheck                       # tsc --noEmit, includes tests
npx vitest run tests/<module>.test.ts --coverage --coverage.include=src/<path>/<module>.ts --coverage.reporter=text --coverage.thresholds.perFile=false
```
