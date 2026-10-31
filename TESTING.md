# Testing in taskly

How this team wants unit tests written. People read it, and the test agent gets it in every stage. Where it disagrees with a skill, this file wins.

## What a test is for

A test protects behaviour that a user of the app or a client of the API relies on. If no realistic change to the code would make a test fail, don't write it. Fewer tests that each catch something beat many that repeat each other.

## Where the expected values come from

- The API's behaviour is defined by `backend/openapi.json`. Route tests assert what it says, including status codes and error bodies.
- A pull request may change behaviour on purpose. When its description says so, tests follow the new behaviour, and the old expectation is updated rather than defended.
- Without such a statement, a test that disagrees with the code stays as it is, and the disagreement is reported.

## What we don't test

- Styling, design system internals and stories.
- Third-party libraries: React Query's caching, Zod's parsing, Express's routing. Test our use of them.
- Entry points that only wire things together (`backend/src/main.ts`, `frontend/src/main.tsx`).

## How tests are written

- No casts to make a mock fit a type. Use the typed factories in `frontend/src/test/queryResults.ts` and the fixtures next to the tests.
- No real network, database or clock. Prisma calls are stubbed with `vi.spyOn`; time comes from `vi.setSystemTime`.
- A test changed to pass after a source change states why in the pull request; removing an assertion needs a reason.
