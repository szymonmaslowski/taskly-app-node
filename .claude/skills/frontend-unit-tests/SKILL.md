---
name: frontend-unit-tests
description: Facts and conventions for unit tests of the taskly frontend (React 19, TypeScript, TanStack Query, styled-components, Vitest, React Testing Library), with per-activity notes for planning, writing and reviewing. Use when planning, writing, reviewing or fixing tests under frontend/.
---

# Frontend unit tests

The frontend is React 19 with TypeScript, TanStack Query for server state and a styled-components design system. Tests use Vitest with jsdom, React Testing Library and user-event.

Read the file for your activity as well:

- [planning.md](planning.md): what is worth testing in each kind of module;
- [writing.md](writing.md): ready patterns for components, hooks, the API layer and pages;
- [reviewing.md](reviewing.md): problems specific to these tests.

## Where things are

| What | Where |
|---|---|
| Tests | Next to the file under test: `<File>.test.tsx` for components and hooks that render JSX in the test, `<file>.test.ts` for plain modules. |
| Setup | `src/test/setup.ts` runs before every test (jest-dom matchers, cleanup). Leave it alone unless every test needs the change. |
| Shared fixture | `todoFixture` in `src/test/todoFixture.ts`. |
| Design system mocks | `src/design-system/mocks.tsx`: plain elements that keep native attributes and callbacks. |
| Typed query results | `src/test/queryResults.ts`: `successQuery`, `pendingQuery`, `loadingErrorQuery`, `refetchErrorQuery`, `idleMutation`, `pendingMutation`, `errorMutation`, `successMutation`. |
| Not tested | `src/main.tsx`, `src/design-system/**` (styling and stories), `types.ts`, `index.ts` barrels, constants, `queryKeys.ts`, `lib/queryClient.ts`. |

Imports have no file extensions.

## Style

Follow the repo's Prettier config: no semicolons, single quotes, trailing commas, 80 columns. Top-level `it(...)`; `describe` per exported function when a module exports several, as in `utils/todos.test.ts`. Names state the behaviour from the user's side: `'displays controlled values and forwards all filter changes'`.

## Hard limits

- No real network: mock the API layer, or stub `fetch` only in `lib/http.test.ts`.
- No snapshots of whole components.
- No fixed delays; wait for what the user would see.

## Commands

Run from `frontend/` when you can run commands. In the test agent's pipeline the orchestrator runs them.

```bash
npx vitest run src/<path>/<Unit>.test.tsx   # one file
npm test                                    # whole suite
npm run typecheck                           # tsc --noEmit, includes tests
npx prettier --check <files>                # formatting, which CI checks
```
