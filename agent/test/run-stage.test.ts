import { describe, expect, it } from 'vitest';
import type { AgentDefinition } from '../src/agents.ts';
import type { Logger } from '../src/logger.ts';
import {
  buildClaudeArguments,
  buildDockerArguments,
  describeToolUse,
  readStreamLine,
  resolveCredentialArguments,
} from '../src/run-stage.ts';

const reviewer: AgentDefinition = {
  name: 'plan-reviewer',
  description: 'Reviews plans',
  model: 'claude-opus-5-5',
  tools: ['Read', 'Grep', 'Glob'],
  systemPrompt: 'You review plans.',
};

function recordingLogger() {
  const untrusted: string[] = [];
  const logger: Logger = { startStep() {}, endStep() {}, info() {}, untrusted: (line) => untrusted.push(line) };
  return { logger, untrusted };
}

describe('describeToolUse', () => {
  it.each([
    ['Read', { file_path: '/workspace/backend/src/router.ts' }, 'Read backend/src/router.ts'],
    ['Grep', { pattern: 'createTodosRouter', path: '/workspace/backend' }, 'Grep createTodosRouter in backend'],
    ['Glob', { pattern: '**/*.test.ts' }, 'Glob **/*.test.ts'],
  ])('describes %s by path or pattern', (name, input, expected) => {
    expect(describeToolUse(name, input)).toBe(expected);
  });

  it('hides the structured output tool', () => {
    expect(describeToolUse('StructuredOutput', {})).toBeUndefined();
  });
});

describe('readStreamLine', () => {
  it('logs tool calls and returns nothing for them', () => {
    const { logger, untrusted } = recordingLogger();
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/workspace/backend/tests/router.test.ts' } }] },
    });
    expect(readStreamLine(line, logger)).toBeUndefined();
    expect(untrusted).toEqual(['Read backend/tests/router.test.ts']);
  });

  it('returns the final result event with its structured output', () => {
    const { logger } = recordingLogger();
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      num_turns: 3,
      duration_ms: 4000,
      total_cost_usd: 0.01,
      usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50 },
      structured_output: { cases: [] },
    });
    expect(readStreamLine(line, logger)).toMatchObject({ structured_output: { cases: [] }, num_turns: 3, permission_denials: [] });
  });

  it('ignores lines that are not JSON', () => {
    expect(readStreamLine('warning: something', recordingLogger().logger)).toBeUndefined();
  });
});

describe('buildClaudeArguments', () => {
  it('restricts the session to the agent tools and never allows Bash or web access', () => {
    const settings = { effort: 'high' as const, maxTurns: 15, timeoutMinutes: 8, maxBudgetUsd: 2 };
    const commandLine = buildClaudeArguments({ agent: reviewer, prompt: 'Review', model: 'claude-opus-5-5', settings, jsonSchema: {} });
    expect(commandLine).toEqual(expect.arrayContaining(['--restricted', '--strict-mcp-config', '--output-format', 'stream-json']));
    expect(commandLine[commandLine.indexOf('--tools') + 1]).toBe('Read,Grep,Glob');
    expect(commandLine[commandLine.indexOf('--disallowedTools') + 1]).toBe('WebFetch,WebSearch,Bash');
    expect(commandLine[commandLine.indexOf('--system-prompt') + 1]).toBe('You review plans.');
    expect(commandLine[commandLine.indexOf('--permission-mode') + 1]).toBe('default');
  });

  it('lets writing agents edit files without asking', () => {
    const writer: AgentDefinition = { ...reviewer, name: 'test-writer', tools: ['Read', 'Edit', 'Write'] };
    const settings = { effort: 'medium' as const, maxTurns: 40, timeoutMinutes: 15, maxBudgetUsd: 4 };
    const commandLine = buildClaudeArguments({ agent: writer, prompt: 'Write', model: 'claude-sonnet-5-5', settings, jsonSchema: {} });
    expect(commandLine[commandLine.indexOf('--allowedTools') + 1]).toBe('Read,Edit,Write');
    expect(commandLine[commandLine.indexOf('--permission-mode') + 1]).toBe('acceptEdits');
  });
});

describe('buildDockerArguments', () => {
  it('mounts the working directory read-only for agents that do not write', () => {
    expect(buildDockerArguments('/tmp/staging', false, [])).toContain('/tmp/staging:/workspace:ro');
    expect(buildDockerArguments('/tmp/staging', true, [])).toContain('/tmp/staging:/workspace');
  });
});

describe('resolveCredentialArguments', () => {
  it('passes the token through from the environment without putting its value on the command line', () => {
    expect(resolveCredentialArguments({ CLAUDE_CODE_OAUTH_TOKEN: 'secret' })).toEqual(['--env', 'CLAUDE_CODE_OAUTH_TOKEN']);
  });

  it('falls back to an env file', () => {
    expect(resolveCredentialArguments({ TESTERAGENT_ENV_FILE: '/home/me/agent.env' })).toEqual(['--env-file', '/home/me/agent.env']);
  });
});
