import { readFile } from 'node:fs/promises';
import path from 'node:path';

export type Skill = {
  name: string;
  instructions: string;
};

export function parseSkill(name: string, content: string): Skill {
  const match = /^---\n[\s\S]*?\n---\n([\s\S]*)$/.exec(content);
  if (!match) throw new Error(`Skill "${name}" has no frontmatter`);
  return { name, instructions: match[1].trim() };
}

// Skills go into the prompts, so they must come from the base checkout, never the PR head.
export async function loadSkill(trustedRepositoryRoot: string, name: string) {
  const content = await readFile(path.join(trustedRepositoryRoot, '.claude', 'skills', name, 'SKILL.md'), 'utf8');
  return parseSkill(name, content);
}
