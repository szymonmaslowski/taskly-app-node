import path from 'node:path';

const importSpecifierPatterns = [
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\s+['"]([^'"]+)['"]/g,
];

const mockedSpecifierPattern = /\bvi\.mock\(\s*['"]([^'"]+)['"]/g;

const resolutionSuffixes = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

function collectSpecifiers(content: string, patterns: RegExp[]) {
  const specifiers = new Set<string>();
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) specifiers.add(match[1]);
  }
  return [...specifiers];
}

export function findImportSpecifiers(content: string) {
  return collectSpecifiers(content, importSpecifierPatterns);
}

export function findMockedSpecifiers(content: string) {
  return collectSpecifiers(content, [mockedSpecifierPattern]);
}

export function resolveRelativeImport(importingFile: string, specifier: string, knownFiles: Set<string>) {
  if (!specifier.startsWith('.')) return undefined;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(importingFile), specifier));
  const withoutJavaScriptExtension = base.replace(/\.js$/, '.ts');
  for (const candidate of [base, withoutJavaScriptExtension]) {
    for (const suffix of resolutionSuffixes) {
      if (knownFiles.has(`${candidate}${suffix}`)) return `${candidate}${suffix}`;
    }
  }
  return undefined;
}

function resolveAll(importingFile: string, specifiers: string[], knownFiles: Set<string>) {
  return specifiers
    .map((specifier) => resolveRelativeImport(importingFile, specifier, knownFiles))
    .filter((resolved): resolved is string => resolved !== undefined);
}

export function findTestedFiles(testFile: string, content: string, knownFiles: Set<string>) {
  const mockedFiles = new Set(resolveAll(testFile, findMockedSpecifiers(content), knownFiles));
  return resolveAll(testFile, findImportSpecifiers(content), knownFiles).filter((importedFile) => !mockedFiles.has(importedFile));
}
