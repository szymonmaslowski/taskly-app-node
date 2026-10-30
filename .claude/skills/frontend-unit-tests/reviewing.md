# Frontend: what to look for in a review

Use with the `unit-test-reviewing` skill. These are the problems that show up in frontend tests in particular, with the rule each one breaks.

| Problem | Rule | Example | Instead |
|---|---|---|---|
| Queries by implementation | AP11 | `container.querySelector('.todo-item')`, `getByTestId` for an element that has a role or label. | `getByRole` with a name, `getByLabelText`, then `getByText`. |
| `fireEvent` for user actions |  | `fireEvent.click(button)` skips focus, pointer and keyboard events a user produces. | `const user = userEvent.setup()` and `await user.click(...)`. |
| Shared `QueryClient` | P7 | One client at module level, or the app's `queryClient`, used across cases: cache and retries leak. | A new client per case with `retry: false`. |
| Real design system | AP2 | A component test without the design-system mock, so it depends on styled-components output. | `vi.mock('<path>/design-system', () => import('<path>/design-system/mocks'))`. |
| Mocks `fetch` above the API layer | AP3 | A hook or component test that stubs `fetch`. | Mock `api/todos`; only `lib/http.test.ts` stubs `fetch`. |
| Missing `await` | AP7 | `user.click(...)` or `mutateAsync(...)` not awaited; the assertion runs before the update. | `await` the action, `findBy...` or `waitFor` for the result. |
| Asserting absence with `getBy` | AP11 | `expect(screen.getByText('x')).not.toBeInTheDocument()` throws before the assertion. | `queryBy...` for absence. |
| `act` warnings ignored | AP7 | State changes outside `act` in hook tests; timer advances not wrapped. | Wrap in `act(...)`; with fake timers, `act(() => { vi.advanceTimersByTime(...) })`. |
| Timers not restored | P7 | `vi.useFakeTimers()` without `vi.useRealTimers()` in `afterEach`. | Restore; user-event and `waitFor` hang on fake timers left behind. |
| Snapshot of a component | AP8 | `expect(container).toMatchSnapshot()`. | Assert the text, roles and states the case is about. |
| Callback checked without arguments | AP4 | `expect(onChange).toHaveBeenCalled()` where the argument is the behaviour. | `toHaveBeenCalledWith(...)` with the value. |
| Data passed through `globalThis` | P7 | A child mock reading test data from a global. | Pass it through the mocked hook's return value or the props the page sets. |
| Fixture redefined |  | A full literal task instead of `todoFixture`. | Spread `todoFixture` with the fields the case changes. |
| Formatting |  | Semicolons, double quotes, missing trailing commas. | Prettier config: no semicolons, single quotes, trailing commas. |
