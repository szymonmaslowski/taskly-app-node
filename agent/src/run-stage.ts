import { appendFile } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { AgentDefinition } from './agents.ts';
import type { Logger } from './logger.ts';
import { createContainerName, runContainer } from './sandbox/containers.ts';
import { agentImage } from './sandbox/images.ts';

const containerWorkingDirectory = '/workspace';

export type StageSettings = {
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxTurns: number;
  timeoutMinutes: number;
  maxBudgetUsd: number;
};

export type StageUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  durationMilliseconds: number;
  turns: number;
};

const toolUseEventSchema = z.object({
  type: z.literal('assistant'),
  message: z.object({
    content: z.array(
      z.object({
        type: z.string(),
        name: z.string().optional(),
        input: z
          .object({ file_path: z.string().optional(), pattern: z.string().optional(), path: z.string().optional() })
          .optional(),
      }),
    ),
  }),
});

const resultEventSchema = z.object({
  type: z.literal('result'),
  subtype: z.string(),
  is_error: z.boolean(),
  num_turns: z.number(),
  duration_ms: z.number(),
  total_cost_usd: z.number().default(0),
  usage: z.object({
    input_tokens: z.number(),
    output_tokens: z.number(),
    cache_read_input_tokens: z.number().default(0),
  }),
  structured_output: z.unknown().optional(),
  permission_denials: z
    .array(z.object({ tool_name: z.string(), tool_input: z.object({ file_path: z.string().optional() }) }))
    .default([]),
});

type ResultEvent = z.output<typeof resultEventSchema>;

function toWorkingDirectoryRelative(filePath: string) {
  return filePath.startsWith(`${containerWorkingDirectory}/`) ? filePath.slice(containerWorkingDirectory.length + 1) : filePath;
}

export function describeToolUse(name: string, input: { file_path?: string; pattern?: string; path?: string } = {}) {
  if (name === 'StructuredOutput') return undefined;
  if (input.file_path) return `${name} ${toWorkingDirectoryRelative(input.file_path)}`;
  if (input.pattern) return `${name} ${input.pattern}${input.path ? ` in ${toWorkingDirectoryRelative(input.path)}` : ''}`;
  return name;
}

export function readStreamLine(line: string, logger: Logger) {
  if (!line.trim()) return undefined;
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return undefined;
  }
  const toolUse = toolUseEventSchema.safeParse(event);
  if (toolUse.success) {
    for (const block of toolUse.data.message.content) {
      if (block.type !== 'tool_use' || !block.name) continue;
      const description = describeToolUse(block.name, block.input);
      if (description) logger.untrusted(description);
    }
    return undefined;
  }
  const result = resultEventSchema.safeParse(event);
  return result.success ? result.data : undefined;
}

export function resolveCredentialArguments(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.CLAUDE_CODE_OAUTH_TOKEN) return ['--env', 'CLAUDE_CODE_OAUTH_TOKEN'];
  return ['--env-file', environment.TESTERAGENT_ENV_FILE ?? path.join(homedir(), '.testeragent.env')];
}

export function isWritingAgent(agent: AgentDefinition) {
  return agent.tools.includes('Edit') || agent.tools.includes('Write');
}

type ClaudeArgumentsOptions = {
  agent: AgentDefinition;
  prompt: string;
  model: string;
  settings: StageSettings;
  jsonSchema: object;
};

export function buildClaudeArguments({ agent, prompt, model, settings, jsonSchema }: ClaudeArgumentsOptions) {
  return [
    '-p',
    prompt,
    '--restricted',
    '--strict-mcp-config',
    '--settings',
    '{}',
    '--system-prompt',
    agent.systemPrompt,
    '--model',
    model,
    '--tools',
    agent.tools.join(','),
    '--allowedTools',
    agent.tools.join(','),
    '--permission-mode',
    isWritingAgent(agent) ? 'acceptEdits' : 'default',
    '--disallowedTools',
    'WebFetch,WebSearch,Bash',
    '--max-turns',
    String(settings.maxTurns),
    '--effort',
    settings.effort,
    '--max-budget-usd',
    String(settings.maxBudgetUsd),
    '--output-format',
    'stream-json',
    '--verbose',
    '--json-schema',
    JSON.stringify(jsonSchema),
  ];
}

export function buildDockerArguments(workingDirectory: string, writable: boolean, credentialArguments: string[]) {
  const { uid, gid } = userInfo();
  return [
    '--user',
    `${uid}:${gid}`,
    ...credentialArguments,
    '--tmpfs',
    `/home/agent:uid=${uid},gid=${gid}`,
    '--env',
    'HOME=/home/agent',
    '--volume',
    `${workingDirectory}:${containerWorkingDirectory}${writable ? '' : ':ro'}`,
    agentImage,
  ];
}

function toUsage(model: string, result: ResultEvent): StageUsage {
  return {
    model,
    inputTokens: result.usage.input_tokens,
    outputTokens: result.usage.output_tokens,
    cacheReadTokens: result.usage.cache_read_input_tokens,
    costUsd: result.total_cost_usd,
    durationMilliseconds: result.duration_ms,
    turns: result.num_turns,
  };
}

type RunStageOptions<Schema extends z.ZodType> = {
  agent: AgentDefinition;
  prompt: string;
  workingDirectory: string;
  outputSchema: Schema;
  settings: StageSettings;
  logger: Logger;
  model?: string;
  transcriptFile?: string;
};

async function runAttempt<Schema extends z.ZodType>(options: RunStageOptions<Schema>, prompt: string, model: string) {
  const { agent, workingDirectory, outputSchema, settings, logger, transcriptFile } = options;
  const dockerArguments = buildDockerArguments(workingDirectory, isWritingAgent(agent), resolveCredentialArguments());
  const jsonSchema = z.toJSONSchema(outputSchema, { target: 'draft-7' });
  const claudeArguments = buildClaudeArguments({ agent, prompt, model, settings, jsonSchema });
  let resultEvent: ResultEvent | undefined;
  const pendingTranscriptWrites: Promise<void>[] = [];
  const processResult = await runContainer(createContainerName('agent'), [...dockerArguments, ...claudeArguments], {
    timeoutMilliseconds: settings.timeoutMinutes * 60_000,
    maxOutputCharacters: 50_000_000,
    onStdoutLine(line) {
      if (transcriptFile) pendingTranscriptWrites.push(appendFile(transcriptFile, `${line}\n`));
      resultEvent = readStreamLine(line, logger) ?? resultEvent;
    },
  });
  await Promise.all(pendingTranscriptWrites);
  if (processResult.timedOut) throw new Error(`Stage ${agent.name} timed out after ${settings.timeoutMinutes} minutes`);
  if (!resultEvent) throw new Error(`Stage ${agent.name} ended without a result: ${processResult.stderr.trim().slice(0, 500)}`);
  for (const denial of resultEvent.permission_denials) {
    logger.untrusted(`denied: ${describeToolUse(denial.tool_name, denial.tool_input)}`);
  }
  const usage = toUsage(model, resultEvent);
  if (resultEvent.is_error) return { usage, error: `the stage ended with "${resultEvent.subtype}"` };
  const parsed = outputSchema.safeParse(resultEvent.structured_output);
  if (!parsed.success) return { usage, error: z.prettifyError(parsed.error) };
  return { usage, output: parsed.data as z.output<Schema> };
}

export async function runStage<Schema extends z.ZodType>(options: RunStageOptions<Schema>) {
  const model = options.model ?? options.agent.model;
  options.logger.info(`model ${model}, effort ${options.settings.effort}`);
  const usages: StageUsage[] = [];
  let prompt = options.prompt;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const result = await runAttempt(options, prompt, model);
    usages.push(result.usage);
    options.logger.info(
      `${result.usage.inputTokens + result.usage.cacheReadTokens} tokens in, ${result.usage.outputTokens} out, ${result.usage.turns} turns`,
    );
    if (result.output !== undefined) return { output: result.output, usages };
    options.logger.info(`output rejected (attempt ${attempt} of 2)`);
    prompt = `${options.prompt}\n\nYour previous answer was rejected for this reason:\n${result.error}\nAnswer again, following the required output format.`;
  }
  throw new Error(`Stage ${options.agent.name} produced no valid output after 2 attempts`);
}
