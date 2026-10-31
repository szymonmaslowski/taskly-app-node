import { afterEach, expect, it, vi } from 'vitest';

const names = ['DATABASE_URL', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_HOST', 'DB_PORT', 'POSTGRES_DB'];
const parts: Record<string, string> = {
  POSTGRES_USER: 'user',
  POSTGRES_PASSWORD: 'pass',
  POSTGRES_HOST: 'dbhost',
  DB_PORT: '5433',
  POSTGRES_DB: 'taskly',
};

async function setup(env: Record<string, string> = {}) {
  vi.resetModules();
  for (const name of names) vi.stubEnv(name, env[name] ?? '');
  const { resolveDatabaseUrl } = await import('../src/core/config.ts');
  return { resolveDatabaseUrl };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

it('prefers the explicit override over DATABASE_URL and the POSTGRES parts', async () => {
  const { resolveDatabaseUrl } = await setup({ ...parts, DATABASE_URL: 'postgresql://e:e@env:2/e' });

  expect(resolveDatabaseUrl('postgresql://o:o@override:1/o')).toBe('postgresql://o:o@override:1/o');
});

it('uses DATABASE_URL when no override is given', async () => {
  const { resolveDatabaseUrl } = await setup({ ...parts, DATABASE_URL: 'postgresql://u:p@db:5432/app' });

  expect(resolveDatabaseUrl()).toBe('postgresql://u:p@db:5432/app');
});

it.each([
  ['postgresql+psycopg://u:p@db:5432/app', 'postgresql://u:p@db:5432/app'],
  ['postgresql://u:p@db:5432/app', 'postgresql://u:p@db:5432/app'],
  ['postgresql://u:p@db:5432/postgresql+psycopg:x', 'postgresql://u:p@db:5432/postgresql+psycopg:x'],
])('rewrites only a leading postgresql+psycopg scheme: %s', async (input, expected) => {
  const { resolveDatabaseUrl } = await setup({ DATABASE_URL: input });

  expect(resolveDatabaseUrl()).toBe(expected);
});

it('builds the URL from the POSTGRES parts when no URL is set', async () => {
  const { resolveDatabaseUrl } = await setup(parts);

  expect(resolveDatabaseUrl()).toBe('postgresql://user:pass@dbhost:5433/taskly');
});

it('encodes special characters in credentials and database name', async () => {
  const { resolveDatabaseUrl } = await setup({
    ...parts,
    POSTGRES_USER: 'us@er',
    POSTGRES_PASSWORD: 'p:a/ss#word?',
    POSTGRES_DB: 'my db/x',
  });

  const url = new URL(resolveDatabaseUrl());

  expect(decodeURIComponent(url.username)).toBe('us@er');
  expect(decodeURIComponent(url.password)).toBe('p:a/ss#word?');
  expect(url.hostname).toBe('dbhost');
  expect(url.pathname).toBe('/my%20db%2Fx');
});

it.each(['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_HOST', 'DB_PORT', 'POSTGRES_DB'])(
  'throws naming the missing variable: %s',
  async (name) => {
    const { resolveDatabaseUrl } = await setup({ ...parts, [name]: '' });

    expect(() => resolveDatabaseUrl()).toThrow(`Missing environment variable: ${name}`);
  },
);

it('names the earlier variable when two are missing', async () => {
  const { resolveDatabaseUrl } = await setup({ ...parts, POSTGRES_HOST: '', POSTGRES_PASSWORD: '' });

  expect(() => resolveDatabaseUrl()).toThrow('Missing environment variable: POSTGRES_PASSWORD');
});

it('treats an empty variable as missing', async () => {
  const { resolveDatabaseUrl } = await setup({ ...parts, DATABASE_URL: '', POSTGRES_PASSWORD: '' });

  expect(() => resolveDatabaseUrl()).toThrow('Missing environment variable: POSTGRES_PASSWORD');
});
