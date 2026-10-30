import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadAgentDefinition } from '../src/agents.ts';
import { loadConfig } from '../src/config.ts';
import { loadSkill, loadSkillReference, parseSkill } from '../src/skills.ts';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

describe('repository agent definitions', () => {
  it('parses every agent file, and only writing agents may edit files', async () => {
    const files = await readdir(path.join(repositoryRoot, '.claude', 'agents'));
    const agents = await Promise.all(files.map((file) => loadAgentDefinition(repositoryRoot, path.basename(file, '.md'))));
    const writers = agents.filter((agent) => agent.tools.includes('Edit') || agent.tools.includes('Write')).map((agent) => agent.name);
    expect(writers.sort()).toEqual(['test-fixer', 'test-writer']);
  });
});

describe('repository skills', () => {
  it('has a skill for every configured workspace', async () => {
    const config = await loadConfig(repositoryRoot);
    for (const workspace of Object.values(config.workspaces)) {
      expect((await loadSkill(repositoryRoot, workspace.skill)).instructions).not.toBe('');
    }
  });

  it('names every skill after its folder and gives it a description', async () => {
    const skillsDirectory = path.join(repositoryRoot, '.claude', 'skills');
    for (const name of await readdir(skillsDirectory)) {
      const content = await readFile(path.join(skillsDirectory, name, 'SKILL.md'), 'utf8');
      expect(content).toMatch(new RegExp(`^---\\nname: ${name}\\ndescription: .+\\n---\\n`));
    }
  });

  it('links only to reference files that exist next to each skill', async () => {
    const skillsDirectory = path.join(repositoryRoot, '.claude', 'skills');
    for (const name of await readdir(skillsDirectory)) {
      const instructions = (await loadSkill(repositoryRoot, name)).instructions;
      for (const [, target] of instructions.matchAll(/\]\(([^)#]+\.md)\)/g)) {
        expect((await loadSkillReference(repositoryRoot, name, target)).instructions).not.toBe('');
      }
    }
  });

  it('gives every workspace skill a reference for planning, writing and reviewing', async () => {
    const config = await loadConfig(repositoryRoot);
    for (const workspace of Object.values(config.workspaces)) {
      for (const file of ['planning.md', 'writing.md', 'reviewing.md']) {
        expect((await loadSkillReference(repositoryRoot, workspace.skill, file)).instructions).not.toBe('');
      }
    }
  });

  it('drops the frontmatter from the instructions', () => {
    expect(parseSkill('demo', '---\nname: demo\ndescription: Demo\n---\n\n# Demo\n')).toEqual({ name: 'demo', instructions: '# Demo' });
  });
});
