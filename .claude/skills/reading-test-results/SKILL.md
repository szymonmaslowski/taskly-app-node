---
name: reading-test-results
description: How to read Vitest failures and TypeScript errors in this repository and trace them to their cause. Use when fixing failing or non-compiling tests.
---

# Reading test results

Failures come in three forms. Handle them in this order, because each one hides the next.

## 1. Typecheck errors

Lines like `tests/router.test.ts(12,7): error TS2345: Argument of type ... is not assignable to ...` give the file, line and column. Vitest doesn't typecheck, so a test can pass and still not compile. Common causes:

- a fixture or mock with the wrong shape: compare with the type in `types.ts` or the Prisma schema;
- a missing or wrong import path: backend imports end in `.ts`, frontend imports have no extension;
- a mock returning a value the real function's type doesn't allow.

## 2. Files that fail to load

A test file can fail before any case runs, reported as a file error with a message such as `Cannot find module`, `ReferenceError` or a syntax error. Usually an import path, a `vi.mock` path that doesn't match the import, or code at module level that throws. `vi.mock` calls are hoisted to the top of the file, so a mock factory can't use variables declared in the file.

## 3. Failing cases

Each failing case comes with its name and failure messages:

- `expected 422 to be 200` / `AssertionError: expected [...] to deeply equal [...]`: the diff shows expected versus received. Decide which side is right by reading the source, not by copying the received value.
- `Unable to find an element with the role "button" and name "Save"`: the element isn't rendered or has another name. The error prints the rendered DOM; read it.
- `TestingLibraryElementError` after an action: the update may be asynchronous; use `findBy...` or `waitFor`.
- `Error: [vitest] No "x" export is defined on the mock`: the mock factory misses an export the code uses.
- Timeouts: an awaited promise never settles, often a mock that was never given a resolved value.

## Deciding what to change

The source is the reference. When a case fails because the test expected something the code doesn't do, check the source: if the code's behaviour is clearly intended, correct the test; if the code looks wrong, keep the test and explain it in your notes. Never change a test only to match received output you haven't understood.
