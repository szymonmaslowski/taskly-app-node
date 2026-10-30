import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { defaultLoop, defaultStages, loopCaps, stageCaps, stageEfforts, type StageName } from './stages.ts';

export const configFileName = 'testeragent.config.mts';

const repositoryRelativePath = z
  .string()
  .min(1)
  .refine(
    (value) => !path.isAbsolute(value) && !value.split('/').includes('..'),
    'must be a relative path that stays inside the repository',
  );

const lowercaseName = z.string().regex(/^[a-z][a-z0-9-]*$/, 'must be a lowercase name');

const workspaceSchema = z.strictObject({
  root: repositoryRelativePath,
  skill: lowercaseName,
  sources: z.array(repositoryRelativePath).min(1),
  ignoredSources: z.array(repositoryRelativePath).default([]),
  tests: z.array(repositoryRelativePath).min(1),
  writable: z.array(repositoryRelativePath).min(1),
  shared: z.array(repositoryRelativePath).default([]),
  context: z.array(repositoryRelativePath).default([]),
  commands: z.strictObject({
    install: z.array(z.string().min(1)).min(1),
    typecheck: z.string().min(1),
    test: z.string().min(1),
  }),
});

function stageSchema(stage: StageName) {
  const defaults = defaultStages[stage];
  return z
    .strictObject({
      agent: lowercaseName.default(defaults.agent),
      skills: z.array(lowercaseName).default(defaults.skills),
      workspaceReference: z.string().regex(/^[a-z][a-z0-9-]*\.md$/, 'must be a markdown file name').default(defaults.workspaceReference),
      model: z.string().min(1).default(defaults.model),
      effort: z.enum(stageEfforts).default(defaults.effort),
      maxTurns: z.number().int().positive().max(stageCaps.maxTurns).default(defaults.maxTurns),
      timeoutMinutes: z.number().positive().max(stageCaps.timeoutMinutes).default(defaults.timeoutMinutes),
      maxBudgetUsd: z.number().positive().max(stageCaps.maxBudgetUsd).default(defaults.maxBudgetUsd),
    })
    .prefault({});
}

const loopSchema = z
  .strictObject({
    planRounds: z.number().int().min(1).max(loopCaps.planRounds).default(defaultLoop.planRounds),
    outputAttempts: z.number().int().min(1).max(loopCaps.outputAttempts).default(defaultLoop.outputAttempts),
    fixAttempts: z.number().int().min(0).max(loopCaps.fixAttempts).default(defaultLoop.fixAttempts),
    agentParallelism: z.number().int().min(1).max(loopCaps.agentParallelism).default(defaultLoop.agentParallelism),
  })
  .prefault({});

export const configSchema = z.strictObject({
  workspaces: z
    .record(lowercaseName, workspaceSchema)
    .refine((workspaces) => Object.keys(workspaces).length > 0, 'at least one workspace is required'),
  flakyReruns: z.number().int().min(0).default(2),
  limits: z
    .strictObject({
      maxChangedSourceFiles: z.number().int().positive().default(15),
      maxChangedLines: z.number().int().positive().default(1500),
    })
    .prefault({}),
  stages: z
    .strictObject({
      plan: stageSchema('plan'),
      planReview: stageSchema('planReview'),
      write: stageSchema('write'),
      fix: stageSchema('fix'),
      lastFix: stageSchema('lastFix'),
    })
    .prefault({}),
  loop: loopSchema,
});

export type TesterAgentConfig = z.output<typeof configSchema>;
export type WorkspaceConfig = TesterAgentConfig['workspaces'][string];
export type StageConfig = TesterAgentConfig['stages'][StageName];
export type LoopConfig = TesterAgentConfig['loop'];
export type WorkspaceConfigInput = z.input<typeof workspaceSchema>;

export function defineConfig(config: z.input<typeof configSchema>) {
  return config;
}

// Importing the config runs its code, so the root must be a checkout of the base branch, never the PR head.
export async function loadConfig(trustedRepositoryRoot: string) {
  const configUrl = pathToFileURL(path.join(trustedRepositoryRoot, configFileName)).href;
  const configModule = await import(configUrl);
  return configSchema.parse(configModule.default);
}
