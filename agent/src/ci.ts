import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.ts';
import { exportPatch, findPatchProblems, inspectPatch } from './publish/patch.ts';
import { findSecretLeaks } from './publish/secrets.ts';
import { verifyPatchedCheckout } from './publish/verify.ts';

const trustedRepositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const [command, ...rest] = process.argv.slice(2);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function exportCommand() {
  const { values } = parseArgs({ args: rest, options: { repository: { type: 'string' }, output: { type: 'string' } } });
  if (!values.repository || !values.output) fail('export-patch needs --repository and --output.');
  const patch = await exportPatch(path.resolve(values.repository));
  await writeFile(values.output, patch);
  console.log(patch ? `Patch written: ${Buffer.byteLength(patch)} bytes` : 'No changes to export');
}

async function validateCommand() {
  const { values } = parseArgs({ args: rest, options: { checkout: { type: 'string' }, patch: { type: 'string' } } });
  if (!values.checkout || !values.patch) fail('validate-patch needs --checkout and --patch.');
  const patch = await readFile(values.patch, 'utf8');
  if (!patch) return console.log('Empty patch: nothing to validate');
  const config = await loadConfig(trustedRepositoryRoot);
  const problems = findPatchProblems(patch, await inspectPatch(path.resolve(values.checkout), patch), config);
  if (problems.length > 0) fail(`The patch was rejected:\n${problems.map((problem) => `- ${problem}`).join('\n')}`);
  console.log('Patch accepted');
}

// Only the names of the secrets are ever printed, never a value or the matching text.
async function scanCommand() {
  const { values, positionals } = parseArgs({ args: rest, options: { env: { type: 'string', multiple: true } }, allowPositionals: true });
  const secrets = (values.env ?? []).flatMap((name) => (process.env[name] ? [{ name, value: process.env[name] }] : []));
  const texts = await Promise.all(positionals.map(async (file) => ({ source: file, content: await readFile(file, 'utf8') })));
  const leaks = findSecretLeaks(texts, secrets);
  if (leaks.length > 0) fail(`Secrets found:\n${leaks.map((leak) => `- ${leak.secretName} in ${leak.source}`).join('\n')}`);
  console.log(`No secrets found in ${texts.length} files`);
}

async function verifyCommand() {
  const { values } = parseArgs({ args: rest, options: { repository: { type: 'string' }, output: { type: 'string' } } });
  if (!values.repository || !values.output) fail('verify needs --repository and --output.');
  const result = await verifyPatchedCheckout(trustedRepositoryRoot, path.resolve(values.repository));
  await writeFile(values.output, `${JSON.stringify(result, null, 2)}\n`);
  for (const workspace of result.workspaces) {
    console.log(`${workspace.name}: typecheck ${workspace.typecheckPassed ? 'passed' : 'failed'}, ${workspace.testsPassed} passed, ${workspace.testsFailed} failed`);
  }
  if (result.problems.length > 0) fail(`Verification failed:\n${result.problems.map((problem) => `- ${problem}`).join('\n')}`);
}

const commands: Record<string, () => Promise<void>> = {
  'export-patch': exportCommand,
  'validate-patch': validateCommand,
  'scan-secrets': scanCommand,
  verify: verifyCommand,
};

const run = command ? commands[command] : undefined;
if (!run) fail(`Usage: ci.ts <${Object.keys(commands).join('|')}> [options]`);
await run();
