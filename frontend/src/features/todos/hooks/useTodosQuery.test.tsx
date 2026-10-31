import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import { useTodosQuery } from './useTodosQuery'

vi.mock('../api/todos', () => ({
  todosApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
}))

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const view = renderHook(() => useTodosQuery(), { wrapper })
  return { client, ...view }
}

afterEach(() => {
  vi.resetAllMocks()
})

describe('useTodosQuery', () => {
  it('returns the todos from the API once loaded', async () => {
    vi.mocked(todosApi.list).mockResolvedValue([todoFixture])

    const { result } = setup()

    expect(result.current.isPending).toBe(true)
    expect(result.current.data).toBeUndefined()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([todoFixture])
  })

  it('passes the query abort signal to the API', async () => {
    vi.mocked(todosApi.list).mockReturnValue(new Promise(() => {}))

    const { unmount } = setup()
    await waitFor(() => expect(todosApi.list).toHaveBeenCalledTimes(1))
    expect(todosApi.list).toHaveBeenCalledWith(expect.any(AbortSignal))
    const signal = vi.mocked(todosApi.list).mock.calls[0][0]
    expect(signal?.aborted).toBe(false)

    unmount()

    await waitFor(() => expect(signal?.aborted).toBe(true))
  })

  it('stores the result under the todos list key', async () => {
    vi.mocked(todosApi.list).mockResolvedValue([todoFixture])

    const { client, result } = setup()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
  })

  it('exposes the error when the API rejects', async () => {
    const error = new Error('boom')
    vi.mocked(todosApi.list).mockRejectedValue(error)

    const { result } = setup()

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBe(error)
  })
})
