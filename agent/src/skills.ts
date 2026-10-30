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

function readSkillFile(trustedRepositoryRoot: string, name: string, file: string) {
  return readFile(path.join(trustedRepositoryRoot, '.claude', 'skills', name, file), 'utf8');
}

// Skills go into the prompts, so they must come from the base checkout, never the PR head.
export async function loadSkill(trustedRepositoryRoot: string, name: string) {
  return parseSkill(name, await readSkillFile(trustedRepositoryRoot, name, 'SKILL.md'));
}

export async function loadSkillReference(trustedRepositoryRoot: string, name: string, file: string): Promise<Skill> {
  return { name: `${name}/${file}`, instructions: (await readSkillFile(trustedRepositoryRoot, name, file)).trim() };
}
