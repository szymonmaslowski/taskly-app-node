import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadAgentDefinition } from '../src/agents.ts';
import { loadConfig } from '../src/config.ts';
import { loadSkill, parseSkill } from '../src/skills.ts';

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

  it('drops the frontmatter from the instructions', () => {
    expect(parseSkill('demo', '---\nname: demo\ndescription: Demo\n---\n\n# Demo\n')).toEqual({ name: 'demo', instructions: '# Demo' });
  });
});
