# Backend: what to look for in a review

Use with the `unit-test-reviewing` skill. These are the problems that show up in backend tests in particular, with the rule each one breaks.

| Problem | Rule | Example | Instead |
|---|---|---|---|
| Asserts the repository call where the response is the behaviour | P2 | A route test that checks `repository.get` was called with `1` but not the status or body. | Assert status and full body; keep the call check only when the route transforms input. |
| Status only | AP4 | `expect(response.status).toBe(422)` for a case that is about the error body. | Assert the body the contract defines too. |
| Expectation contradicts `openapi.json` | the oracle | Expects 400 where the contract says 422, or a different `detail` text. | Follow the contract; if the code disagrees with it, report that instead of encoding the code's answer. |
| Missing early-rejection check | AP5 | A 404 or 422 case that doesn't assert the repository wasn't called. | Add `not.toHaveBeenCalled()` on the method the route would have used. |
| Reads a real `.env` | AP6 | A configuration test that leaves a variable unstubbed, so the result depends on the developer's machine. | Stub every variable `config.ts` reads, `''` for the ones the case doesn't set. |
| Needs a database or port | P6 | Calls `start()` without mocking `createApp` and `createDatabase`, or connects Prisma. | Spy on the delegate methods; fake the server. |
| Spies not restored | P7 | A file with `vi.spyOn` but no `vi.restoreAllMocks()` in `afterEach`. | Add it; spies leak into later cases in the same file. |
| Unsilenced error log |  | A 500 case that lets the error handler print a stack trace. | `vi.spyOn(console, 'error').mockImplementation(() => {})`, then assert it when the log is the behaviour. |
| Fixture redefined |  | A new literal task object instead of `record` or `todo`. | Spread the fixture with the fields the case changes. |
| Wrong import form |  | Source imported without `.ts`, or from `dist/`. | `../src/...ts`. |
| Leaked error details | C7 | A 500 case that doesn't check the body hides internal messages. | `expect(JSON.stringify(response.body)).not.toContain(...)` with the thrown message. |
