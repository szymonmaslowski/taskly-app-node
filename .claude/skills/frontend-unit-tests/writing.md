# Frontend: patterns

Use with the `unit-test-writing` skill. Each pattern below is taken from an existing test; open that file and follow it.

## Components (`TodoItem.test.tsx`, `TodoFilters.test.tsx`)

Render, act like a user, assert what the user sees and which callback fired:

```tsx
vi.mock('../../../design-system', () => import('../../../design-system/mocks'))

it('shows an active task and forwards edit requests', async () => {
  const user = userEvent.setup()
  const onEdit = vi.fn()
  render(<TodoItem todo={todoFixture} busy={false} onEdit={onEdit} onToggle={vi.fn()} onDelete={vi.fn()} />)
  expect(screen.getByRole('heading', { name: todoFixture.title })).toBeVisible()
  await user.click(screen.getByRole('button', { name: `Edit: ${todoFixture.title}` }))
  expect(onEdit).toHaveBeenCalledTimes(1)
})
```

- Always mock the design system with its ready mocks; adjust the relative path to the test file. The mocks render native elements: `Button` and `IconButton` a `<button>`; `Input` and `Select` a `<label>` around the control, so query them with `getByLabelText`; `Checkbox` a native checkbox in a label; `Drawer` an element with `role="dialog"` and `aria-label={title}` plus a "Close" button, and nothing when closed; `Alert` an element with `data-testid="alert"`. Don't assert design-system props such as `variant`; the mocks drop them.
- Query by role and accessible name first, then label, then text. The only test id is `alert`. Use `queryBy...` to assert absence and `findBy...` for what appears after async work.
- `userEvent.setup()` once per case, before `render`, and `await user.click/type/selectOptions`; not `fireEvent`. With fake timers: `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`, or user-event hangs.
- `waitFor` only wraps an assertion about an async result, never an action.
- When many cases render the same component, add a `render<Component>()` helper with default `vi.fn()` handlers, as `TodoItem.test.tsx` does.

## Components that use a hook (`DeleteTodoDialog.test.tsx`)

Mock the hook module and return a typed result from the factories in `src/test/queryResults.ts`. The factory you pick sets the state flags, so the result is always a valid TanStack state; overrides cover the rest (`mutateAsync`, `refetch`, `isFetching`):

```tsx
import { errorMutation, idleMutation, successQuery } from '../../../test/queryResults'

vi.mock('../hooks/useDeleteTodoMutation', () => ({ useDeleteTodoMutation: vi.fn() }))

const mutateAsync = vi.fn()
vi.mocked(useDeleteTodoMutation).mockReturnValue(idleMutation({ mutateAsync }))
vi.mocked(useDeleteTodoMutation).mockReturnValue(errorMutation(new Error('Could not delete.'), todoFixture.id, { mutateAsync }))
vi.mocked(useTodosQuery).mockReturnValue(successQuery([todoFixture], { refetch }))
```

If a state you need has no factory, add one to `queryResults.ts` in the same shape. Older tests cast partial results with `as unknown as ReturnType<...>`; leave those as they are and don't copy the pattern. Hooks that return plain objects (`useTodoFilters`, `useNotice`) need no factory: `vi.mocked(useNotice).mockReturnValue({ message: '', notify: vi.fn() })`.

## Hooks on TanStack Query (`useUpdateTodoMutation.test.tsx`)

A fresh client per test, retries off, the API module mocked:

```tsx
vi.mock('../api/todos', () => ({ todosApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() } }))

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
}

function createWrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

afterEach(() => {
  vi.resetAllMocks()
})
```

Seed the cache with `client.setQueryData(todoKeys.list, todos)`, run the mutation inside `await act(async () => { await result.current.mutateAsync(...) })`, then assert on `client.getQueryData(todoKeys.list)` and the API call. Cover the empty cache too: each `setQueryData` updater must handle `undefined`.

For query hooks, wait for the result with `await waitFor(() => expect(result.current.isSuccess).toBe(true))`, then assert `data` and the API call, including `{ signal: expect.any(AbortSignal) }`. Never use the app's `queryClient` singleton in a test.

## Hooks with timers (`useNotice.test.ts`)

```ts
beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})
```

Wrap state changes and timer advances in `act(...)`. Check one millisecond before the deadline and at it.

## Utilities that read the clock (`utils/todos.test.ts`)

`vi.useFakeTimers()` and `vi.setSystemTime(new Date(2026, 9, 15, 12, 0, 0))` inside the case, `vi.useRealTimers()` in `afterEach`. Use local-time constructors when the code compares local dates.

## API module (`api/todos.test.ts`)

```ts
vi.mock('../../../lib/http', () => ({ request: vi.fn() }))
beforeEach(() => vi.clearAllMocks())
```

Assert the full `request` call (path, method, serialised body) and the resolved value.

## HTTP client (`lib/http.test.ts`)

Stub `fetch` in `beforeEach` with `vi.stubGlobal('fetch', fetchMock)` and undo it with `vi.unstubAllGlobals()` in `afterEach`. Build responses the way the file does, with its `jsonResponse(body, status)` helper. Real `Response` objects also work under jsdom; don't mix the two in one file.

## Pages (`TodosPage.test.tsx`)

Mock every hook and child component the page composes. Child mocks render the props the page passes as plain text or buttons, so a case can assert the wiring and trigger callbacks. Control each mocked hook per case with `vi.mocked(hook).mockReturnValue(...)`.
