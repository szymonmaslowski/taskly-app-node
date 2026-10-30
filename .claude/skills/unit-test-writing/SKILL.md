---
name: unit-test-writing
description: How to implement unit test cases in TypeScript with Vitest so they check real behaviour, stay deterministic and fail for the right reason. Use when writing new tests, updating existing ones after a behaviour change, or fixing tests that fail or don't compile.
---

# Writing unit tests

A test is worth keeping when a plausible bug in the code makes it fail and a refactor that keeps the behaviour doesn't. Everything below serves that.

Use with `unit-test-principles` (the rule IDs cited below) and the workspace skill's `writing.md` (`backend-unit-tests` or `frontend-unit-tests`), which has the file layout, fixtures and ready patterns. Match the existing tests next to the one you write.

## Before writing

Read the source under test, the existing tests for it and the shared fixtures. Take expected values from the contract and the source's intent, never from received output (the oracle). When a planned case names the bug it `catches`, write the assertion that bug would break.

## Shape of a case

- **One behaviour per case** (P8). The name says the behaviour; the assertions check exactly that behaviour.
- **Arrange, act, assert.** Build inputs, run the code once, assert. If the file separates the three with blank lines, do the same.
- **A `setup()` helper** when several cases need the same objects. It returns what the case needs; each case calls it. Don't share mutable objects between cases at module level (P7).
- **`it.each` for tables** of inputs that check one rule. Put the input in the title with `%s` or `%j` so a failure names it.
- **No control flow in the body** (AP9): no `if`, loops or `try`/`catch`. A table replaces the loop; `expect(...).rejects` replaces the `try`.
- **Reuse fixtures** and spread overrides: `{ ...fixture, completed: true }`. Don't redefine records a fixture already provides.

## Assertions

- Assert results and visible effects (P2): the return value, the response, the rendered text, the thrown error, the call a collaborator receives when that call is the behaviour.
- Use the exact matcher (P10): `toEqual` or `toBe` on the whole value. `toBeDefined`, `toBeTruthy` and `expect.anything()` hide wrong values (AP4). `expect.any(Date)` only for values the unit generates itself.
- For errors, assert the type or message: `await expect(run()).rejects.toThrow('Missing environment variable: DB_PORT')`.
- When code must reject input early, also assert the collaborator wasn't called (AP5): `expect(repository.create).not.toHaveBeenCalled()`.
- When the order of calls is the behaviour, assert it (C8): `expect(reset.mock.invocationCallOrder[0]).toBeLessThan(refetch.mock.invocationCallOrder[0])`.
- When the unit must not change its input, prove it (C9): `const before = structuredClone(input)`, then `expect(input).toEqual(before)`.
- Don't assert a value you just configured a mock to return, unless the code transformed it on the way (AP1).

## Mocks

- Mock at the boundary (P4): network, database, clock, environment, child modules the unit composes. Never the module under test or the function the case is about (P5).
- Type mocks through the real signature: `vi.fn<TodoStore['get']>()`, `vi.mocked(api.update).mockResolvedValue(saved)`. Build complex return values with the workspace's typed helpers. Casts follow the casts policy in `unit-test-principles`.
- `vi.mock` calls are hoisted above imports. A mock factory can't use variables declared in the test file; use `vi.hoisted` or import inside the factory.
- Undo what you change: `vi.restoreAllMocks()`, `vi.unstubAllEnvs()`, `vi.unstubAllGlobals()`, `vi.useRealTimers()` in `afterEach`.

## Determinism

- No real network, database, file writes or sleeps (P6).
- Time: `vi.useFakeTimers()` and `vi.setSystemTime(...)` for anything that reads the clock or waits. Advance timers explicitly and check both sides of a deadline, such as 9999 ms and 10000 ms.
- Asynchronous UI or state: wait for the result (`findBy...`, `waitFor`, `await act(...)`), never for a fixed delay.
- Fixed data only: no `Math.random()`, no `new Date()` in expected values.

## Never weaken a test

These make a test pass without checking anything. Don't use them, and don't use them to get a failing test green:

- `skip`, `only`, `todo`, `fails`, `skipIf`, `runIf` on a case or a `describe` (AP10);
- removing an assertion, or loosening one (`toEqual` → `toMatchObject` → `toBeDefined`);
- catching the error a test is supposed to surface;
- mocking the unit under test;
- copying the received value into the expectation without understanding why it differs.

If an expectation turns out to be wrong because the code's behaviour is clearly intended, correct it and keep it as strict as before. If the code looks wrong, leave the test failing and say why.

## Updating an existing test

Change only the cases whose behaviour changed. Keep their assertions as strong as before: if the old test checked the whole body, the new one does too. Leave every other case in the file as it is, including its formatting and existing casts.

## Done when

- every planned case is in the planned file, with a name that states its behaviour;
- each case would fail if the bug it catches were introduced;
- no case depends on another case, the clock or the network;
- the file follows the workspace's style and its imports compile.

If you can run commands, run the test file and the typecheck from the workspace skill's **Commands** section before finishing. In the test agent's pipeline the orchestrator runs them for you.
