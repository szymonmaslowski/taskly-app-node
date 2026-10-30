import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

export const configFileName = 'testeragent.config.mts';

const repositoryRelativePath = z
  .string()
  .min(1)
  .refine(
    (value) => !path.isAbsolute(value) && !value.split('/').includes('..'),
    'must be a relative path that stays inside the repository',
  );

const workspaceSchema = z.object({
  root: repositoryRelativePath,
  skill: z.string().min(1),
  sources: z.array(repositoryRelativePath).min(1),
  ignoredSources: z.array(repositoryRelativePath).default([]),
  tests: z.array(repositoryRelativePath).min(1),
  writable: z.array(repositoryRelativePath).min(1),
  shared: z.array(repositoryRelativePath).default([]),
  context: z.array(repositoryRelativePath).default([]),
  commands: z.object({
    install: z.array(z.string().min(1)).min(1),
    typecheck: z.string().min(1),
    test: z.string().min(1),
  }),
});

export const configSchema = z.object({
  workspaces: z
    .record(z.string().regex(/^[a-z][a-z0-9-]*$/, 'must be a lowercase name'), workspaceSchema)
    .refine((workspaces) => Object.keys(workspaces).length > 0, 'at least one workspace is required'),
  flakyReruns: z.number().int().min(0).default(2),
  limits: z
    .object({
      maxChangedSourceFiles: z.number().int().positive().default(15),
      maxChangedLines: z.number().int().positive().default(1500),
    })
    .prefault({}),
});

export type TesterAgentConfig = z.output<typeof configSchema>;
export type WorkspaceConfig = TesterAgentConfig['workspaces'][string];
export type WorkspaceConfigInput = z.input<typeof workspaceSchema>;

export function defineConfig(config: z.input<typeof configSchema>) {
  return config;
}

export async function loadConfig(repositoryRoot: string) {
  const configUrl = pathToFileURL(path.join(repositoryRoot, configFileName)).href;
  const configModule = await import(configUrl);
  return configSchema.parse(configModule.default);
}
