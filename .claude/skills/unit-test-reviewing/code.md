# Reviewing test code

Review new and changed tests. Untouched existing tests are out of scope unless they break the changed ones, and existing casts are never findings.

## Problems and their severity

Check each case against these, most serious first. Each finding cites the rule ID from `unit-test-principles`.

| Severity | Problem | IDs |
|---|---|---|
| blocker | Disabled or focused test | AP10 |
| blocker | Proves nothing: no assertion, a tautology, `expect` inside `try` or `catch` | AP1, AP9 |
| blocker | Mocks the unit under test | P5 |
| blocker | Expected value contradicts the contract, or looks copied from received output | the oracle |
| major | Nondeterministic, or leaks mocks, globals, environment variables or timers into other cases | AP6, P7 |
| major | Missing check that a rejected or cancelled path didn't call the collaborator | AP5 |
| major | Coupled to implementation, or over-mocked | AP2, AP3 |
| major | Async misuse | AP7 |
| minor | Weak assertion where the exact value is known | AP4, P10 |
| minor | Wrong query priority | AP11 |
| minor | New cast or loose type where a typed helper fits | AP12 |
| minor | Name says one behaviour, assertions check another | P9 |
| minor | Doesn't follow the file's or workspace's style | |

The verdict follows from the table: **fail** when there is any blocker or major finding, **pass** otherwise. Style alone never fails a review.

## Writing a finding

Each finding has:

- **where**: test file and line, or case name;
- **rule**: the ID, or "the oracle";
- **evidence**: the source or test line that shows it, and the bug that slips through;
- **fix**: what to change, in one sentence.

> `todos.test.ts:41` · AP1 · asserts only that `todosApi.create` resolves to the value the `request` mock returns, so a wrong path or body still passes · assert `request` was called with `'/todos'`, `method: 'POST'` and the serialised input.

Report only findings you can point to a line for. Don't rewrite the tests in a review.
