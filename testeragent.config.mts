import { defineConfig } from './agent/src/config.ts';

export default defineConfig({
  workspaces: {
    backend: {
      root: 'backend',
      skill: 'backend-unit-tests',
      sources: ['src/**/*.ts'],
      ignoredSources: ['src/generated/**', 'src/**/types.ts', 'src/main.ts'],
      tests: ['tests/**/*.test.ts'],
      writable: ['tests/**'],
      shared: ['tests/fixture.ts'],
      context: ['package.json', 'tsconfig.json', 'vitest.config.ts', 'openapi.json', 'prisma/schema.prisma'],
      commands: {
        install: ['npm ci --ignore-scripts', 'node_modules/.bin/prisma generate'],
        typecheck: 'node_modules/.bin/tsc --noEmit',
        test: 'node_modules/.bin/vitest run',
      },
    },
    frontend: {
      root: 'frontend',
      skill: 'frontend-unit-tests',
      sources: ['src/**/*.{ts,tsx}'],
      ignoredSources: [
        'src/main.tsx',
        'src/test/**',
        'src/**/*.test.{ts,tsx}',
        'src/**/*.stories.tsx',
        'src/design-system/**',
        'src/**/types.ts',
        'src/**/*.types.ts',
        'src/**/index.ts',
        'src/**/constants.{ts,tsx}',
        'src/**/*.constants.ts',
        'src/features/todos/api/queryKeys.ts',
        'src/lib/queryClient.ts',
      ],
      tests: ['src/**/*.test.{ts,tsx}'],
      writable: ['src/**/*.test.{ts,tsx}', 'src/test/**'],
      shared: ['src/test/**'],
      context: ['package.json', 'tsconfig.json', 'vite.config.ts'],
      commands: {
        install: ['npm ci --ignore-scripts'],
        typecheck: 'node_modules/.bin/tsc --noEmit',
        test: 'node_modules/.bin/vitest run',
        format: 'node_modules/.bin/prettier --write',
      },
    },
  },
  stages: {
    plan: { model: 'claude-sonnet-5-5', effort: 'high', maxTurns: 15, timeoutMinutes: 10, maxBudgetUsd: 3 },
    planReview: { model: 'claude-opus-5-5', effort: 'high', maxTurns: 12, timeoutMinutes: 10, maxBudgetUsd: 3 },
    write: { model: 'claude-sonnet-5-5', effort: 'medium', maxTurns: 20, timeoutMinutes: 15, maxBudgetUsd: 4 },
    fix: { model: 'claude-sonnet-5-5', effort: 'medium', maxTurns: 12, timeoutMinutes: 10, maxBudgetUsd: 3 },
    lastFix: { model: 'claude-opus-5-5', effort: 'high', maxTurns: 15, timeoutMinutes: 12, maxBudgetUsd: 5 },
    implReview: { model: 'claude-opus-5-5', effort: 'high', maxTurns: 20, timeoutMinutes: 12, maxBudgetUsd: 4 },
  },
  loop: {
    planRounds: 2,
    // One retry with the rejection reason fixes a malformed answer; a second failure means the task was misread.
    outputAttempts: 2,
    fixAttempts: 3,
    // Fixers share one writable staging copy, so two of them could edit the same fixture at once.
    agentParallelism: 1,
    // Extra shuffled runs of the changed test files; a case that both passes and fails across them is flaky.
    flakyReruns: 2,
    // Reviews of the written tests; blocker and major findings send the tests back to the writer, the tests and the fixer. 0 turns the review off.
    implReviewRounds: 1,
  },
});
