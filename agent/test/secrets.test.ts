import { describe, expect, it } from 'vitest';
import { findSecretLeaks } from '../src/publish/secrets.ts';

const secret = { name: 'CLAUDE_CODE_OAUTH_TOKEN', value: 'sk-ant-oat01-example-token-value-1234567890' };

function leaksIn(content: string) {
  return findSecretLeaks([{ source: 'patch.diff', content }], [secret]);
}

describe('findSecretLeaks', () => {
  it.each([
    ['plain', (value: string) => `const token = '${value}';`],
    ['reversed', (value: string) => [...value].reverse().join('')],
    ['URL-encoded', (value: string) => `?t=${encodeURIComponent(value)}`],
    ['hex', (value: string) => Buffer.from(value).toString('hex')],
    ['base64 at any offset', (value: string) => Buffer.from(`xy${value}`).toString('base64')],
    ['base64url', (value: string) => Buffer.from(`x${value}`).toString('base64url')],
  ])('finds the secret %s', (_form, encode) => {
    expect(leaksIn(`prefix ${encode(secret.value)} suffix`)).toEqual([{ source: 'patch.diff', secretName: 'CLAUDE_CODE_OAUTH_TOKEN' }]);
  });

  it('finds nothing in ordinary test code', () => {
    expect(leaksIn("it('returns ok', () => expect(health()).toEqual({ status: 'ok' }));")).toEqual([]);
  });

  it('ignores secrets too short to match reliably', () => {
    expect(findSecretLeaks([{ source: 'a', content: 'abc' }], [{ name: 'SHORT', value: 'abc' }])).toEqual([]);
  });
});
