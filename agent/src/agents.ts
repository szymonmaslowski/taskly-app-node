import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const agentFrontmatterSchema = z.object({
  description: z.string().min(1),
  model: z.string().min(1),
  tools: z.array(z.enum(['Read', 'Grep', 'Glob', 'Edit', 'Write'])).min(1),
});

export type AgentDefinition = z.output<typeof agentFrontmatterSchema> & {
  name: string;
  systemPrompt: string;
};

export function parseAgentDefinition(name: string, content: string): AgentDefinition {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(content);
  if (!match) throw new Error(`Agent "${name}" has no frontmatter`);
  const [, frontmatter, body] = match;
  const fields = new Map<string, string>();
  for (const line of frontmatter.split('\n')) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) continue;
    fields.set(line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim());
  }
  const parsed = agentFrontmatterSchema.parse({
    description: fields.get('description'),
    model: fields.get('model'),
    tools: fields.get('tools')?.split(',').map((tool) => tool.trim()),
  });
  return { name, ...parsed, systemPrompt: body.trim() };
}

export async function loadAgentDefinition(repositoryRoot: string, name: string) {
  const content = await readFile(path.join(repositoryRoot, '.claude', 'agents', `${name}.md`), 'utf8');
  return parseAgentDefinition(name, content);
}
