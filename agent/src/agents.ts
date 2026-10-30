import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

// Models are chosen per stage by the orchestrator, so a model in an agent file is rejected rather than silently ignored.
const agentFrontmatterSchema = z.strictObject({
  description: z.string().min(1),
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
  const { tools, ...otherFields } = Object.fromEntries(fields);
  const parsed = agentFrontmatterSchema.parse({ ...otherFields, tools: tools?.split(',').map((tool) => tool.trim()) });
  return { name, ...parsed, systemPrompt: body.trim() };
}

// The definition becomes the system prompt, so it must come from the base checkout, never the PR head.
export async function loadAgentDefinition(trustedRepositoryRoot: string, name: string) {
  const content = await readFile(path.join(trustedRepositoryRoot, '.claude', 'agents', `${name}.md`), 'utf8');
  return parseAgentDefinition(name, content);
}
