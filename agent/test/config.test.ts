import { describe, expect, it } from 'vitest';
import { configSchema, type WorkspaceConfigInput } from '../src/config.ts';

function workspace(overrides: Partial<WorkspaceConfigInput> = {}): WorkspaceConfigInput {
  return {
    root: 'backend',
    skill: 'backend-unit-tests',
    sources: ['src/**/*.ts'],
    tests: ['tests/**/*.test.ts'],
    writable: ['tests/**'],
    commands: { install: ['npm ci --ignore-scripts'], typecheck: 'npx tsc --noEmit', test: 'npx vitest run' },
    ...overrides,
  };
}

describe('configSchema', () => {
  it('fills in defaults for optional settings', () => {
    const config = configSchema.parse({ workspaces: { backend: workspace() } });
    expect(config.flakyReruns).toBe(2);
    expect(config.limits).toEqual({ maxChangedSourceFiles: 15, maxChangedLines: 1500 });
    expect(config.workspaces.backend).toMatchObject({ ignoredSources: [], shared: [], context: [] });
  });

  it.each([
    { root: '/etc' },
    { root: '../outside' },
    { writable: ['tests/../../secrets/**'] },
    { sources: ['/absolute/**/*.ts'] },
  ])('rejects paths that leave the repository: %j', (overrides) => {
    expect(() => configSchema.parse({ workspaces: { backend: workspace(overrides) } })).toThrow(/inside the repository/);
  });

  it('requires at least one workspace', () => {
    expect(() => configSchema.parse({ workspaces: {} })).toThrow(/at least one workspace/);
  });

  it('rejects workspace names that are not lowercase identifiers', () => {
    expect(() => configSchema.parse({ workspaces: { 'Back End': workspace() } })).toThrow(/lowercase name/);
  });
});
