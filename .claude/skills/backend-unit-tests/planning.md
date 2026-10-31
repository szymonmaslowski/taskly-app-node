# Backend: what to plan per module

Use with the `unit-test-planning` skill. The contract decides the expected behaviour (the oracle in `unit-test-principles`). `backend/openapi.json` is the contract for every route. When the source disagrees with it, plan the case as the contract says and mark it `Contract mismatch:` in `reason`.

## Validators (`src/features/todos/validators.ts`)

Pure Zod schemas. Every rule has two sides; plan both.

- Lengths at the limit and one past it, for the limits the contract and the schema define: title at its minimum and maximum against empty, whitespace only and one past the maximum; description at its maximum against one past it. Trimming happens before the length check.
- Enums: every allowed `priority`, one value outside.
- Dates: calendar validity, not format only. `2024-02-29` passes, `2025-02-29` and `2026-02-30` fail, a datetime string fails.
- Defaults on create; `null` against absent on update; strict objects reject unknown keys; an empty update body fails with its own message.
- `idSchema`: coercion from strings, and rejection of `0`, negatives, decimals, non-numbers and values above `Number.MAX_SAFE_INTEGER`.

## Mappers (`src/features/todos/mappers.ts`)

Record to API shape: dates become ISO strings, `due_date` becomes a calendar date or `null`, the input isn't mutated, invalid stored data throws.

## Routers (`src/features/todos/router.ts`, `src/api/health.ts`)

For each route, one case per outcome the contract lists:

- success: status and full body;
- not found: 404 with `{ detail: 'Task not found.' }`;
- invalid id or body: 422, and the repository isn't called;
- input the route transforms before the repository sees it (trimming, defaults): assert the repository call, because that transformation is the behaviour;
- 204 responses have an empty body.

Errors the repository throws are handled by the app factory, not the router. Plan them in `factory.test.ts`.

## Repository (`src/features/todos/repository.ts`)

There is no database in unit tests, so the Prisma query arguments are the behaviour here: ordering, `where` clauses, which fields an update sends, timestamps set on create. Also plan the not-found result (`null` or `false`) and the mapping of returned rows.

## App factory (`src/factory.ts`)

Middleware and error handling: malformed JSON (422 `Invalid JSON.`), oversized bodies (413), unknown routes (JSON 404), unexpected errors (500 with a body that leaks nothing), the `x-powered-by` header, the OpenAPI and docs routes.

## Configuration and start-up (`src/core/config.ts`, `src/core/database.ts`, `src/core/lifespan.ts`)

- Configuration: precedence of an explicit URL over `DATABASE_URL` over the `POSTGRES_*` parts, encoding of special characters, the error naming the first missing variable.
- Start-up: the order connect → initialise → listen, cleanup when any step fails, signal handlers, and both sides of the forced-exit deadline.

## Skip

`src/main.ts`, `src/generated/**`, `types.ts` files, and anything that is only wiring with no branch.
