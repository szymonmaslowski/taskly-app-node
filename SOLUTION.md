# Solution: a unit test agent for taskly

`testeragent` writes and updates unit tests for the backend and the frontend. It runs on every pull request, checks its own tests in a sandbox and posts the results on a stacked pull request. The same agent filled the gaps in the existing code: [#8](https://github.com/szymonmaslowski/taskly-app-node/pull/8) took backend coverage from 30% to 97% of statements and the frontend from 47% to 99%.

## Assumptions

- The agent runs on Claude models through Claude Code, and the design relies on that: each model step is a Claude Code session, and the prompts and skills were tuned on Sonnet and Opus.
- Unit tests only. Prisma calls are stubbed the way the existing tests do it, so no database is needed.
- Verification runs `tsc` as well as the tests, since Vitest doesn't typecheck.
- `backend/openapi.json` is the contract for routes. Where the code disagrees, the planner marks a contract mismatch instead of copying the code's behaviour.
- Anyone with write access is trusted. For same-repository PRs, GitHub runs the workflow file from the PR, so a collaborator could read the secret by editing it. The controls protect against untrusted content inside trusted PRs (copied code, text written to steer the agent) and against stray local config. They keep the agent behaving as defined on `main`.
- Docker is available: GitHub-hosted Ubuntu runners have it, and locally Docker Desktop.

## How it works

```
pull request ──► guard ──────► start ─────► generate ────────► verify ───────────► publish
                 same repo,    check run    agent pipeline,    re-applies the      stacked PR, sticky
                 open, not     "in          token in env,      patch on a clean    comment, check run
                 a draft       progress"    no write access    head, no secrets    result
```

Inside `generate`, a TypeScript orchestrator (`agent/src/orchestrator.ts`) runs one pipeline per changed workspace:

1. **Analyse** (code, no model). Read the diff, install the head in the runner container, run typecheck, tests and coverage. Pick the changed source files, their related tests, uncovered lines and the existing tests the PR already breaks.
2. **Plan.** `test-planner` proposes cases, each with the realistic bug it `catches`. The PR description goes in as declared intent.
3. **Review the plan.** `plan-reviewer` decides on each proposed case with a reason and lists missing behaviours. Missing behaviours start one more planning round (up to 2 rounds).
4. **Write.** `test-writer` writes the cases.
5. **Fix.** The orchestrator runs typecheck and tests (the touched test files) and hands the failures to `test-fixer`. **There are 3 attempts: two on Sonnet, the last on Opus.**
6. **Clean up.** Cases that still fail are removed through the TypeScript AST if the agent added them, or reverted to their original text if it changed them. A developer's test never disappears.
7. **Format and verify.** Prettier runs on the changed frontend files, then the whole workspace runs again: typecheck, tests, coverage and the repository's own thresholds.
8. **Report.** Numbers come from code, not from the model.

[`testeragent.config.mts`](testeragent.config.mts) adapts this to the repository. It holds the workspaces with their file globs, skill and commands (install, typecheck, test, format), and the model, effort, turns, time and budget for each stage, plus the round and attempt counts. [`agent/src/stages.ts`](agent/src/stages.ts) sets hard caps that the config can't go above.

## Main decisions

- **The orchestrator decides; models do the creative work.**
  - What: a TypeScript program runs the pipeline. It picks the scope, runs every test, counts rounds and attempts, and decides pass or fail. Models only plan, review, write and fix.
  - Why: those decisions must not depend on what a model chooses. Tests always run, the agent can't declare its own success, and cost stays bounded.
- **Each step that uses a model is one Claude Code session.**
  - What: plan, plan review, write and fix (the code calls these stages) each run `claude -p` with the agent's system prompt, a tool list, a JSON schema for the answer and caps on turns, time and budget. Analysis, test runs, clean-up, formatting and the report are plain code.
  - Why: Claude Code brings file tools and the standard skill format. Answers come back in a shape code can validate, and a stuck stage can't run up a bill.
- **Generic stage agents, stack knowledge in skills.**
  - What: four agents (planner, plan reviewer, writer, fixer) serve both workspaces. The `backend-unit-tests` and `frontend-unit-tests` skills hold the stack conventions, and the config maps each workspace to its skill.
  - Why: one pipeline to maintain. Adding a workspace means a new skill and a config entry, not a new agent.
- **Code injects the skills into each prompt.**
  - What: `agent/src/stages.ts` names the agent and skills for each stage, and the orchestrator reads them from the base branch (`main`) and puts them into the prompt.
  - Why: every stage always gets the right skills instead of relying on the model to load them, and a PR can't add or change a skill to steer the agent. The skills use the standard `SKILL.md` format, so the same files work in an interactive Claude Code session.
- **The model can read and edit files but can't run anything.**
  - What: agent containers have no Bash and no web tools. PR code (tests, `prisma generate`) runs only in a separate runner container with no secrets and no network.
  - Why: the PR's code and text are untrusted. Even if a PR talks the model into something, it has no tool to act with, and PR code never runs next to the token.
- **Everything that defines the agent comes from the base branch.**
  - What: agent code, agent definitions, skills and config are read from `main`. The agent sees only an allowlisted copy of the PR's files, and only regular files cross between host and containers.
  - Why: the agent should behave as defined on `main`, not as a branch says. A `.claude/`, `CLAUDE.md` or `.mcp.json` added in a PR never reaches it, and a symlink can't expose the host's environment.
- **Outdated tests get updated, and the report lists those changes first.**
  - What: when a change makes an existing test outdated, the agent updates it, but only in tests related to the changed source. The report opens with "Your PR breaks N existing test files" and flags changed tests with fewer assertions. The run fails only on failures the agent caused.
  - Why: the PR is the source of truth, and stale tests would block it. A test edited until it passes is the main risk, so a human has to see it first. The developer's own failures are reported, not hidden.
- **Coverage guides planning but isn't a target.**
  - What: uncovered lines go to the planner, and the report shows coverage per file before and after. Every planned case names the bug it catches, and the reviewer drops cases with none.
  - Why: chasing a percentage produces tests that catch nothing. "No new cases" is a valid result.
- **Results go to a stacked PR.**
  - What: the tests land in `<branch>--agent-tests`, a PR against the source branch. Each run rebuilds it from the source head.
  - Why: nothing lands in the developer's branch without review, and closing the PR is how they turn the tests down. A stale update disappears once the source changes.
- **`publish` treats everything from earlier jobs as untrusted.**
  - What: git checks the patch again on a clean checkout, a scan checks the patch and report for the Claude and GitHub credentials, and PR values reach workflow scripts only through `env`.
  - Why: `generate` and `verify` ran PR code, so their output could have been tampered with.

## Running

### On pull requests

Repo prerequisites:

1. Claude token stored as secret in an environment named `claude`.
2. GitHub Actions allowed to create and approve pull requests. (repo settings).

Each PR gets:
- **A `testeragent` check run.** It's neutral with "Review agent tests in #N" when there are tests to review, success with "No tests needed", and failure when the agent couldn't produce passing tests.
- **A sticky comment** with the report.
- **The stacked PR** with the tests and the same report.

### Locally

Requirements are Docker, Node.js 22.18 or newer, and a token in `~/.testeragent.env` (`CLAUDE_CODE_OAUTH_TOKEN=...`).

```sh
npm --prefix agent run agent -- --workspace frontend --module frontend/src/features/todos/hooks
```

The run leaves its changes in the working tree and writes `report.md` and `report.json` to `.testeragent/runs/<time>/`.

## Agent prompts, skills and locations

- **Stage agents** in [`.claude/agents/`](.claude/agents): each file holds one stage's system prompt and tool list.
  - [`test-planner.md`](.claude/agents/test-planner.md) plans cases, with `Read`, `Grep` and `Glob`.
  - [`plan-reviewer.md`](.claude/agents/plan-reviewer.md) keeps or drops each planned case, with the same read-only tools.
  - [`test-writer.md`](.claude/agents/test-writer.md) writes the kept cases, with `Edit` and `Write` as well.
  - [`test-fixer.md`](.claude/agents/test-fixer.md) fixes failing tests, with the same tools as the writer.
- **Method skills** in [`.claude/skills/`](.claude/skills): how to test, whatever the stack.
  - [`unit-test-principles`](.claude/skills/unit-test-principles/SKILL.md): rules P1–P10, anti-patterns and the oracle rule. Every stage gets it.
  - [`unit-test-planning`](.claude/skills/unit-test-planning/SKILL.md): the planner.
  - [`unit-test-reviewing`](.claude/skills/unit-test-reviewing/SKILL.md): the plan reviewer.
  - [`unit-test-writing`](.claude/skills/unit-test-writing/SKILL.md): the writer and the fixer.
  - [`reading-test-results`](.claude/skills/reading-test-results/SKILL.md): the fixer.
- **Workspace skills**: the conventions of one stack. Each stage also gets the workspace skill plus the one file it needs: the planner and reviewer get `planning.md`, the writer and fixer get `writing.md`. `reviewing.md` is for review in an interactive session.
  - [`backend-unit-tests`](.claude/skills/backend-unit-tests/SKILL.md): [`planning.md`](.claude/skills/backend-unit-tests/planning.md), [`writing.md`](.claude/skills/backend-unit-tests/writing.md), [`reviewing.md`](.claude/skills/backend-unit-tests/reviewing.md).
  - [`frontend-unit-tests`](.claude/skills/frontend-unit-tests/SKILL.md): [`planning.md`](.claude/skills/frontend-unit-tests/planning.md), [`writing.md`](.claude/skills/frontend-unit-tests/writing.md), [`reviewing.md`](.claude/skills/frontend-unit-tests/reviewing.md).
- **Stage wiring and hard caps** in [`agent/src/stages.ts`](agent/src/stages.ts): which agent and skills each stage gets. This is code, not configuration.
- **Repository config** in [`testeragent.config.mts`](testeragent.config.mts): workspaces, file globs, commands, and model, effort and budget per stage, capped by `stages.ts`.
- **Orchestrator, sandbox and report** in [`agent/src/`](agent/src).
- **Workflow** in [`.github/workflows/testeragent.yml`](.github/workflows/testeragent.yml), with [`.github/scripts/testeragent-publish.sh`](.github/scripts/testeragent-publish.sh) for the publish job.

## Example run

[#15](https://github.com/szymonmaslowski/taskly-app-node/pull/15) adds a "Due" filter (`GET /api/todos?due_before=` in the backend, a select and `matchesDue` in the frontend) and shortens the title limit from 120 to 100 characters. It adds no tests. Its description says the shorter limit is intended.

The agent opened [#16](https://github.com/szymonmaslowski/taskly-app-node/pull/16).

Merging #16 into #15 makes #15 green. The next run then finds nothing to add and ends with "No tests needed", as the trial on [#12](https://github.com/szymonmaslowski/taskly-app-node/pull/12) and [#13](https://github.com/szymonmaslowski/taskly-app-node/pull/13) showed.

## Limitations

- **Stacked PRs get no CI by default.** GitHub doesn't run workflows for PRs created with the Actions token. A maintainer has to approve them, or the repository needs a GitHub App identity.
- **The agent runs from the PR's base commit.** A PR opened before an agent change keeps the old agent until it's updated with its base branch.
- **The writer and fixer don't see the PR description.** Only the planner and reviewer get it. When a fixer meets an intended behaviour change without that context, it may keep the old expectation as a "source bug". The case then stays failing in the report, and nothing is hidden.
- **Report gaps.**
  - A renamed test case shows as one deleted case with "fewer assertions" plus one new case.
  - Tests of a deleted source file are listed but not removed.
- **Every run is a full run.** There's no cheap path for a push that only touches tests, and nothing reacts to a closed stacked PR.
- **The secret scan is not a guarantee.** A deliberate custom encoding gets past it. The real controls are the file allowlist, no symlinks and no Bash.
- **The token is personal.** A subscription token is rate-limited in 5-hour windows. Hitting the limit fails the check.
- **No egress filter on the agent container.** The model has no tool that reaches the network, but the container itself isn't limited to the Anthropic API.
- **Switching model provider takes work.** Another Claude model is a config change. Another provider means replacing the stage runner ([`agent/src/run-stage.ts`](agent/src/run-stage.ts)), the agent image and the egress allowlist, then checking result quality again. The orchestrator, sandbox, checks, report, skills and agent prompts stay as they are.
- **One agent session at a time.** Fixers edit the same copy of the files, so `agentParallelism` is 1.

## For production

- **Identity.** A GitHub App, so stacked PRs trigger CI and the bot has its own name. An API key with a spend cap instead of a personal token.
- **Isolation.** The agent container behind an egress proxy that allows only the Anthropic API. The token only in a workflow that runs from the base branch (`workflow_run`), so a PR can't change the workflow that holds it.
- **Speed.** Images built on push to `main`, pushed to GHCR and pinned by digest. A cheap path that re-verifies without the model when only tests changed. Relevant files inlined into prompts to save the model's read turns.
- **Better tests.**
  - A "fails on base" check: a new test that passes on the base version doesn't test the change.
  - Mutation testing on changed files.
  - A code review stage after writing, using `unit-test-reviewing/code.md`.
- **Better input.**
  - The PR description passed to every stage.
  - An optional `TESTING.md` for the repository's own testing rules.
  - `!testeragent` comment directives to ask for or skip cases.
- **Reach.** Integration tests against a Postgres service container. Support for fork PRs through a maintainer-approved flow. Check run annotations on the lines the report mentions.

## Alternatives considered

- **LangGraph.** Full control over the graph, but I'd have to build file editing, tool permissions and the sandbox myself.
- **GitHub Agentic Workflows.** The strongest security model of the options, but still in early development.
- **Copilot custom agents.** Native to GitHub, but less control over how the run is staged and checked.
- **A plain Claude Agent SDK script.** Close to what I built. Claude Code runs on the SDK, so moving the orchestrator onto it later is a small step.
