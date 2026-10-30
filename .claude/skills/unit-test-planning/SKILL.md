---
name: unit-test-planning
description: How to decide which unit test cases are worth writing for TypeScript code and describe each one so a reviewer can check it and someone else can implement it. Use when planning tests for new or changed code, filling coverage gaps, or deciding whether a change needs new tests at all.
---

# Planning unit tests

A plan is a list of cases. Each case names one observable behaviour of the code, the bug it would catch and why it is worth keeping. The plan is reviewed before anyone writes a test, so it must be checkable against the source without guessing.

Use with `unit-test-principles` (the rule IDs cited below) and the workspace skill's `planning.md` (`backend-unit-tests` or `frontend-unit-tests`), which says what matters in each kind of module and where test files go.

## Steps

1. **Read before planning.** Read the source file, every test file that already covers it and the shared fixtures. Read the contract the code implements when there is one, such as an API specification or a schema.
2. **List the decision points.** Walk the public interface: exports, routes, rendered output, a hook's return value. For each, note every branch the source takes (C4): conditions, early returns, `catch` blocks, validation rules, defaults. Private helpers are reached through the code that uses them. This list is your completeness check; it doesn't go into the plan.
3. **Find candidate cases.** Apply the case checklist (C1 to C10) to each decision point. Each candidate is one outcome: the normal result, an error path, a boundary, a promise the contract makes.
4. **Remove what is already covered.** For every candidate, find the closest existing test. If it already asserts the same behaviour, drop the candidate. If it's close but misses a branch, keep the candidate and name the existing test in `overlap`.
5. **Name the bug.** For every remaining candidate, write the realistic defect that makes its test fail (P3). If you can't name one, drop the candidate.
6. **Decide on updates.** When the code changed a behaviour on purpose and an existing test now fails or asserts the old behaviour, plan an update of that test instead of a new case. Say what changed in `reason`.
7. **Stop.** A file whose behaviours are all tested needs no cases. "No new cases" is a valid answer, and a common one. Not every branch needs a new case: an existing test may cover it, or it may not be worth maintaining.

Coverage data helps you find code no test runs. Use it as a hint for step 2. Don't make it the goal: a case that runs a line without checking what it does adds nothing.

## Which behaviour to describe

Describe what the code should do according to its contract, and where there is no contract, what its source evidently intends (see the oracle in `unit-test-principles`). When the code disagrees with its contract, plan the case as the contract says and start `reason` with `Contract mismatch:` and what each side says. The test will fail, and that failure is the finding.

## Describing a case

| Field | What it holds |
|---|---|
| `name` | The test title: the behaviour, in the words the workspace's tests use (P9). |
| `behaviour` | One sentence: given what, when what, then what. Concrete enough that a reviewer can check it against the code. |
| `catches` | The realistic defect that makes this test fail: a flipped condition, a missing field, a wrong boundary, a dropped call. |
| `reason` | Why it matters: the branch, error path, boundary or contract clause it protects. |
| `overlap` | The closest existing test by file and name, or `none`. |

Good:

> **name** `returns 404 when updating a missing task`
> **behaviour** When the repository's `update` returns `null` for id 999, `PATCH /api/todos/999` responds 404 with `{ detail: 'Task not found.' }`.
> **catches** The route treats a `null` result as success and responds 200 with an empty body.
> **reason** Not-found branch of the update route; the contract specifies the body.
> **overlap** `router.test.ts` › `returns 404 when a task is missing on get` (another route)

Bad:

> **name** `update works`
> **behaviour** Tests the update function.

The bad one names no input, no outcome, no branch and no bug. Nobody can check it, and two people would write two different tests.

## One case or a table

Use one case per rule. When the same rule applies to many inputs (every invalid id format, every required variable), plan one table case and list the inputs in `behaviour`. When inputs exercise different rules, plan separate cases so a failure names the rule that broke.

## Don't plan

- Behaviour an existing test or another planned case already covers.
- Cases whose only assertion is a value a mock was told to return (AP1), or that a mock was called when the call isn't the behaviour.
- Cases tied to details a refactor would break without changing behaviour (AP2): private state, internal calls nobody outside observes, CSS classes. Call order a caller depends on is behaviour (C8) and may be planned.
- Tests for types, re-exports, constants, generated code or entry points that only wire things together.
- Changes to source files. Plans only touch test files and test fixtures.
