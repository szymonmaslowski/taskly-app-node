# Frontend: what to plan per module

Use with the `unit-test-planning` skill. Describe behaviour as the user sees it, or as the caller of a hook or function sees it. Name the text, role or label the case relies on, so the reviewer can check it against the markup.

## Pure utilities (`features/todos/utils/todos.ts`)

- Validation: each message, at the limit and one past it (title 120/121, description 2000/2001 after trimming), invalid calendar dates such as `2026-02-30`, an empty due date being allowed.
- Filtering and sorting: each filter value, search across title and description ignoring case, each sort order with its tie-breaker.
- Date logic that reads the clock (`isOverdue`): yesterday, today and tomorrow against a fixed system time; completed and undated tasks.
- Formatting: one representative value per format.

## Components (`components/**`, `features/todos/components/**`)

- What renders for each state the props allow: empty, loading, busy, error, completed against active.
- Each user action and the callback it fires, with its arguments. For a component, forwarding a callback is the behaviour.
- Disabled states: what a busy flag prevents.
- Accessible names the user relies on: a button's label that includes the task title, a checkbox label that changes with state.
- Form validation messages and that an invalid form doesn't submit.

## Hooks (`hooks/**`, `features/todos/hooks/**`)

- Query hooks: the data returned, loading and error states, the abort signal passed to the API.
- Mutation hooks: the API call made and how the query cache changes afterwards (item added, replaced, removed), including when no list is cached yet. The cache is the behaviour other components depend on.
- State hooks: initial value, each update, timers (both sides of the deadline), cleanup on unmount.

## API layer (`features/todos/api/todos.ts`, `lib/http.ts`)

- `todos.ts`: the path, method and body each function sends, that only writable fields are sent, and what it returns.
- `http.ts`: JSON responses, 204, network failure, aborted requests (rethrown as-is), 422 with the fixed message, other errors with and without a string `detail`, merged headers.

## Pages and providers (`TodosPage.tsx`, `app/AppProviders.tsx`, `App.tsx`)

How the page wires hooks and child components together: which state reaches which child, which hook a child's action calls, which notice appears after success. Mock the hooks and children; detailed behaviour of each child belongs in its own test.

## Skip

Styling, design-system internals, Storybook stories, `main.tsx`, re-export barrels, constants, types.
