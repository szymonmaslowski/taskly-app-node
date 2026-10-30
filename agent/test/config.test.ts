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

  it('rejects skill names that could point outside the skills directory', () => {
    expect(() => configSchema.parse({ workspaces: { backend: workspace({ skill: '../../etc' }) } })).toThrow(/lowercase name/);
  });

  it('rejects unknown keys, so a typo does not silently fall back to a default', () => {
    expect(() => configSchema.parse({ workspaces: { backend: workspace() }, flakyRerun: 3 })).toThrow(/flakyRerun/);
  });
});
