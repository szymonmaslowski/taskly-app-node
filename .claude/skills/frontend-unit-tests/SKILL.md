---
name: frontend-unit-tests
description: Conventions for unit tests of the taskly frontend (React 19, TypeScript, TanStack Query, styled-components, Vitest, React Testing Library). Use when planning, writing, reviewing or fixing frontend tests.
---

# Frontend unit tests

The frontend is React 19 with TypeScript, TanStack Query for server state and a styled-components design system. Tests use Vitest with jsdom, React Testing Library and user-event.

## Where tests live

- Tests sit next to the file under test, named `<File>.test.tsx` for components and `<file>.test.ts` for plain modules and hooks.
- `src/test/setup.ts` runs before every test (jest-dom matchers, cleanup). Leave it alone unless every test needs the change.
- The shared task fixture is `todoFixture` in `src/test/todoFixture.ts`. Spread overrides: `{ ...todoFixture, completed: true }`.
- Imports have no file extensions.

## Style

Match the existing tests and the repo's Prettier config: no semicolons, single quotes, trailing commas. Top-level `it(...)` with names that state the behaviour from the user's side: `'displays controlled values and forwards all filter changes'`.

## Patterns

**Components**: render, act like a user, assert what the user sees.

```tsx
vi.mock('../../../design-system', () => import('../../../design-system/mocks'))

it('forwards search input', async () => {
  const user = userEvent.setup()
  const onSearchChange = vi.fn()
  render(<TodoFilters filter="all" search="" sort="newest" onSearchChange={onSearchChange} ... />)
  await user.type(screen.getByLabelText('Search tasks'), 'a')
  expect(onSearchChange).toHaveBeenCalledWith('a')
})
```

- Mock the design system with its ready-made mocks: `vi.mock('<relative path>/design-system', () => import('<relative path>/design-system/mocks'))`. Adjust the relative path to the test file.
- Query by role or label first (`getByRole('button', { name: 'Save' })`, `getByLabelText(...)`), text second, never by class or test id unless nothing else works.
- Use `userEvent.setup()` and `await user.click/type/selectOptions`, not `fireEvent`.
- For callbacks passed as props, assert the call with the expected arguments. That is the component's behaviour.

**Hooks**: use `renderHook`. For hooks built on TanStack Query, wrap them in a provider with a fresh client per test so cache and retries don't leak between cases:

```tsx
function createWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
```

Mock the API layer, not `fetch`: `vi.mock('<relative path>/api/todos', () => ({ todosApi: { list: vi.fn(), create: vi.fn(), ... } }))`. Assert on what the hook returns and on the query cache (`client.getQueryData(todoKeys.list)`).

**API modules** (`features/todos/api/todos.ts`): mock `lib/http`'s `request` with `vi.mock('../../../lib/http', () => ({ request: vi.fn() }))`, then assert the path and options it was called with and what the function returns.

**`lib/http.ts`** itself: stub the global `fetch` with `vi.stubGlobal('fetch', vi.fn())` and undo it with `vi.unstubAllGlobals()`. Cover network failure, aborted requests, 422, other error statuses with and without a `detail` string, 204 and JSON responses.

**Pages** (`TodosPage`): mock the hooks and child components the page composes, as `TodosPage.test.tsx` does, and test how the page wires them together.

## Don't

- Don't test the design system's styling, Storybook stories or `main.tsx`.
- Don't snapshot whole components.
- Don't rely on timing; use `findBy...` or `waitFor` for asynchronous updates.
