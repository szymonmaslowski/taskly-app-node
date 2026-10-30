import { describe, expect, it } from 'vitest';
import { parseAgentDefinition } from '../src/agents.ts';

describe('parseAgentDefinition', () => {
  it('reads the frontmatter and uses the body as the system prompt', () => {
    const agent = parseAgentDefinition(
      'test-writer',
      '---\ndescription: Writes tests\nmodel: claude-sonnet-5-5\ntools: Read, Grep, Glob, Edit, Write\n---\n\nYou write tests.\n',
    );
    expect(agent).toEqual({
      name: 'test-writer',
      description: 'Writes tests',
      model: 'claude-sonnet-5-5',
      tools: ['Read', 'Grep', 'Glob', 'Edit', 'Write'],
      systemPrompt: 'You write tests.',
    });
  });

  it('rejects tools the agent may never use', () => {
    const content = '---\ndescription: Runs things\nmodel: claude-sonnet-5-5\ntools: Read, Bash\n---\nprompt';
    expect(() => parseAgentDefinition('runner', content)).toThrow();
  });

  it('rejects a file without frontmatter', () => {
    expect(() => parseAgentDefinition('broken', 'just a prompt')).toThrow(/no frontmatter/);
  });
});
