import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { configSchema, loadConfig, type WorkspaceConfigInput } from '../src/config.ts';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

function workspace(overrides: Partial<WorkspaceConfigInput> = {}): WorkspaceConfigInput {
  return {
    root: 'backend',
    skill: 'backend-unit-tests',
    sources: ['src/**/*.ts'],
    tests: ['tests/**/*.test.ts'],
    writable: ['tests/**'],
    commands: { install: ['npm ci --ignore-scripts'], typecheck: 'node_modules/.bin/tsc --noEmit', test: 'node_modules/.bin/vitest run' },
    ...overrides,
  };
}

describe('loadConfig', () => {
  it('loads and validates the repository configuration', async () => {
    const config = await loadConfig(repositoryRoot);
    expect(Object.keys(config.workspaces)).toEqual(['backend', 'frontend']);
    expect(config.workspaces.backend.writable).toEqual(['tests/**']);
  });
});

const stage = { model: 'claude-sonnet-5-5', effort: 'medium' as const, maxTurns: 10, timeoutMinutes: 5, maxBudgetUsd: 1 };
const stages = { plan: stage, planReview: stage, write: stage, fix: stage, lastFix: stage };
const loop = { planRounds: 2, outputAttempts: 2, fixAttempts: 3, agentParallelism: 1, flakyReruns: 2 };

describe('configSchema', () => {
  it('fills in defaults for optional settings', () => {
    const config = configSchema.parse({ workspaces: { backend: workspace() }, stages, loop });
    expect(config.limits).toEqual({ maxChangedSourceFiles: 15 });
    expect(config.workspaces.backend).toMatchObject({ ignoredSources: [], shared: [], context: [] });
  });

  it.each([
    { root: '/etc' },
    { root: '../outside' },
    { writable: ['tests/../../secrets/**'] },
    { sources: ['/absolute/**/*.ts'] },
  ])('rejects paths that leave the repository: %j', (overrides) => {
    expect(() => configSchema.parse({ workspaces: { backend: workspace(overrides) }, stages, loop })).toThrow(/inside the repository/);
  });

  it('requires at least one workspace', () => {
    expect(() => configSchema.parse({ workspaces: {}, stages, loop })).toThrow(/at least one workspace/);
  });

  it('rejects workspace names that are not lowercase identifiers', () => {
    expect(() => configSchema.parse({ workspaces: { 'Back End': workspace() }, stages, loop })).toThrow(/lowercase name/);
  });

  it('rejects skill names that could point outside the skills directory', () => {
    expect(() => configSchema.parse({ workspaces: { backend: workspace({ skill: '../../etc' }) }, stages, loop })).toThrow(/lowercase name/);
  });

  it('requires every stage and loop setting, so nothing runs on a value nobody chose', () => {
    expect(() => configSchema.parse({ workspaces: { backend: workspace() }, loop })).toThrow(/stages/);
    expect(() => configSchema.parse({ workspaces: { backend: workspace() }, stages: { ...stages, write: { model: 'claude-opus-5-5' } }, loop })).toThrow(/effort/);
  });

  it('rejects settings that belong to the pipeline, such as which agent a stage uses', () => {
    expect(() => configSchema.parse({ workspaces: { backend: workspace() }, stages: { ...stages, plan: { ...stage, agent: 'test-writer' } }, loop })).toThrow(/agent/);
  });

  it.each([
    { stages: { ...stages, fix: { ...stage, maxBudgetUsd: 50 } }, loop },
    { stages: { ...stages, plan: { ...stage, maxTurns: 500 } }, loop },
    { stages, loop: { ...loop, fixAttempts: 10 } },
    { stages, loop: { ...loop, flakyReruns: 20 } },
  ])('refuses limits above the hard caps: %j', (settings) => {
    expect(() => configSchema.parse({ workspaces: { backend: workspace() }, ...settings })).toThrow();
  });

  it('rejects unknown keys, so a typo does not silently fall back to a default', () => {
    expect(() => configSchema.parse({ workspaces: { backend: workspace() }, stages, loop, flakyRerun: 3 })).toThrow(/flakyRerun/);
  });
});
