import {
  QueryClient,
  QueryClientProvider,
  useMutation,
} from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { todoKeys } from '../api/queryKeys'
import { useTodosBusy } from './useTodosBusy'

function setup(mutationKey: readonly string[]) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  let release: () => void = () => {}
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(
    () => ({
      busy: useTodosBusy(),
      mutation: useMutation({ mutationKey, mutationFn: () => pending }),
    }),
    { wrapper },
  )
  return { result, release }
}

describe('useTodosBusy', () => {
  it('returns false when no todo mutation is running', () => {
    const { result } = setup(todoKeys.create)

    expect(result.current.busy).toBe(false)
  })

  it.each([
    ['create', todoKeys.create],
    ['update', todoKeys.update],
    ['delete', todoKeys.delete],
  ])(
    'returns true while a %s mutation is pending and false after it settles',
    async (_name, key) => {
      const { result, release } = setup(key)

      act(() => {
        result.current.mutation.mutate()
      })
      await waitFor(() => expect(result.current.busy).toBe(true))

      await act(async () => {
        release()
      })
      await waitFor(() => expect(result.current.busy).toBe(false))
    },
  )

  it('ignores mutations whose key is outside the todos prefix', async () => {
    const { result, release } = setup(['other'])

    act(() => {
      result.current.mutation.mutate()
    })
    await waitFor(() => expect(result.current.mutation.isPending).toBe(true))

    expect(result.current.busy).toBe(false)

    await act(async () => {
      release()
    })
  })
})
