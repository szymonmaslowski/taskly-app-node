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

export const testingRulesName = 'TESTING.md';

// The repository's own testing rules are optional and, like the skills, come from the base checkout.
export async function loadTestingRules(trustedRepositoryRoot: string): Promise<Skill | undefined> {
  try {
    const content = await readFile(path.join(trustedRepositoryRoot, testingRulesName), 'utf8');
    return { name: testingRulesName, instructions: content.trim() };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}
