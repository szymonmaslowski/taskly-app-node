---
name: unit-test-principles
description: Shared rules for unit tests in TypeScript with Vitest, with IDs that plans, reviews and fixes cite (P for principles, C for the case checklist, AP for anti-patterns), plus the oracle rule and the casts policy. Use together with unit-test-planning, unit-test-reviewing or unit-test-writing.
---

# Unit test principles

Every rule has an ID. Cite it when you drop a case, report a problem or explain a fix: `drop (AP1): asserts the value the mock was told to return`.

## The oracle

Expected values come from, in this order: the contract the code implements (an API specification, a schema, a type, documented behaviour), then the evident intent of the source. Never from running the code and copying what it returns: a test that records today's output also records today's bugs.

When the code disagrees with its contract, the test follows the contract and the disagreement is said out loud: in a plan's `reason`, in a fixer's notes. A test that fails because the code is wrong is a finding, not something to fix by changing the expectation.

## P. What a good unit test is

- **P1. Public interface.** Call the exported function, render the exported component, call the route over HTTP. Never reach into private fields, internal state or styles.
- **P2. Observable outcomes.** Return values, thrown errors, responses, rendered accessible output, callbacks fired with their arguments, calls to a direct collaborator when that call is the behaviour, and calls that must not happen.
- **P3. Catches a named defect.** You can say which realistic bug in the source makes the test fail. If you can't, the test proves nothing.
- **P4. Mock only direct collaborators at the module boundary:** the database client, the HTTP layer, `fetch`, the hooks a container component consumes, the design system, the clock and the environment. Keep pure logic real.
- **P5. Never mock the unit under test**, or anything defined in the same module.
- **P6. Deterministic.** No real network, database, wall-clock time, randomness or fixed sleeps.
- **P7. Isolated.** Each test builds its own state through a `setup()` helper or inline arrangement, passes alone and in any order, and restores every mock, stubbed global, environment variable and fake timer it changes.
- **P8. One behaviour per test.** Several assertions are fine when they describe the same behaviour.
- **P9. The name states the behaviour**, in the words the surrounding tests use, without "should" or "test".
- **P10. Exact matchers.** `toEqual` or `toBe` on the whole value, `toHaveBeenCalledWith` with every argument, `toHaveBeenCalledTimes(n)` when the count matters.

## C. Case checklist

Apply each line to every behaviour of the public interface. It finds candidates; the existing tests and the plan reviewer decide which ones are worth writing.

- **C1. Normal result** for the most typical input.
- **C2. Boundaries:** the exact minimum and maximum accepted, and one step outside each.
- **C3. Invalid input:** wrong type or format, unknown or extra fields, `null` against absent, empty and whitespace-only strings.
- **C4. Branches:** each `if`, ternary, `??`, `||`, `&&`, `?.`, early return and `catch` has an outcome per side.
- **C5. Not found and empty:** a missing record, an empty list, nothing changed.
- **C6. Errors from collaborators:** the unit surfaces, maps or swallows them as designed.
- **C7. Things that must not happen:** rejected input never reaches the collaborator; a cancel never submits.
- **C8. Ordering and timing:** sort order, call order when the order is the behaviour (reset before refetch: `mock.invocationCallOrder`), both sides of a deadline with fake timers.
- **C9. Immutability:** inputs the unit must not change stay equal to a `structuredClone` taken before.
- **C10. UI states:** loading, error, empty, busy or disabled, and populated, with the accessible names and roles the user sees.

## AP. Anti-patterns

- **AP1. Tautology:** asserts a value a mock was told to return without it passing through the unit's logic.
- **AP2. Implementation coupling:** asserts private state, internal calls nobody outside observes, CSS, class names or render counts. Call order a caller depends on is behaviour (C8), not coupling.
- **AP3. Over-mocking:** mocks pure helpers, the unit itself, or collaborators two layers away.
- **AP4. Weak assertion:** `toBeTruthy`, `toBeDefined`, `toMatchObject` or bare `toHaveBeenCalled()` where the exact value or arguments are known.
- **AP5. Missing negative assertion:** a rejection or cancel path that doesn't prove the collaborator or callback wasn't called.
- **AP6. Non-determinism:** real timers or clock, sleeps, network or database access, dependence on case order.
- **AP7. Async misuse:** un-awaited `user.*` calls or promises, actions inside `waitFor`, state updates outside `act`.
- **AP8. Snapshots** of components or large objects.
- **AP9. Control flow in a test:** `if`, loops or `try`/`catch` in a test body. Use `it.each` and `expect(...).rejects`. An `expect` inside `catch` passes when nothing throws.
- **AP10. Disabled or focused:** `skip`, `only`, `todo`, `fails`, `skipIf`, `runIf`, or a commented-out test.
- **AP11. Wrong query (UI):** test ids or `querySelector` where a role, label or text works.
- **AP12. Loose types:** `any`, `@ts-ignore`, `@ts-expect-error`, or a cast where a typed helper exists.

## Casts policy

- Build values through typed helpers first: the shared fixtures, typed factories in the workspace's test helpers, `vi.fn<typeof fn>()` typed with the signature it replaces.
- When no helper fits and writing one costs more than the test, a cast is allowed on the smallest value, to the real type (`ReturnType<typeof useHook>`), never to `any` or `never`.
- To pass deliberately invalid input past the types, build it at runtime (`JSON.parse('{"id":2}')`) instead of casting.
- Existing casts in existing tests are not findings and are not refactored.
