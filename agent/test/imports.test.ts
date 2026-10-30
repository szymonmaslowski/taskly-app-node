import { describe, expect, it } from 'vitest';
import { findTestedFiles, resolveRelativeImport } from '../src/analyze/imports.ts';

describe('resolveRelativeImport', () => {
  const knownFiles = new Set(['backend/src/router.ts', 'frontend/src/lib/http.ts', 'frontend/src/design-system/index.ts']);

  it.each([
    ['backend/tests/router.test.ts', '../src/router.ts', 'backend/src/router.ts'],
    ['frontend/src/lib/http.test.ts', './http', 'frontend/src/lib/http.ts'],
    ['frontend/src/App.test.tsx', './design-system', 'frontend/src/design-system/index.ts'],
  ])('resolves %s importing %s', (importingFile, specifier, expected) => {
    expect(resolveRelativeImport(importingFile, specifier, knownFiles)).toBe(expected);
  });

  it('ignores package imports', () => {
    expect(resolveRelativeImport('frontend/src/App.test.tsx', 'react', knownFiles)).toBeUndefined();
  });
});

describe('findTestedFiles', () => {
  it('treats imported modules as tested, except the ones the test mocks', () => {
    const content = `
      import { useTodosQuery } from './hooks/useTodosQuery'
      import { TodosPage } from './TodosPage'
      vi.mock('./hooks/useTodosQuery', () => ({ useTodosQuery: vi.fn() }))
    `;
    const knownFiles = new Set(['frontend/src/TodosPage.tsx', 'frontend/src/hooks/useTodosQuery.ts']);
    expect(findTestedFiles('frontend/src/TodosPage.test.tsx', content, knownFiles)).toEqual(['frontend/src/TodosPage.tsx']);
  });
});
